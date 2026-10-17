import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageRelationshipTypeMigration } from '../scripts/manageRelationshipTypes.js';

let tempDir: string;
let migrationsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'manage-relationship-type-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('manageRelationshipTypeMigration', () => {
  it('adds a new relationship type and writes a new, auto-numbered migration file', () => {
    const result = manageRelationshipTypeMigration({
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
    expect(written).toContain('INSERT INTO relationship_types');
    expect(written).toContain('brand-new-type');
  });

  it('renames an existing relationship type and writes an UPDATE migration', () => {
    const result = manageRelationshipTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'supplies',
      newType: 'supplies-to',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE relationship_types');
    expect(written).toContain('supplies-to');
  });

  it('removes an existing relationship type and writes a DELETE migration', () => {
    const result = manageRelationshipTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'supplies',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM relationship_types');
  });

  it('refuses an unregistered domain', () => {
    const result = manageRelationshipTypeMigration({
      action: 'add',
      domain: 'does-not-exist',
      type: 'x',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses adding a type that is already registered', () => {
    const result = manageRelationshipTypeMigration({
      action: 'add',
      domain: 'fusion',
      type: 'supplies',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses renaming without --new-type', () => {
    const result = manageRelationshipTypeMigration({
      action: 'rename',
      domain: 'fusion',
      type: 'supplies',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses removing a type that is not registered', () => {
    const result = manageRelationshipTypeMigration({
      action: 'delete',
      domain: 'fusion',
      type: 'nope',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('sets a category for an existing relationship type and writes an UPDATE migration', () => {
    const result = manageRelationshipTypeMigration({
      action: 'set-category',
      domain: 'fusion',
      type: 'supplies',
      category: 'contract',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE relationship_types');
    expect(written).toContain('contract');
  });

  it('refuses set-category without --category', () => {
    const result = manageRelationshipTypeMigration({
      action: 'set-category',
      domain: 'fusion',
      type: 'supplies',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it("clears a relationship type's category and writes an UPDATE migration to NULL", () => {
    const result = manageRelationshipTypeMigration({
      action: 'clear-category',
      domain: 'fusion',
      type: 'supplies',
      migrationsDir,
      now: '2026-09-20T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('category = NULL');
  });
});
