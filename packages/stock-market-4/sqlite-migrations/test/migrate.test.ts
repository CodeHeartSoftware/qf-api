import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for why `node:sqlite` is loaded this way
// rather than via a static import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

function memoryDb(): DatabaseSyncType {
  return new DatabaseSync(':memory:');
}

describe('applyMigrations', () => {
  it('applies migrations in ascending id order, regardless of array order', () => {
    const db = memoryDb();
    const result = applyMigrations(db, [
      { id: '0002_add_column', sql: 'ALTER TABLE widgets ADD COLUMN color TEXT;' },
      { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);' },
    ]);

    expect(result.ok).toBe(true);
    db.prepare('INSERT INTO widgets (id, color) VALUES (1, ?)').run('red');
    expect(db.prepare('SELECT color FROM widgets WHERE id = 1').get()).toEqual({ color: 'red' });
  });

  it('is idempotent: re-applying the same migrations is a no-op', () => {
    const db = memoryDb();
    const migrations = [{ id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);' }];

    expect(applyMigrations(db, migrations).ok).toBe(true);
    expect(applyMigrations(db, migrations).ok).toBe(true);
    expect(db.prepare('SELECT COUNT(*) as n FROM _migrations').get()).toEqual({ n: 1 });
  });

  it('only applies newly-added migrations on a later call', () => {
    const db = memoryDb();
    expect(
      applyMigrations(db, [
        { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);' },
      ]).ok,
    ).toBe(true);

    expect(
      applyMigrations(db, [
        { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);' },
        { id: '0002_add_column', sql: 'ALTER TABLE widgets ADD COLUMN color TEXT;' },
      ]).ok,
    ).toBe(true);

    db.prepare('INSERT INTO widgets (id, color) VALUES (1, ?)').run('blue');
    expect(db.prepare('SELECT color FROM widgets WHERE id = 1').get()).toEqual({ color: 'blue' });
  });

  it('fails closed when an already-applied migration is edited', () => {
    const db = memoryDb();
    expect(
      applyMigrations(db, [
        { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);' },
      ]).ok,
    ).toBe(true);

    const result = applyMigrations(db, [
      { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT);' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('0001_init');
      expect(result.reason).toContain('must never be edited');
    }
  });

  it('rolls back a failing migration rather than leaving it half-applied', () => {
    const db = memoryDb();
    const result = applyMigrations(db, [
      { id: '0001_init', sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY); NOT VALID SQL;' },
    ]);

    expect(result.ok).toBe(false);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'").get(),
    ).toBeUndefined();
  });
});
