import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeMarketDataStore,
  createMarketDataStore,
  type MarketDataStore,
} from '../../src/store/db.js';
import { publishDatasetVersion } from '../../src/store/ingest.js';
import {
  clearProvisionalBar,
  queryProvisionalBar,
  writeProvisionalBar,
} from '../../src/store/provisional.js';
import {
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

function bar(date: string, close: number) {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-provisional-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('queryProvisionalBar / writeProvisionalBar', () => {
  it('returns null when no provisional bar has ever been recorded', () => {
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')).toBeNull();
  });

  it('round-trips a written provisional bar', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 42.5), '2026-02-01T15:00:00Z');
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')).toEqual(bar('2026-02-01', 42.5));
  });

  it('overwrites in place on a second write for the SAME date — never appends', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 42.5), '2026-02-01T15:00:00Z');
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 43.1), '2026-02-01T15:30:00Z');
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')).toEqual(bar('2026-02-01', 43.1));
  });

  it('replaces a DIFFERENT date entirely — at most one row per ticker at any time', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 42.5), '2026-02-01T15:00:00Z');
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-02', 44.0), '2026-02-02T15:00:00Z');
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')).toEqual(bar('2026-02-02', 44.0));
  });

  it('keeps each ticker independent', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 42.5), '2026-02-01T15:00:00Z');
    writeProvisionalBar(store, IDENTITY, 'GLOBEX', bar('2026-02-01', 99.9), '2026-02-01T15:00:00Z');
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')?.close).toBe(42.5);
    expect(queryProvisionalBar(store, IDENTITY, 'GLOBEX')?.close).toBe(99.9);
  });
});

describe('clearProvisionalBar', () => {
  it('removes a recorded provisional bar', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', bar('2026-02-01', 42.5), '2026-02-01T15:00:00Z');
    clearProvisionalBar(store, IDENTITY, 'ACME');
    expect(queryProvisionalBar(store, IDENTITY, 'ACME')).toBeNull();
  });

  it('is a no-op when there was nothing to clear', () => {
    expect(() => {
      clearProvisionalBar(store, IDENTITY, 'ACME');
    }).not.toThrow();
  });
});
