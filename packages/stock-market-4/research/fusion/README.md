# @quant-fusion/research-fusion

A structured, real, growing fusion-commercialization research dataset built on
`@quant-fusion/research-core`. Its purpose is twofold: prove the generic core schema can carry
substantial real domain research, and serve as the actual research substrate the
`fusion-fundamental-*`/`fusion-professional-*` bots (`bots/stock-market-4/`) trade against. It
deliberately excludes anything about how a bot should trade on it — that boundary is
non-negotiable (see [`@quant-fusion/research-core`](../core/README.md)'s own README).

```ts
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '@quant-fusion/research-fusion';

const dataset = createFusionFixtureDataset();
```

## What's in the dataset (current counts — this file gets stale fast, see below)

| Collection    | Count |
| ------------- | ----- |
| Entities      | 121   |
| Relationships | 76    |
| Evidence      | 85    |
| Assertions    | 10    |
| Hypotheses    | 25    |
| Models        | 3     |
| Scenarios     | 9     |
| Events        | 27    |
| Questions     | 45    |

Broad categories: reactors/projects (ARC, SPARC, ITER, EU-DEMO, J-DEMO, STEP, CFETR, CFEDR, BEST,
DTT, COMPASS-U, CREST, JT-60SA, ...), the 11 tracked-security companies (ELMT, Furukawa, Vitzro
Nextech, Almonty, Freemelt, Syntec Optics, General Fusion, Fujikura, Sumitomo, Kennametal, AMSC)
plus a much larger set of background/counterparty companies and government/research bodies (CFS,
Walter Tosto, Vitzro Tech, SIMIC, ATI, A.L.M.T., Plansee, Shanghai Superconductor, ams OSRAM, UKAEA,
ORNL, DOE, NNSA, TAE Technologies, Proxima Fusion, Pacific Fusion, Kyoto Fusioneering, and dozens
more), materials (Tungsten, HTS/REBCO, Vanadium, FLiBe, Tritium, Rhenium, CuCrZr), and components
(Vacuum Vessel, TF Magnet, TF Case, Divertor). `test/fixture.test.ts` validates the whole dataset
and spot-checks specific claims (hypothesis register completeness, the ELMT-tungsten-mass proxy
tagging, the uncomputed revenue variable, an explicit check that no ELMT-supplies-ARC relationship
exists even though ELMT manufactures tungsten and ARC requires it) rather than asserting these
counts directly — the counts above will drift as the dataset keeps growing; run
`createFusionFixtureDataset().entities.length` (etc.) yourself for the exact current number rather
than trusting this table long-term.

## How the dataset grew — four ingestion waves

Historical record of how the dataset reached its current size — predates the "Two research
layers" model below, which is the ongoing convention going forward rather than a fifth wave.

1. **Original ingestion** (September 2026 snapshot) — the initial ~40-entity baseline: the core
   reactor/company/material/component register, ~20 relationships (most notably Walter Tosto's
   SPARC supply relationship evolving `tested` (2024) → `qualified` (2025) → `production contract`
   (2029), and SIMIC's TF-case supply to SPARC), ~30 evidence records with real provenance (SEC
   filings, company disclosures, peer-reviewed papers with DOIs), 10 assertions (the source
   material's "anti-thesis" analytical discipline — fusion sentiment trap, directness bias,
   commodity trap, qualification/contract fallacies, market-cap blindness, bottleneck power vs.
   revenue size, compounding replacement demand), the T-001…T-009/H016…H024 hypothesis register,
   3 models (fusion revenue, ARC first-wall tungsten derivation, ELMT valuation sensitivity), and
   9 scenarios (Fusion Bull, Fusion Delay, Materials Bottleneck, HTS Breakthrough, Tritium
   Bottleneck, Fusion False Dawn, Supplier Winner, Commodity Trap, High-demand/constrained
   tritium) — none with a `probability`, since nothing in the source justified assigning one.
2. **ELMT / Schwabmünchen** — The Elmet Group's announced acquisition of ams OSRAM's
   Schwabmünchen, Germany tungsten/molybdenum manufacturing operation, added following the same
   discipline (see its own section below). Required one genuinely domain-neutral schema addition
   to `research-core`: the `ResearchQuestion` type.
3. **Jul-Aug 2026 market verification update** — a broad real-world news-verification pass across
   the wider fusion ecosystem (UKAEA/Eni's RH3OVA joint venture, Proxima Fusion and Pacific Fusion
   funding rounds, JET's decommissioning, CFS's own funding/SPARC progress, several licensing and
   spinout events, and more) — most of this is background/context for entities OTHER than the 11
   tracked securities, and accounts for most of the entity/evidence growth beyond the original
   baseline. Added via [`daily-research-update-skill.md`](./daily-research-update-skill.md)'s
   broad-scope research pass.
4. **Sept 9-11, 2026 updates, and the ongoing portfolio-research-scoped pass** — real, dated news
   specifically about the 11 tracked securities: Freemelt's real F4E/JT-60SA tungsten-component
   order (Sept 9), a UKAEA/MAST-U transmission-system procurement notice and an ITER
   assembly-progress update (Sept 10-11, both correctly modeled as NOT touching any tracked
   security), and — most recently — a `portfolio-research-update-skill.md`-scoped pass covering
   Jul 1 - Sept 11, 2026 across 9 of the 11 tracked tickers (earnings reports, contract awards, an
   IPO, board changes; nothing found for VITZRONEXTECH in that window). This is the wave most
   directly relevant to what the bots actually trade on, and the one most likely to keep growing —
   see "Keeping this dataset current" below.

## ELMT / Schwabmünchen (wave 2, above)

Notable modeling choices:

- **Capability is tracked separately from qualification, which is tracked separately from a
  customer relationship.** Schwabmünchen manufacturing tungsten (an evidenced `manufactures`
  relationship) does not upgrade any of the nine independently-tracked
  `potential_fusion_customer`/`fusion_qualification` relationships (ITER, DEMO, EUROfusion, DTT,
  STEP, SPARC, ARC, CFS, and an "Other Private Fusion" placeholder bucket) away from their
  initialized `UNKNOWN`/confidence-0 state — none of them has supporting evidence yet.
- **Planned capability is never conflated with existing capability.** TZM and tungsten heavy alloy
  get `plans_to_produce` relationships (`status: 'planned'`, `metadata.notCurrentCapability: true`)
  — never a `manufactures` relationship, which is reserved for capability with actual evidentiary
  support.
- **The purchase-price mechanism is never collapsed into a bare number.** The acquisition entity
  records `purchaseConsideration: { status: 'formula_defined', finalConsideration: 'UNKNOWN' }`
  rather than a specific figure — the actual asset purchase agreement's formula nets a negative
  starting point against pension, restructuring, and working-capital adjustments not yet resolved.
- **36 research questions** (`RQ-ELMT-001`…`036`) are generated from one data-driven list rather
  than hand-duplicated as 36 near-identical object literals — see `ELMT_RESEARCH_QUESTIONS` in
  `fixture.ts`.

See `test/elmt-schwabmunchen.test.ts` for the acceptance-criteria coverage specific to this
addition.

## What was deliberately left out

The original source research dump also contained extensive guidance on bot strategy: signal
generation, position sizing, portfolio archetypes, buy/sell conditions, human-approval workflow,
and strategy maturity roadmap. None of that was ingested here — `research-core`/`research-fusion`
must stay completely unaware of any bot that might eventually consume this data. That material
belongs with whatever bot trades on it (see `bots/stock-market-4/fusion-fundamental-v6`/
`fusion-fundamental-v7`/`quant-v0`'s own `research/`, `valuation/`, `alpha/` code), never in
this dataset.

Not every numeric detail from a source is its own queryable `Variable` — deep single-use
academic-paper parameters are folded into `Evidence.description` text instead of exploded into
dozens of low-value near-duplicate objects. Nothing is silently lost, but not everything is
independently queryable.

## Why this matters: the tests, not just the data

- `test/fixture.test.ts` validates the whole dataset and spot-checks specific claims (see above).
- `test/temporal.test.ts` reconstructs H032/H033/H034's confidence histories (culminating at
  0.94/0.92/0.75) and the Walter Tosto/SPARC relationship's state history at several historical
  cutoffs.
- `test/information-leak.test.ts` is the fixture's core proof, exercised against multiple
  independent point-in-time cases (Walter Tosto's 2029 production contract, ELMT's September 8,
  2026 ams OSRAM acquisition announcement, Vitzro Nextech's August 6, 2026 Hanwha Aerospace
  contract, Freemelt's September 9, 2026 F4E/JT-60SA order): a snapshot taken even one day before
  each event cannot see it — not the event, not the evidence, not a stray string anywhere in the
  serialized JSON.

See [`@quant-fusion/research-core`](../core/README.md) for what every type here means and how
temporal visibility is computed.

## Two research layers

This dataset deliberately distinguishes two layers of research, connected through one graph but
governed by different ingestion rules:

- **Fusion Ecosystem Research** — the broad fusion technology, reactor, commercialization,
  supply-chain, manufacturing, materials, research-institution, and regulatory landscape. Captures
  the real causal graph, including developments where none of the 11 tracked securities are
  involved, and including future milestones/expected development gates (see
  [`ecosystem-research-update-skill.md`](skills/ecosystem-research-update-skill.md)).
- **Fusion Portfolio Research** — a deliberately narrow view of the 11 tracked public securities:
  only developments that directly touch one of them, or a named relationship involving one of them
  (see [`portfolio-research-update-skill.md`](skills/portfolio-research-update-skill.md), whose own
  table is prose documentation of `@quant-fusion/fusion-universe`'s `TRACKED_SECURITIES` — the
  same package `@quant-fusion/market-data` reads for ticker/Yahoo-symbol/currency data, so the
  11-company list is defined exactly once, not hand-copied per consumer).

**Scope is derived, not stored.** There is no `scope` field anywhere in the schema — whether a
record is "portfolio" or "ecosystem" is computed on demand from whether it names one of the 11
tracked entity ids as a direct party (`src/scope.ts`'s `isPortfolioEntity`/`isPortfolioEvidence`/
`isPortfolioRelationship`/`isPortfolioEvent`, and `partitionDatasetByScope` for a full split). This
is deliberate: real relationships constantly cross the boundary (Almonty's tungsten offtake to
Plansee, ELMT's development relationship with CFS, Freemelt's JT-60SA order all pair a tracked
company with an untracked counterparty or reactor program in the SAME relationship), so the two
layers are never stored as separate datasets — `createFusionFixtureDataset()` always returns the
whole connected graph, and every consumer (bots, `timeline.ts`, `emitForwardMatchConfig.ts`) reads
that whole graph rather than a scoped slice. The derived split exists for reporting/ingestion
discipline, not for runtime filtering.

## Keeping this dataset current

The dataset itself lives as a sequence of migration files under
`../store/src/migrations/` (`@quant-fusion/research-store` — see
`docs/adr/0014-sqlite-standard-and-migrations.md`), starting from a one-time seed migration
(`0002_fusion_seed.ts`, generated by `scripts/generateFusionSeedMigration.ts` from what used to be
a checked-in `data/dataset.json`) and growing one migration at a time thereafter.
`createFusionFixtureDataset()` (`src/fixture.ts`) loads the dataset by replaying every migration
into a fresh in-memory database and reading it back — validated against
`@quant-fusion/research-core`'s `ResearchDataset` schema on the way out. This means the dataset is
never hardcoded TypeScript and never a hand-edited JSON blob — a research update is a reviewable
migration-file diff, not either of those — see below.

Both companion skills now produce schema-exact `ResearchDataset`-partial JSON (entities/
relationships/evidence/events) and feed the SAME pipeline directly — no coding agent required,
and no loose-summary intermediate step for either layer:

- [`ecosystem-research-update-skill.md`](skills/ecosystem-research-update-skill.md) — broad
  fusion-ecosystem awareness (see "Two research layers" above).
- [`portfolio-research-update-skill.md`](skills/portfolio-research-update-skill.md) — narrow, only the
  11 tracked securities.

**The no-coding-agent update flow**: run either skill's prompt against a free external AI (having
it first run `yarn workspace @quant-fusion/research-fusion run list:entities` — or paste that
output in — so it references real, existing entity ids, and so it can see which are `[PORTFOLIO]`
tagged), save its JSON response to a file, then:

```bash
yarn workspace @quant-fusion/research-store run apply:research-update -- \
  --update-file <path> --domain fusion
```

This pipeline (`@quant-fusion/research-store`'s own `scripts/applyResearchUpdate.ts`) is generic
across every research domain, not specific to this package — every domain's data already lives in
`research-store`'s own migrations (see that package's `src/migrations/0001_init.ts`), so it can
merge an update against ANY domain given its `--domain` (or `--dataset-id`). It merges the update
against the current dataset (via `mergeResearchUpdate`/`renderUpdateSql`) and validates the WHOLE
merged result with `validateResearchDataset` — the same function this package's own tests and
`fixture.ts`'s load path use — before writing anything. Any issue (an unknown entity id, a
duplicate id, a broken cross-reference, an overlapping relationship timeline) refuses the ENTIRE
update and writes no migration file, rather than guessing or partially applying it. On success it
writes a NEW, auto-numbered migration file under `../store/src/migrations/` (never edits an
existing one) and prints the one manual step left — adding that file's import + array entry to
`research-store/src/migrations/index.ts`. The dataset's `version` gets an `+update.N` suffix on
each successful run, so it's always visible whether a given state is the original seed or has
migration-applied updates layered on top.

Once new research is in the dataset, `src/timeline.ts`'s `buildResearchTimeline(dataset,
asOfDate)` turns the whole dataset into a real `stock-market-4` match's `config.researchTimeline`
— one entry per distinct day anything became knowable, each a full `createResearchSnapshot` at
that point in time. `scripts/emitForwardMatchConfig.ts` (run via `yarn workspace
@quant-fusion/research-fusion run emit:forward-config`) wraps this into a complete match config
(universe, dataset reference, dates, and the generated `researchTimeline`) ready to hand to
`quant-fusion match forward run --config-file <path>` or `match run --config-file <path>` — see
[`apps/cli/README.md`](../../apps/cli/README.md#match-forward-run--list--inspect) for the full
command reference. A real `researchTimeline` built this way routinely runs to megabytes, well past
what a shell allows as an inline `--config` argument, which is exactly why `--config-file` exists
on both commands.
