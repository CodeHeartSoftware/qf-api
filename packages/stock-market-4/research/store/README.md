# @quant-fusion/research-store

A SQLite-backed, migration-driven store for `@quant-fusion/research-core`'s `ResearchDataset`, and
the SQL-generation logic that turns curated research content into git-tracked migration files —
see `docs/adr/0014-sqlite-standard-and-migrations.md` for why.

## What this is for

A research dataset (`research/fusion`, `research/quantum`, ...) grows over time as new
entities/relationships/evidence/etc. are curated and reviewed. Unlike market data (where a whole
dataset version must stay pinned and immutable for match reproducibility), research-core's own
point-in-time reconstruction is driven entirely by each object's own timestamps, never by
`dataset.version` — so this package models a research dataset as ONE cumulative, ever-growing
collection per `dataset_id`, not a series of frozen snapshots.

This package does not itself write live data into a running database. Instead, it renders literal
SQL for **migration files**:

- `renderSeedSql(dataset)` — the one migration that recreates a whole dataset from nothing (used
  once, to seed a brand-new `dataset_id`).
- `renderUpdateSql(current, update, now)` — an incremental migration containing only the new rows
  a `ResearchUpdate` contributes (new entities/relationships/etc., or new states appended to an
  existing relationship), plus a version-label bump. This is what a "research update" produces
  now, instead of rewriting a checked-in JSON file.

A human reviews the generated migration file's diff in a PR exactly like any other code change —
that reviewability is the actual point.

`getResearchDataset(store, datasetId)` reads the current dataset back out, re-validating it via
`validateResearchDataset` before returning.

## Usage sketch

```ts
import { createResearchStore } from '@quant-fusion/research-store';
import { renderSeedSql, getResearchDataset } from '@quant-fusion/research-store';

// One-time seed (used by a migration-file generator script, not at runtime):
const sql = renderSeedSql(myResearchDataset);

// Reading (any consumer):
const store = createResearchStore('.quant-fusion/db.sqlite');
const result = getResearchDataset(store, myResearchDataset.id);
if (result.ok) {
  // result.value: ResearchDataset, re-validated on the way out
}
```

## What this is NOT

- Not a query engine. `getResearchDataset` returns the whole current dataset for a given
  `dataset_id` — there is no point/scoped query surface yet (nothing consumes research data any
  other way today).
- Not a live write API. All content changes are migration files, applied once via
  `@quant-fusion/sqlite-migrations`; this package only computes what those files should contain.
- Not a replacement for `@quant-fusion/research-core`'s validation. Every render/read path
  re-validates via `validateResearchDataset`; this package adds no new validation rules of its own.
