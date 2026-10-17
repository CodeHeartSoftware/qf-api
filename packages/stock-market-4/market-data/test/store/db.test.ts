import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeMarketDataStore,
  createMarketDataStore,
  openMarketDataStore,
} from '../../src/store/db.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-db-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createMarketDataStore / openMarketDataStore', () => {
  it('creates a new file with the schema applied', () => {
    const dbPath = join(dir, 'dataset.sqlite');
    const store = createMarketDataStore(dbPath);
    expect(store.path).toBe(dbPath);
    closeMarketDataStore(store);
  });

  it('opens an existing file created by createMarketDataStore', () => {
    const dbPath = join(dir, 'dataset.sqlite');
    closeMarketDataStore(createMarketDataStore(dbPath));

    const result = openMarketDataStore(dbPath);
    expect(result.ok).toBe(true);
    if (result.ok) closeMarketDataStore(result.value);
  });

  it('fails closed (a Result, not a thrown exception) when the file does not exist', () => {
    const result = openMarketDataStore(join(dir, 'does-not-exist.sqlite'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not found');
  });

  it('is idempotent: creating the same path twice never errors', () => {
    const dbPath = join(dir, 'dataset.sqlite');
    closeMarketDataStore(createMarketDataStore(dbPath));
    expect(() => {
      closeMarketDataStore(createMarketDataStore(dbPath));
    }).not.toThrow();
  });
});
