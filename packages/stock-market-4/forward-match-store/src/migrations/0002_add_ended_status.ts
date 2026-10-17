import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Widens `forward_matches.status`'s `CHECK` constraint to allow `'ended'` (see
 * `types.ts`'s `ForwardMatchStatusSchema` doc comment for what it means) — SQLite has no
 * `ALTER TABLE ... ALTER COLUMN` to change a `CHECK` constraint in place, so this recreates the
 * table with the widened constraint and copies every existing row across verbatim, exactly the
 * standard SQLite "12-step" table-alteration procedure. Never hand-edit this file or
 * `0001_init.ts`; a further constraint change is always a NEW migration.
 */
export const migration0002AddEndedStatus: Migration = {
  id: 'forward-match-store/0002_add_ended_status',
  sql: `
CREATE TABLE forward_matches_new (
  match_id                  TEXT NOT NULL PRIMARY KEY,
  game_id                   TEXT NOT NULL,
  game_version              TEXT NOT NULL,
  config                    TEXT NOT NULL,
  participant_ids           TEXT NOT NULL,
  match_seed                TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('active', 'completed', 'forfeited', 'ended')),
  rounds_played             INTEGER NOT NULL,
  forfeited_participant_ids TEXT,
  snapshot                  TEXT NOT NULL
);
INSERT INTO forward_matches_new SELECT
  match_id, game_id, game_version, config, participant_ids, match_seed, created_at, updated_at,
  status, rounds_played, forfeited_participant_ids, snapshot
FROM forward_matches;
DROP TABLE forward_matches;
ALTER TABLE forward_matches_new RENAME TO forward_matches;
CREATE INDEX IF NOT EXISTS idx_forward_matches_updated_at ON forward_matches (updated_at);
`,
};
