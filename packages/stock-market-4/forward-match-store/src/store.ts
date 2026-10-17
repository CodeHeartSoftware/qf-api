// A forward match record's persistence: one row per matchId in the shared Stock Market 4 SQLite
// database (docs/adr/0014-sqlite-standard-and-migrations.md) — previously one JSON file per
// matchId (see git history / docs/adr/0013-forward-match-persistence.md for that design and why
// it needed hand-rolled atomicity). Two properties that design earned by hand now come from
// SQLite itself:
//
// 1. Saves are ATOMIC: an `INSERT ... ON CONFLICT DO UPDATE` either fully lands or fully doesn't,
//    replacing the temp-file-write-then-rename dance the JSON-file version needed for the same
//    guarantee.
// 2. `load` still returns a THREE-way outcome (found/not-found/corrupt), not a two-way `Result` —
//    a forward match's create-or-resume caller genuinely needs to tell these apart: "not found"
//    means create a fresh match; "corrupt" must be a hard failure, never silently treated as
//    "not found" (which would quietly create a brand-new match under the same id, discarding
//    whatever trading history the corrupted row held). SQLite won't produce a half-written row the
//    way a crashed file write could, but a JSON-text column can still fail to parse/validate, so
//    this is still worth keeping.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations } from '@quant-fusion/sqlite-migrations';
import { forwardMatchStoreMigrations } from './migrations/index.js';
import { err, ok, type Result } from './result.js';
import {
  ForwardMatchRecordSchema,
  type ForwardMatchRecord,
  type ForwardMatchSummary,
} from './types.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for the full explanation of why `node:sqlite`
// is loaded this way rather than via a static import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** Opens `dbPath` (creating it and its parent directory if needed) and ensures this package's
 * schema is up to date. Called fresh on every operation below rather than held open across calls
 * — this package is used from short-lived CLI command invocations, not a long-running process, so
 * the (small, idempotent) migration check on each open is not a meaningful cost. */
function openDb(dbPath: string): DatabaseSyncType {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  const result = applyMigrations(db, forwardMatchStoreMigrations);
  if (!result.ok) {
    throw new Error(
      `failed to apply forward-match-store migrations to "${dbPath}": ${result.reason}`,
    );
  }
  return db;
}

interface ForwardMatchRow {
  match_id: string;
  game_id: string;
  game_version: string;
  config: string;
  participant_ids: string;
  match_seed: string;
  created_at: string;
  updated_at: string;
  status: string;
  rounds_played: number;
  forfeited_participant_ids: string | null;
  snapshot: string;
  pins: string | null;
}

/** `INSERT ... ON CONFLICT DO UPDATE` — a single atomic upsert, replacing the original
 * temp-file-then-rename overwrite. Not `async` — `node:sqlite` is fully synchronous — but keeps a
 * `Promise`-returning signature so every existing caller (`apps/cli`, `games/stock-market-4`)
 * needs no changes. */
export function saveForwardMatchRecord(
  dbPath: string,
  record: ForwardMatchRecord,
): Promise<Result<void>> {
  try {
    const db = openDb(dbPath);
    db.prepare(
      `INSERT INTO forward_matches (
         match_id, game_id, game_version, config, participant_ids, match_seed,
         created_at, updated_at, status, rounds_played, forfeited_participant_ids, snapshot, pins
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         game_id = excluded.game_id,
         game_version = excluded.game_version,
         config = excluded.config,
         participant_ids = excluded.participant_ids,
         match_seed = excluded.match_seed,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         status = excluded.status,
         rounds_played = excluded.rounds_played,
         forfeited_participant_ids = excluded.forfeited_participant_ids,
         snapshot = excluded.snapshot,
         pins = excluded.pins`,
    ).run(
      record.matchId,
      record.gameId,
      record.gameVersion,
      JSON.stringify(record.config),
      JSON.stringify(record.participantIds),
      record.matchSeed,
      record.createdAt,
      record.updatedAt,
      record.status,
      record.roundsPlayed,
      record.forfeitedParticipantIds !== undefined
        ? JSON.stringify(record.forfeitedParticipantIds)
        : null,
      JSON.stringify(record.snapshot),
      record.pins !== undefined ? JSON.stringify(record.pins) : null,
    );
    db.close();
    return Promise.resolve(ok(undefined));
  } catch (error) {
    return Promise.resolve(
      err(`failed to save forward match record "${record.matchId}": ${String(error)}`),
    );
  }
}

export type LoadForwardMatchRecordOutcome =
  | { status: 'found'; record: ForwardMatchRecord }
  | { status: 'not-found' }
  | { status: 'corrupt'; reason: string };

