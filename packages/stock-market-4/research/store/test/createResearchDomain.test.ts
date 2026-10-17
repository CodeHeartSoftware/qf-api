import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createResearchDomainMigration } from '../scripts/createResearchDomain.js';

let tempDir: string;
let migrationsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'create-research-domain-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createResearchDomainMigration', () => {
  it('creates an empty dataset and writes a new, auto-numbered seed migration', () => {
    const result = createResearchDomainMigration({
      name: 'My New Domain',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe('my-new-domain');
    expect(result.datasetId).toBe('dataset-my-new-domain');

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('dataset_id, domain, name, version, created_at, updated_at');
    expect(written).toContain('dataset-my-new-domain');
    expect(written).toContain('My New Domain');
    // An empty domain has no collection INSERTs at all beyond the one research_datasets row.
    expect(written).not.toContain('INSERT INTO entities');
    // Defaults to priority 0 (the column's own default) when not given.
    expect(written).toContain('UPDATE research_datasets SET priority = 0');
  });

  it('sets an explicit priority when given', () => {
    const result = createResearchDomainMigration({
      name: 'High Priority Domain',
      priority: 50,
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE research_datasets SET priority = 50');
  });

  it('slugifies the name into a domain when --domain is not given', () => {
    const result = createResearchDomainMigration({
      name: 'Battery Materials & Supply Chains!',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe('battery-materials-supply-chains');
  });

  it('refuses a blank name', () => {
    const result = createResearchDomainMigration({ name: '   ', migrationsDir });
    expect(result.ok).toBe(false);
  });

  it('refuses a domain slug that collides with an already-registered domain (e.g. fusion)', () => {
    const result = createResearchDomainMigration({
      name: 'Duplicate',
      domain: 'fusion',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('fusion');
  });

  it('numbers a second created domain one past an existing migration in the same directory', () => {
    const first = createResearchDomainMigration({
      name: 'Domain One',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(first.ok).toBe(true);

    const second = createResearchDomainMigration({
      name: 'Domain Two',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.migrationFileName).toMatch(/^0002_/);
  });
});
