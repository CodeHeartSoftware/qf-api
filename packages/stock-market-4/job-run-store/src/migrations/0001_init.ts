import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * One row per completed job run — a plain operational log, not append-only research content
 * (see `@thunderdome/research-store`'s very different migration-per-change convention), so
 * writes here are ordinary `INSERT`s at runtime, the same direct-write style
 * `@thunderdome/forward-match-store` already uses for match records.
 */
export const migration0001Init: Migration = {
  id: 'job-run-store/0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS job_runs (
  id          TEXT NOT NULL PRIMARY KEY,
  job_id      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  summary     TEXT NOT NULL,
  output      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs (job_id, started_at);
`,
};
