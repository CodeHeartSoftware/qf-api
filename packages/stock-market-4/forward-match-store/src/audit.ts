// The decision audit trail's reads/writes — see `migrations/0004_round_audit.ts`. Same
// open-per-call, synchronous `node:sqlite` style as `store.ts`, in the same shared database.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations } from '@quant-fusion/sqlite-migrations';
import { forwardMatchStoreMigrations } from './migrations/index.js';
import { err, ok, type Result } from './result.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** How the participant's action for this round was obtained (`ok`), or why it wasn't. */
export type RoundAuditCollection = 'ok' | 'timeout' | 'invalid' | 'disconnected';

export interface RoundAuditEntry {
  matchId: string;
  roundIndex: number;
  participantId: string;
  /** The round's trading date, when the game reports one. */
  date?: string;
  recordedAt: string;
  observationSha256?: string;
  collection: RoundAuditCollection;
  /** Exactly what the bot submitted (game-specific; opaque here). */
  action?: unknown;
  /** The fills this participant received in this round (game-specific; opaque here). */
  fills?: unknown;
  equityCents?: number;
  sourceSha256?: string;
  configSha256?: string;
  /** The bot's own structured reasoning for this round's decision, when it emits any. */
  rationale?: unknown[];
}

function withDb<T>(dbPath: string, fn: (db: DatabaseSyncType) => T): T {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    const migrated = applyMigrations(db, forwardMatchStoreMigrations);
    if (!migrated.ok) throw new Error(migrated.reason);
    return fn(db);
  } finally {
    db.close();
  }
}

const json = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);

/** Upserts rows — re-recording the same (match, round, participant) replaces it. */
export function recordRoundAudit(
  dbPath: string,
  entries: readonly RoundAuditEntry[],
): Result<void> {
  try {
    withDb(dbPath, (db) => {
      const insert = db.prepare(
        `INSERT INTO forward_match_round_audit
           (match_id, round_index, participant_id, date, recorded_at, observation_sha256,
            collection, action, fills, equity_cents, source_sha256, config_sha256, rationale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_id, round_index, participant_id) DO UPDATE SET
           date = excluded.date, recorded_at = excluded.recorded_at,
           observation_sha256 = excluded.observation_sha256, collection = excluded.collection,
           action = excluded.action, fills = excluded.fills, equity_cents = excluded.equity_cents,
           source_sha256 = excluded.source_sha256, config_sha256 = excluded.config_sha256,
           rationale = COALESCE(excluded.rationale, forward_match_round_audit.rationale)`,
      );
      for (const e of entries) {
        insert.run(
          e.matchId,
          e.roundIndex,
          e.participantId,
          e.date ?? null,
          e.recordedAt,
          e.observationSha256 ?? null,
          e.collection,
          json(e.action),
          json(e.fills),
          e.equityCents ?? null,
          e.sourceSha256 ?? null,
          e.configSha256 ?? null,
          json(e.rationale),
        );
      }
    });
    return ok(undefined);
  } catch (error) {
    return err(`failed to record round audit: ${String(error)}`);
  }
}

/** Attaches rationale to an already-recorded round, matched by trading date — a bot's reasoning
 * can arrive (via its relayed stderr) after the round it belongs to has already been written.
 * Returns how many rows were updated. */
export function attachRoundRationale(
  dbPath: string,
  matchId: string,
  participantId: string,
  date: string,
  rationale: unknown[],
): Result<number> {
  try {
    return ok(
      withDb(dbPath, (db) =>
        Number(
          db
            .prepare(
              `UPDATE forward_match_round_audit SET rationale = ?
               WHERE match_id = ? AND participant_id = ? AND date = ?`,
            )
            .run(JSON.stringify(rationale), matchId, participantId, date).changes,
        ),
      ),
    );
  } catch (error) {
    return err(`failed to attach rationale: ${String(error)}`);
  }
}

interface AuditRow {
  match_id: string;
  round_index: number;
  participant_id: string;
  date: string | null;
  recorded_at: string;
  observation_sha256: string | null;
  collection: string;
  action: string | null;
  fills: string | null;
  equity_cents: number | null;
  source_sha256: string | null;
  config_sha256: string | null;
  rationale: string | null;
}

function rowToEntry(row: AuditRow): RoundAuditEntry {
  const parse = (text: string | null): unknown =>
    text === null ? undefined : (JSON.parse(text) as unknown);
  const rationale = parse(row.rationale);
  return {
    matchId: row.match_id,
    roundIndex: row.round_index,
    participantId: row.participant_id,
    ...(row.date !== null ? { date: row.date } : {}),
    recordedAt: row.recorded_at,
    ...(row.observation_sha256 !== null ? { observationSha256: row.observation_sha256 } : {}),
    collection: row.collection as RoundAuditCollection,
    ...(row.action !== null ? { action: parse(row.action) } : {}),
    ...(row.fills !== null ? { fills: parse(row.fills) } : {}),
    ...(row.equity_cents !== null ? { equityCents: row.equity_cents } : {}),
    ...(row.source_sha256 !== null ? { sourceSha256: row.source_sha256 } : {}),
    ...(row.config_sha256 !== null ? { configSha256: row.config_sha256 } : {}),
    ...(Array.isArray(rationale) ? { rationale } : {}),
  };
}

/** A match's audit rows, newest round first — optionally one participant's only. */
export function listRoundAudit(
  dbPath: string,
  matchId: string,
  options: { participantId?: string; limit?: number } = {},
): Result<RoundAuditEntry[]> {
  try {
    const rows = withDb(dbPath, (db) =>
      options.participantId === undefined
        ? db
            .prepare(
              `SELECT * FROM forward_match_round_audit WHERE match_id = ?
               ORDER BY round_index DESC, participant_id LIMIT ?`,
            )
            .all(matchId, options.limit ?? 500)
        : db
            .prepare(
              `SELECT * FROM forward_match_round_audit WHERE match_id = ? AND participant_id = ?
               ORDER BY round_index DESC LIMIT ?`,
            )
            .all(matchId, options.participantId, options.limit ?? 500),
    ) as unknown as AuditRow[];
    return ok(rows.map(rowToEntry));
  } catch (error) {
    return err(`failed to list round audit: ${String(error)}`);
  }
}
