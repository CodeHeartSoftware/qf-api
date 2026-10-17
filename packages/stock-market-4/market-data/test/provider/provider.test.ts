import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeMarketDataStore,
  createMarketDataStore,
  openMarketDataStore,
  type MarketDataStore,
} from '../../src/store/db.js';
import { publishDatasetVersion } from '../../src/store/ingest.js';
import { writeProvisionalBar } from '../../src/store/provisional.js';
import { renderCheckedThroughSql } from '../../src/store/sqlGen.js';
import { createSqliteMarketDataProvider } from '../../src/provider/provider.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

let dir: string;
let dbPath: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-provider-test-'));
  dbPath = join(dir, 'dataset.sqlite');
  store = createMarketDataStore(dbPath);
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteMarketDataProvider', () => {
  it('builds a working provider for a published dataset version', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity).toEqual(IDENTITY);
    expect(result.value.tickers()).toEqual(['ACME', 'GLOBEX']);
    expect(result.value.barsAsOf('ACME', '2026-01-12', 10)).toEqual(SAMPLE_ACME_BARS);
  });

  it('fails closed for an unpublished version, rather than behaving like an empty market', () => {
    const result = createSqliteMarketDataProvider(store, {
      id: SAMPLE_DATASET_ID,
      version: 'nope',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no published version');
  });

  it('fails closed for an unknown dataset id entirely', () => {
    const result = createSqliteMarketDataProvider(store, { id: 'unknown-dataset', version: '1' });
    expect(result.ok).toBe(false);
  });
});

describe('latestKnownDate', () => {
  it('returns the max published date for a ticker', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.latestKnownDate('ACME')).toBe('2026-01-12');
  });

  it('returns null for a ticker this dataset version has no bars for', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.latestKnownDate('NOTREAL')).toBeNull();
  });
});

describe('checkedThroughDate', () => {
  it('returns null for a ticker never confirmed-checked', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.checkedThroughDate('ACME')).toBeNull();
  });

  it('returns the recorded watermark, even past latestKnownDate — a confirmed gap, not a bar', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: '2026-01-21T00:00:00.000Z' },
      ]),
    );
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.latestKnownDate('ACME')).toBe('2026-01-12');
    expect(result.value.checkedThroughDate('ACME')).toBe('2026-01-20');
  });
});

describe('provisionalBar', () => {
  it('returns null for a ticker with no recorded provisional bar', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.provisionalBar('ACME')).toBeNull();
  });

  it('returns the live snapshot, independent of latestKnownDate/checkedThroughDate', () => {
    writeProvisionalBar(
      store,
      IDENTITY,
      'ACME',
      { date: '2026-01-20', open: 10, high: 11, low: 9, close: 10.5, volume: 500 },
      '2026-01-20T15:00:00.000Z',
    );
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.latestKnownDate('ACME')).toBe('2026-01-12');
    expect(result.value.checkedThroughDate('ACME')).toBeNull();
    expect(result.value.provisionalBar('ACME')).toEqual({
      date: '2026-01-20',
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 500,
    });
  });
});

describe('determinism', () => {
  it('two independently-opened providers over the same file return deep-equal results', () => {
    closeMarketDataStore(store);

    const openA = openMarketDataStore(dbPath);
    const openB = openMarketDataStore(dbPath);
    if (!openA.ok || !openB.ok) throw new Error('expected both opens to succeed');

    const providerA = createSqliteMarketDataProvider(openA.value, IDENTITY);
    const providerB = createSqliteMarketDataProvider(openB.value, IDENTITY);
    if (!providerA.ok || !providerB.ok) throw new Error('expected both providers to build');

    expect(providerA.value.barsAsOf('ACME', '2026-01-09', 250)).toEqual(
      providerB.value.barsAsOf('ACME', '2026-01-09', 250),
    );
    expect(providerA.value.corporateActionsAsOf(null, '2026-01-12')).toEqual(
      providerB.value.corporateActionsAsOf(null, '2026-01-12'),
    );

    closeMarketDataStore(openA.value);
    closeMarketDataStore(openB.value);
    // Reopen for the outer afterEach's closeMarketDataStore(store) call to stay a no-op-safe close.
    store = createMarketDataStore(dbPath);
  });

  it('repeated queries never mutate shared state — calling barsAsOf twice returns the same result', () => {
    const providerResult = createSqliteMarketDataProvider(store, IDENTITY);
    if (!providerResult.ok) throw new Error(providerResult.reason);
    const first = providerResult.value.barsAsOf('ACME', '2026-01-12', 250);
    const second = providerResult.value.barsAsOf('ACME', '2026-01-12', 250);
    expect(first).toEqual(second);
  });
});
