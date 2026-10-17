import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageTrackedTickerMigration } from '../scripts/manageTrackedTickers.js';

let tempDir: string;
let migrationsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'manage-tracked-ticker-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('manageTrackedTickerMigration', () => {
  it('adds a new ticker and writes a new, auto-numbered migration file', () => {
    const result = manageTrackedTickerMigration({
      action: 'add',
      domain: 'fusion',
      ticker: 'NVDA',
      companyName: 'NVIDIA',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe('fusion');
    expect(result.ticker).toBe('NVDA');

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('INSERT INTO tracked_tickers');
    expect(written).toContain('NVDA');
    expect(written).toContain('NVIDIA');
  });

  it('removes an existing ticker and writes a DELETE migration', () => {
    const result = manageTrackedTickerMigration({
      action: 'remove',
      domain: 'fusion',
      ticker: 'ELMT',
      migrationsDir,
      now: '2026-09-19T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM tracked_tickers');
    expect(written).toContain('ELMT');
  });

  it('refuses an unregistered domain', () => {
    const result = manageTrackedTickerMigration({
      action: 'add',
      domain: 'does-not-exist',
      ticker: 'NVDA',
      companyName: 'NVIDIA',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses adding a ticker that is already tracked', () => {
    const result = manageTrackedTickerMigration({
      action: 'add',
      domain: 'fusion',
      ticker: 'ELMT',
      companyName: 'ELMT',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses removing a ticker that is not tracked', () => {
    const result = manageTrackedTickerMigration({
      action: 'remove',
      domain: 'fusion',
      ticker: 'NOPE',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });
});