/** Three-way, not a `Result` — see this module's own doc comment for why a create-or-resume
 * caller needs "missing" and "corrupt" to be distinguishable. Not `async` — see
 * `saveForwardMatchRecord`'s doc comment for why it still returns a `Promise`. */
export function loadForwardMatchRecord(
  dbPath: string,
  matchId: string,
): Promise<LoadForwardMatchRecordOutcome> {
  const db = openDb(dbPath);
  const row = db.prepare('SELECT * FROM forward_matches WHERE match_id = ?').get(matchId) as
    ForwardMatchRow | undefined;
  db.close();

  if (!row) {
    return Promise.resolve({ status: 'not-found' });
  }

  let raw: unknown;
  try {
    raw = {
      matchId: row.match_id,
      gameId: row.game_id,
      gameVersion: row.game_version,
      config: JSON.parse(row.config) as unknown,
      participantIds: JSON.parse(row.participant_ids) as unknown,
      matchSeed: row.match_seed,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      roundsPlayed: row.rounds_played,
      ...(row.forfeited_participant_ids !== null
        ? { forfeitedParticipantIds: JSON.parse(row.forfeited_participant_ids) as unknown }
        : {}),
      snapshot: JSON.parse(row.snapshot) as unknown,
      ...(row.pins !== null ? { pins: JSON.parse(row.pins) as unknown } : {}),
    };
  } catch (error) {
    return Promise.resolve({
      status: 'corrupt',
      reason: `forward match record "${matchId}" has unparseable JSON column(s): ${String(error)}`,
    });
  }

  const result = ForwardMatchRecordSchema.safeParse(raw);
  return Promise.resolve(
    result.success
      ? { status: 'found', record: result.data }
      : {
          status: 'corrupt',
          reason: `forward match record "${matchId}" is corrupt: ${result.error.message}`,
        },
  );
}

export interface ListForwardMatchRecordsResult {
  summaries: ForwardMatchSummary[];
  /** One entry per row that failed to load/validate — collected rather than thrown, so one
   * corrupt record never hides every other forward match from the list. */
  issues: { path: string; message: string }[];
}

/** Newest-first by `updatedAt` (the query's own `ORDER BY`). Corrupt or unreadable rows are
 * reported in `issues`, not thrown — same shape as the original file-based implementation, just
 * walking `match_id`s from a `SELECT` instead of filenames from a `readdir`. */
export async function listForwardMatchRecords(
  dbPath: string,
): Promise<ListForwardMatchRecordsResult> {
  const db = openDb(dbPath);
  const rows = db
    .prepare('SELECT match_id FROM forward_matches ORDER BY updated_at DESC')
    .all() as {
    match_id: string;
  }[];
  db.close();

  const summaries: ForwardMatchSummary[] = [];
  const issues: { path: string; message: string }[] = [];

  for (const { match_id: matchId } of rows) {
    const outcome = await loadForwardMatchRecord(dbPath, matchId);
    if (outcome.status === 'not-found') {
      continue; // raced a concurrent delete — not this function's problem to report
    }
    if (outcome.status === 'corrupt') {
      issues.push({ path: `forward_matches row "${matchId}"`, message: outcome.reason });
      continue;
    }
    const { record } = outcome;
    summaries.push({
      matchId: record.matchId,
      gameId: record.gameId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      roundsPlayed: record.roundsPlayed,
      participantIds: record.participantIds,
    });
  }

  return { summaries, issues };
}

/**
 * Permanently deletes forward match records — one by id, or every record whose status is NOT
 * `'active'` when `matchId` is omitted (ended/completed/forfeited — none of those can ever run
 * again). Resolves with the ids actually deleted (empty when nothing matched).
 */
export function deleteForwardMatchRecords(
  dbPath: string,
  matchId?: string,
): Promise<Result<string[]>> {
  try {
    const db = openDb(dbPath);
    const rows = (
      matchId === undefined
        ? db.prepare("SELECT match_id FROM forward_matches WHERE status <> 'active'").all()
        : db.prepare('SELECT match_id FROM forward_matches WHERE match_id = ?').all(matchId)
    ) as { match_id: string }[];
    const remove = db.prepare('DELETE FROM forward_matches WHERE match_id = ?');
    const removeAudit = db.prepare('DELETE FROM forward_match_round_audit WHERE match_id = ?');
    for (const row of rows) {
      remove.run(row.match_id);
      removeAudit.run(row.match_id);
    }
    db.close();
    return Promise.resolve(ok(rows.map((row) => row.match_id)));
  } catch (error) {
    return Promise.resolve(err(`failed to delete forward match records: ${String(error)}`));
  }
}
