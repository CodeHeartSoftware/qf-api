# ADR-0014: One Shared SQLite Database, Driven Entirely By Migrations

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

ADR-0010 introduced SQLite for `@thunderdome/market-data` as a deliberately narrow, one-off
exception to `docs/architecture.md` §10's blanket "no database" stance — scoped to market data
only, one file per dataset id, explicitly stating that "any other case for persistence still needs
its own ADR making the same case."

Two other Stock Market 4 persistence needs have since hit the identical wall market-data already
solved:

- **Research data** (`@thunderdome/research-core`'s `ResearchDataset`) is, by its own doc comment,
  "an immutable, versioned collection of research" — the same shape of problem as a market
  dataset. Until this ADR, it was hand-authored in `research/fusion/src/fixture.ts`, compiled by
  `scripts/migrateFixtureToJson.ts` into a single checked-in `data/dataset.json` (thousands of
  lines), grown by `scripts/applyResearchUpdate.ts` rewriting that same file. **Reviewing a
  research update meant reviewing a multi-thousand-line JSON diff.**
- **Portfolio/forward-match data** (`@thunderdome/forward-match-store`, ADR-0013) was one JSON file
  per match, with hand-rolled atomicity (temp-file write + rename) and a hand-rolled 3-way
  found/not-found/corrupt load outcome — solving, by hand, exactly what a transactional embedded
  database already provides.

A SQLite file is binary — it can't be reviewed as a diff the way JSON can. So the real design
question wasn't just "can research data use SQLite," it was: **what should the git-tracked,
PR-reviewable artifact actually be, once it's SQLite underneath?** The answer this ADR lands on:
**migration files themselves are that artifact.** A schema change and a batch of newly-curated
research content are both just a new, git-tracked `.ts` file containing SQL — reviewed in a PR
exactly like any other code change. Replaying every migration against an empty database fully
reconstructs it. This is a strictly better reviewability story than the JSON file it replaces: a
research update used to be "diff the whole dataset file"; now it's "read the new INSERT
statements," and the update pipeline (`mergeResearchUpdate`) still refuses the whole batch on any
validation failure before anything is written.

## Decision

**`docs/architecture.md` §10's blanket "no database" line is superseded.** SQLite is an accepted
persistence choice anywhere in this repo a package's own need is genuinely relational, indexed, or
versioned, provided it stays **light and portable**: `node:sqlite` only (no native/compiled
dependency, per ADR-0008), one embedded file (or `:memory:`), gitignored, never a server process,
no ORM.

**One shared database file for all of Stock Market 4's persistence** — price data, research data,
and forward-match/portfolio data all live in `.thunderdome/stock-market-4/db.sqlite`, not one file
per domain. A new package, **`@thunderdome/stock-market-4-db`**, owns that one file's lifecycle
(`openStockMarket4Db`/`openEphemeralStockMarket4Db`) and the full, aggregated migration list
across every domain. Each domain package (`@thunderdome/market-data`, `@thunderdome/research-store`,
`@thunderdome/forward-match-store`) keeps its own query/write logic and its own migration
_content_ — namespaced by id (`market-data/0001_init`, `research-store/0001_init`,
`forward-match-store/0001_init`, ...) so they can share one `_migrations` table without colliding
— but stops owning "how do I open my file."

**Shared migration-runner package, `@thunderdome/sqlite-migrations`.** `applyMigrations(db,
migrations)` applies every not-yet-applied `{ id, sql }` migration in ascending `id` order, each in
its own transaction, tracked in a `_migrations` table with a content checksum. Re-running is a
no-op; editing an already-applied migration is a hard, fail-closed error — the fix is always a new
migration. `escapeForTemplateLiteral`/`renderMigrationFileSource` (also in this package) are the
one place any generator script turns a `Migration`'s SQL into safe `.ts` source — critical because
generated SQL routinely embeds `JSON.stringify`d data, whose own backslash escapes (`\n`, `\"`, …)
would otherwise be silently re-interpreted by the JS engine when the generated file is loaded.

**Curated content is a migration; live/operational data is not.** The dividing line:

- **Migration** (git-tracked, reviewed in a PR): a research update
  (`research/fusion/scripts/applyResearchUpdate.ts` → `@thunderdome/research-store`'s
  `renderUpdateSql`, producing a new `NNNN_fusion_update.ts`) or a batch of newly-fetched price
  bars. Each is a deliberate, reviewed addition to the knowledge base.
- **Runtime write, not a migration** (schema comes from a migration; row data does not): a forward
  match's portfolio state, which changes every round it plays. Treating that as a migration would
  mean a new git-tracked file per round of every match — the schema-vs-content line for research
  and price data doesn't apply the same way to state that's inherently live and per-match.

**Research data's storage model differs from market data's.** `@thunderdome/research-core`'s
point-in-time reconstruction (`state/provider.ts`) is driven entirely by each object's own
`recordedAt`/`observedAt`/etc. timestamps, never by `dataset.version` — unlike market data, where a
whole `(dataset_id, dataset_version)` snapshot must stay pinned and immutable for match
reproducibility. So `@thunderdome/research-store` models a research dataset as ONE cumulative,
ever-growing collection per `dataset_id` (rows keyed by `(dataset_id, id)`, no `dataset_version` in
the key), with `research_datasets` holding a single, updatable `version` label per dataset rather
than a new snapshot row per version.

## Consequences

- `research/fusion`'s checked-in `data/dataset.json` and `scripts/migrateFixtureToJson.ts` are
  retired. `fixture.ts` now loads by replaying `@thunderdome/research-store`'s migrations into a
  fresh `:memory:` database — the migration history is the sole source of truth, not a
  separately-maintained file. `research/quantum` got the same treatment for its (smaller) inline
  dataset.
- `@thunderdome/forward-match-store`'s public function signatures are unchanged (still
  `Promise`-returning, taking a path string), so callers needed only a rename (the path now means
  "the shared db file," not "a directory of per-match JSON files") — `apps/cli`'s forward-match
  commands and `games/stock-market-4` pick this up mechanically.
- market-data's price-data ingestion scripts (`fetchAndAppendBars.ts`, `appendBarsFromFile.ts`,
  `seedFusionFundamentalV0.ts`) render migration files too, via `renderPublishDatasetVersionSql`/
  `renderAppendBarsSql` — the same pattern research content uses, so all curated content in this
  repo goes through one consistent mechanism. The one deliberate exception:
  `seedFusionFixture.ts` seeds the package's own unit-test fixture (`test/fixtures/
sampleDataset.ts`) and stays a plain direct-write dev convenience — that fixture is separately
  published inside every isolated test store already, so baking it into a migration would mean
  every market-data store (including a fresh test's own temp file) gets it applied automatically,
  colliding with the test's own publish call for the same `(id, version)`. Only genuinely curated,
  reviewed content belongs in a migration; a unit-test fixture is neither.
- This does not license a database outside SQLite, nor a database for anything unrelated to Stock
  Market 4's own persistence needs — the "light and portable" guardrail, and the bar of showing the
  existing plain-file patterns genuinely don't fit, both still apply to any future case.
