import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageEntityTypeMigration } from '../scripts/manageEntityTypes.js';

let tempDir: string;
let migrationsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'manage-entity-type-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('manageEntityTypeMigration', () => {
  it('adds a new entity type and writes a new, auto-numbered migration file', () => {
    const result = manageEntityTypeMigration({
      action: 'add',
      domain: 'fusion',
      type: 'brand-new-type',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe('fusion');
    expect(result.type).toBe('brand-new-type');

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('INSERT INTO entity_types');
    expect(written).toContain('brand-new-type');
  });

  it('renames an existing entity type and writes an UPDATE migration', () => {
    const result = manageEntityTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'company',
      newType: 'organization-company',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE entity_types');
    expect(written).toContain('organization-company');
  });

  it('removes an existing entity type and writes a DELETE migration', () => {
    const result = manageEntityTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'company',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM entity_types');
  });

  it('refuses an unregistered domain', () => {
    const result = manageEntityTypeMigration({
      action: 'add',
      domain: 'does-not-exist',
      type: 'x',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses adding a type that is already registered', () => {
    const result = manageEntityTypeMigration({
      action: 'add',
      domain: 'fusion',
      type: 'company',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses renaming without --new-type', () => {
    const result = manageEntityTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'company',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses removing a type that is not registered', () => {
    const result = manageEntityTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'nope',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });
});
