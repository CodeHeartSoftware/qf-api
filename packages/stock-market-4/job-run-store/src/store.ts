// A plain operational log — one row per completed job run. Direct-write at runtime (no
// migration-per-write), the same style `@quant-fusion/forward-match-store` uses for match
// records — see `migrations/0001_init.ts`'s own doc comment for why this differs from
// `@quant-fusion/research-store`'s append-only-migration convention.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations } from '@quant-fusion/sqlite-migrations';
import { jobRunStoreMigrations } from './migrations/index.js';
import { err, ok, type Result } from './result.js';
import type { JobRun, NewJobRun } from './types.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for the full explanation of why `node:sqlite`
// is loaded this way rather than via a static import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** Opens `dbPath` (creating it and its parent directory if needed) and ensures this package's
 * schema is up to date. Called fresh on every operation, not held open — this package is used
 * from short-lived API request handlers, not a long-running connection pool, so the (small,
 * idempotent) migration check on each open is not a meaningful cost. */
function openDb(dbPath: string): DatabaseSyncType {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  const result = applyMigrations(db, jobRunStoreMigrations);
  if (!result.ok) {
    throw new Error(`failed to apply job-run-store migrations to "${dbPath}": ${result.reason}`);
  }
  return db;
}

interface JobRunRow {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string;
  ok: number;
  summary: string;
  output: string;
}

function rowToJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok !== 0,
    summary: row.summary,
    output: row.output,
  };
}

/** Records one completed run — never throws; a caller that can't record history shouldn't fail
 * the job it's recording. */
export function recordJobRun(dbPath: string, run: NewJobRun): Result<JobRun> {
  try {
    const db = openDb(dbPath);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO job_runs (id, job_id, started_at, finished_at, ok, summary, output)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, run.jobId, run.startedAt, run.finishedAt, run.ok ? 1 : 0, run.summary, run.output);
    db.close();
    return ok({ id, ...run });
  } catch (error) {
    return err(`failed to record job run for "${run.jobId}": ${String(error)}`);
  }
}

/** Every run recorded for `jobId`, most recent first, capped at `limit` (default 20 — a job
 * history view, not a full audit export). */
export function listJobRuns(dbPath: string, jobId: string, limit = 20): Result<JobRun[]> {
  try {
    const db = openDb(dbPath);
    const rows = db
      .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(jobId, limit) as unknown as JobRunRow[];
    db.close();
    return ok(rows.map(rowToJobRun));
  } catch (error) {
    return err(`failed to list job runs for "${jobId}": ${String(error)}`);
  }
}
