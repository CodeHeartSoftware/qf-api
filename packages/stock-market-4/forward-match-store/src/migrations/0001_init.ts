import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * One row per match, keyed by `match_id` — replaces the original one-JSON-file-per-match design
 * (see `docs/adr/0013-forward-match-persistence.md` and
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). `config`/`snapshot` stay opaque JSON-text
 * blob columns: this package still never depends on `@thunderdome/engine` or any game (ADR-0013's
 * boundary is unchanged — only the storage medium is). `participant_ids`/
 * `forfeited_participant_ids` are small JSON-encoded string arrays, not normalized into a child
 * table — not worth it at this size, matching this repo's general restraint on over-normalizing.
 *
 * Unlike research/market-data content, forward-match ROWS are never git-tracked migrations —
 * this table's SCHEMA comes from a migration, but a match's own rows are ordinary runtime writes
 * (a match's portfolio state changes every round it plays; that's not reviewable curated content).
 */
export const migration0001Init: Migration = {
  id: 'forward-match-store/0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS forward_matches (
  match_id                  TEXT NOT NULL PRIMARY KEY,
  game_id                   TEXT NOT NULL,
  game_version              TEXT NOT NULL,
  config                    TEXT NOT NULL,
  participant_ids           TEXT NOT NULL,
  match_seed                TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('active', 'completed', 'forfeited')),
  rounds_played             INTEGER NOT NULL,
  forfeited_participant_ids TEXT,
  snapshot                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forward_matches_updated_at ON forward_matches (updated_at);
`,
};
