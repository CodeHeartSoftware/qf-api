import { createHash } from 'node:crypto';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { err, ok, type Result } from './result.js';

/**
 * One layered, repeatable schema change. `id` must sort into the order migrations are meant to
 * apply in (e.g. `0001_init`, `0002_add_x`) — `applyMigrations` sorts by `id` itself rather than
 * trusting caller order, so a store package can freely reorder its own `migrations` array without
 * changing behavior. `sql` may contain multiple statements (anything `DatabaseSync#exec` accepts).
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS _migrations (
  id         TEXT NOT NULL PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum   TEXT NOT NULL
);
`;

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Applies every migration in `migrations` that isn't already recorded in this database's own
 * `_migrations` table, in ascending `id` order, each inside its own transaction. Safe to call on
 * every store open: already-applied migrations are skipped, not re-run.
 *
 * Fails closed (a `Result`, never a thrown exception) if a migration already recorded as applied
 * no longer matches its recorded checksum — this means the migration's source was edited after
 * being applied, which `applyMigrations` refuses to paper over silently. The fix is always a new
 * migration, never an edit to one that already shipped.
 */
export function applyMigrations(
  db: DatabaseSyncType,
  migrations: readonly Migration[],
): Result<void> {
  db.exec(MIGRATIONS_TABLE_DDL);

  const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const findApplied = db.prepare('SELECT checksum FROM _migrations WHERE id = ?');
  const recordApplied = db.prepare(
    'INSERT INTO _migrations (id, applied_at, checksum) VALUES (?, ?, ?)',
  );

  for (const migration of sorted) {
    const checksum = checksumOf(migration.sql);
    const existing = findApplied.get(migration.id) as { checksum: string } | undefined;

    if (existing) {
      if (existing.checksum !== checksum) {
        return err(
          `migration "${migration.id}" has already been applied to this database with different ` +
            'contents — a previously-applied migration must never be edited; add a new migration instead.',
        );
      }
      continue;
    }

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      recordApplied.run(migration.id, new Date().toISOString(), checksum);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      return err(`migration "${migration.id}" failed: ${String(error)}`);
    }
  }

  return ok(undefined);
}
