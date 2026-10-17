import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeStockMarket4Db,
  openEphemeralStockMarket4Db,
  openStockMarket4Db,
  stockMarket4Migrations,
  type StockMarket4Db,
} from '../src/store.js';

const EXPECTED_TABLES = [
  // market-data
  'dataset_versions',
  'daily_bars',
  'corporate_actions',
  'trading_holidays',
  // research-store
  'research_datasets',
  'entities',
  'relationships',
  'evidence',
  'assertions',
  'hypotheses',
  'assumptions',
  'variables',
  'models',
  'scenarios',
  'events',
  'questions',
  // forward-match-store
  'forward_matches',
];

function tableNames(store: StockMarket4Db): string[] {
  return (
    store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe('openStockMarket4Db', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stock-market-4-db-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates every domain's tables in one shared file", () => {
    const store = openStockMarket4Db(join(dir, 'db.sqlite'));
    const names = tableNames(store);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
    closeStockMarket4Db(store);
  });

  it('creates missing parent directories rather than failing with "unable to open database file"', () => {
    const dbPath = join(dir, 'nested', 'deeper', 'db.sqlite');
    expect(() => {
      closeStockMarket4Db(openStockMarket4Db(dbPath));
    }).not.toThrow();
  });

  it('is idempotent: opening the same path twice never errors', () => {
    const dbPath = join(dir, 'db.sqlite');
    closeStockMarket4Db(openStockMarket4Db(dbPath));
    expect(() => {
      closeStockMarket4Db(openStockMarket4Db(dbPath));
    }).not.toThrow();
  });

  it('records every migration id, namespaced per domain, in _migrations', () => {
    const store = openStockMarket4Db(join(dir, 'db.sqlite'));
    const ids = (
      store.db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]
    ).map((row) => row.id);
    expect(ids).toEqual(stockMarket4Migrations.map((migration) => migration.id).sort());
    for (const id of ids) {
      expect(id).toMatch(/^(forward-match-store|market-data|research-store)\//);
    }
    closeStockMarket4Db(store);
  });
});

describe('openEphemeralStockMarket4Db', () => {
  it('builds a fresh in-memory database with every table present', () => {
    const store = openEphemeralStockMarket4Db();
    const names = tableNames(store);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
    closeStockMarket4Db(store);
  });
});
