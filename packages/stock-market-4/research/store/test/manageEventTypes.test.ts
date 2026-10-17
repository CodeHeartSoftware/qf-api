import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageEventTypeMigration } from '../scripts/manageEventTypes.js';

let tempDir: string;
let migrationsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'manage-event-type-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('manageEventTypeMigration', () => {
  it('adds a new event type and writes a new, auto-numbered migration file', () => {
    const result = manageEventTypeMigration({
      action: 'add',
      domain: 'fusion',
      type: 'BRAND_NEW_TYPE',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe('fusion');
    expect(result.type).toBe('BRAND_NEW_TYPE');

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('INSERT INTO event_types');
    expect(written).toContain('BRAND_NEW_TYPE');
  });

  it('renames an existing event type and writes an UPDATE migration', () => {
    const result = manageEventTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'ACQUISITION_ANNOUNCED',
      newType: 'SUPPLIER_APPROVED',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE event_types');
    expect(written).toContain('SUPPLIER_APPROVED');
  });

  it('removes an existing event type and writes a DELETE migration', () => {
    const result = manageEventTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'ACQUISITION_ANNOUNCED',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM event_types');
  });

  it('refuses an unregistered domain', () => {
    const result = manageEventTypeMigration({
      action: 'add',
      domain: 'does-not-exist',
      type: 'X',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses adding a type that is already registered', () => {
    const result = manageEventTypeMigration({
      action: 'add',
      domain: 'fusion',
      type: 'ACQUISITION_ANNOUNCED',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses renaming without --new-type', () => {
    const result = manageEventTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'ACQUISITION_ANNOUNCED',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses removing a type that is not registered', () => {
    const result = manageEventTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'NOPE',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });
});
