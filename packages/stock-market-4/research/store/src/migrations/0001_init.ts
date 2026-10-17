import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * One table per `ResearchDataset` collection (see `@thunderdome/research-core`'s `dataset.ts`),
 * each row keyed by `(dataset_id, id)` — NOT `(dataset_id, dataset_version, id)`. Unlike
 * `@thunderdome/market-data` (where a whole `(dataset_id, dataset_version)` snapshot must stay
 * pinned and immutable for match reproducibility), research-core's own point-in-time
 * reconstruction (`state/provider.ts`) is driven entirely by each object's `recordedAt`/
 * `observedAt`/etc. timestamps, never by `dataset.version` — so a research dataset is modeled here
 * as ONE cumulative, ever-growing collection per `dataset_id`. `research_datasets` holds exactly
 * one row per `dataset_id`, and its `version`/`updated_at` are updated in place as new content
 * lands (see `docs/adr/0014-sqlite-standard-and-migrations.md`). (Named `research_datasets`, not
 * `dataset_versions`, specifically to avoid colliding with `@thunderdome/market-data`'s own
 * `dataset_versions` table once both share one physical database file.)
 *
 * Each collection table carries a handful of real columns for the fields worth indexing/filtering
 * on, plus a `data` column holding the item's full JSON — the source of truth `store/read.ts`
 * reconstructs from, so no column list here needs to be exhaustive or ever kept in lockstep with
 * every optional field research-core's schemas allow. `ordinal` records each item's position in
 * the dataset's growing array (a later migration appending new items continues numbering from the
 * current max, never renumbering existing rows) — SQLite's row order is otherwise not guaranteed
 * to match insertion order, and a dataset's array order must round-trip exactly.
 *
 * No SQL foreign keys between collections (e.g. a relationship's `from_entity_id` into
 * `entities`) — cross-reference validity is `@thunderdome/research-core`'s
 * `validateResearchDataset`'s job, at merge time, the same restraint `market-data` shows by only
 * ever foreign-keying the dataset identity tuple itself.
 */
export const migration0001Init: Migration = {
  id: 'research-store/0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS research_datasets (
  dataset_id  TEXT NOT NULL PRIMARY KEY,
  domain      TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  metadata    TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  dataset_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (dataset_id, type);

CREATE TABLE IF NOT EXISTS relationships (
  dataset_id     TEXT NOT NULL,
  id             TEXT NOT NULL,
  ordinal        INTEGER NOT NULL,
  type           TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  to_entity_id   TEXT NOT NULL,
  data           TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships (dataset_id, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships (dataset_id, to_entity_id);

CREATE TABLE IF NOT EXISTS evidence (
  dataset_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS assertions (
  dataset_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS hypotheses (
  dataset_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS assumptions (
  dataset_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS variables (
  dataset_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  origin      TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS models (
  dataset_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS scenarios (
  dataset_id  TEXT NOT NULL,
  id          TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);

CREATE TABLE IF NOT EXISTS events (
  dataset_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (dataset_id, timestamp);

CREATE TABLE IF NOT EXISTS questions (
  dataset_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ordinal    INTEGER NOT NULL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
`,
};
