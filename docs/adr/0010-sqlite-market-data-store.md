# ADR-0010: SQLite Market Data Store

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

The Stock Market 4 roadmap calls for market data — daily bars, corporate actions, a trading
calendar — that is identifiable and versioned (a competition must stay reproducible against the
exact dataset it ran with, even after that dataset is later corrected), and shared across
historical, synthetic, and eventually forward/current-day match modes without three separate
storage implementations. Today, `games/stock-market-4` embeds this data directly in match config
(`historicalPrices`/`corporateActions`, validated by `parseConfig`'s Zod schema) — workable for a
single historical replay, but with no identity/version concept, and no story for data that arrives
incrementally over real calendar days rather than being authored once per match.

"No database" is a deliberate, standing constraint (`docs/architecture.md` §10) that any design
here has to respect. The two existing precedents for persistence without a database are both
plain-file patterns: the registry's filesystem scan of `manifest.json` files (ADR-0001), and
`tournament-store`'s one-JSON-file-per-record (ADR-0009). Neither fits this need well:

- The registry's pattern is for static, small, hand-authored metadata scanned in full on every
  read — not for indexed range queries (`WHERE date <= ?`) over a table that can run to thousands
  of rows per ticker.
- `tournament-store`'s pattern is for small, single-writer, append-as-you-go records read back
  whole. A market dataset needs point queries scoped by ticker and date, and — the harder
  requirement — an immutable, queryable-by-version story: a corrected dataset must publish as a
  new version without disturbing what an already-completed competition recorded it ran against.
  Modeling that as flat files would mean re-deriving an ad hoc indexing/versioning scheme that a
  database already provides for free.

This is a genuinely new category of need in this repo, not an excuse to reach for a database
because one happens to be convenient. The scope below is deliberately narrow: this ADR licenses a
database for market data only, in one new package. It does not reopen §10 generally, and does not
license any other part of the platform to add persistence this way without its own ADR making the
same case.

## Decision

**New package, `@thunderdome/market-data`**, providing a `MarketDataProvider` interface
(`tickers()`, `barsAsOf(ticker, asOfDate, maxDays)`, `corporateActionsAsOf(ticker, asOfDate)`,
`tradingHolidays()`) backed by SQLite. `games/stock-market-4` depends on this package the same way
it already depends on `@thunderdome/engine`; the game's own code never touches SQLite directly,
only the provider interface — the database is an implementation detail one layer down.

**`node:sqlite`, not `better-sqlite3`.** Node's built-in `DatabaseSync` (stable, unflagged, on this
repo's pinned Node version) is fully synchronous — matching every `GameDefinition` method already
being synchronous — with zero new native/compiled dependency. This repo currently has no native
dependencies at all, and ADR-0008 explicitly prioritizes toolchain simplicity; `better-sqlite3`
would require prebuilt binaries or a compile step for no offsetting benefit here. (`node:sqlite` is
loaded via `createRequire` rather than a static `import` — a build/test-tooling workaround for
Vite/Vitest's module resolver not yet recognizing this specific builtin as external; see the
package's `store/db.ts` for the full explanation. This has no bearing on the driver choice itself.)

**One SQLite file per dataset id**, under `<rootDir>/.thunderdome/market-data/<id>.sqlite` —
gitignored local run state, the same convention `tournament-store` already established for
`.thunderdome/`. Every row is tagged with a `dataset_version` column; **a version's rows are never
mutated or deleted once published** — a correction publishes an entirely new, complete version.
This is what makes a historical competition's recorded `(datasetId, datasetVersion)` a durable,
reproducible reference.

**Config gains an optional `marketDataset: { id, version, storeDir }`**, coexisting with (not
replacing) the existing inline `historicalPrices`/`corporateActions` fields — the two are mutually
exclusive, and exactly one must be provided. A full migration off the inline fields is explicitly
deferred; this keeps Phase 1 additive rather than a rewrite of every existing match config and
test fixture. Ticker-coverage validation against an actual dataset happens once, at
`initialize()` — not inside `parseConfig`'s Zod schema, which stays a pure, in-memory function
with no filesystem access (the same principle `@thunderdome/research-core` follows for its own
dataset cross-referencing).

**Bots still never get direct provider or database access.** `getObservation()` remains the sole
authority for what a bot sees, built from the provider the same way it was already built from
config — the provider only changes where `game.ts` itself reads bars/actions from, never what a
bot receives. `redactConfigForBots` strips `marketDataset.storeDir` (a host filesystem path) before
a bot's `init` payload is built, while passing through the harmless `id`/`version` identifiers.

## Consequences

- `.thunderdome/market-data/*.sqlite` files are binary and gitignored — datasets must be
  (re)seeded locally/in CI via a seed script rather than checked into git as source, the same
  trade-off ADR-0009 already accepts for `.thunderdome/tournaments/`.
- This does not migrate any existing match config off inline `historicalPrices`/`corporateActions`
  — both forms are fully supported, and every existing test/fixture using the inline form is
  unaffected (the pre-existing 206 `games/stock-market-4` tests pass unchanged, alongside 9 new
  tests proving the two data sources produce byte-identical observations/results across a full
  match). A full migration, if ever wanted, is a separate, later decision.
- This does not solve incremental forward/current-day data ingestion — Phase 1 only covers
  datasets seeded ahead of a match, whether historical or synthetic. A live ingestion pipeline
  feeding new rows into a dataset as real trading days close is future roadmap work built on top
  of this same provider interface, not a reason to revisit the interface itself.
- This does not, on its own, license any other package to add a database — that generalization,
  plus a shared migration mechanism so schema changes don't mean re-inventing this package's own
  `CREATE TABLE IF NOT EXISTS` approach per store, is ADR-0014's job, once research data and
  forward-match/portfolio data hit the same wall this ADR describes.
- No explicit close/dispose hook exists yet for the SQLite handle a match's `initialize()` opens —
  there is currently no `GameDefinition` teardown callback to call it from (see
  ADR-0005's own consequences on `TState` lifecycle). Acceptable for a single match process today;
  worth revisiting if a long-running host process (e.g. a tournament runner playing many matches
  in one process) starts opening enough of these to matter.
