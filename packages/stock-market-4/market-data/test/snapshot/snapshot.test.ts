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
  createSqliteMarketDataProvider,
  type MarketDataProvider,
} from '../../src/provider/provider.js';
import { createMarketSnapshot, MarketSnapshotSchema } from '../../src/snapshot/snapshot.js';
import {
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

let dir: string;
let store: MarketDataStore;
let provider: MarketDataProvider;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-snapshot-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
  const published = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!published.ok) throw new Error(published.reason);
  const providerResult = createSqliteMarketDataProvider(store, IDENTITY);
  if (!providerResult.ok) throw new Error(providerResult.reason);
  provider = providerResult.value;
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('createMarketSnapshot', () => {
  it('produces a schema-valid, self-contained snapshot for the given tickers and date', () => {
    const snapshot = createMarketSnapshot(provider, ['ACME', 'GLOBEX'], '2026-01-09', 250);
    expect(MarketSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.datasetId).toBe(SAMPLE_DATASET_ID);
    expect(snapshot.datasetVersion).toBe(SAMPLE_DATASET_VERSION);
    expect(snapshot.securities.find((s) => s.ticker === 'ACME')?.bar?.date).toBe('2026-01-09');
    expect(snapshot.corporateActions.some((a) => a.type === 'STOCK_SPLIT')).toBe(true);
  });

  it('never includes a bar or action dated after asOfDate', () => {
    const snapshot = createMarketSnapshot(provider, ['ACME', 'GLOBEX'], '2026-01-06', 250);
    for (const security of snapshot.securities) {
      expect(security.history.every((bar) => bar.date <= '2026-01-06')).toBe(true);
    }
    expect(snapshot.corporateActions).toEqual([]);
  });
});
