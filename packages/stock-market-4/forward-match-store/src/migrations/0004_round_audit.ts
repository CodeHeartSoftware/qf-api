import type { Migration } from '@quant-fusion/sqlite-migrations';

/** The decision audit trail — one row per (match, round, participant), written as each round
 * resolves: what the bot was shown (a hash), what it submitted, the fills it got, its equity
 * afterward, the code/config it was running, and (attached a moment later, once its stderr has
 * drained) its own stated rationale. Lets "why did it trade X on day D?" be answered after the
 * fact, which the single latest-snapshot `forward_matches` row never could. */
export const migration0004RoundAudit: Migration = {
  id: 'forward-match-store/0004_round_audit',
  sql: `
CREATE TABLE IF NOT EXISTS forward_match_round_audit (
  match_id           TEXT NOT NULL,
  round_index        INTEGER NOT NULL,
  participant_id     TEXT NOT NULL,
  date               TEXT,
  recorded_at        TEXT NOT NULL,
  observation_sha256 TEXT,
  collection         TEXT NOT NULL,
  action             TEXT,
  fills              TEXT,
  equity_cents       INTEGER,
  source_sha256      TEXT,
  config_sha256      TEXT,
  rationale          TEXT,
  PRIMARY KEY (match_id, round_index, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_round_audit_participant
  ON forward_match_round_audit (match_id, participant_id, round_index);
`,
};
