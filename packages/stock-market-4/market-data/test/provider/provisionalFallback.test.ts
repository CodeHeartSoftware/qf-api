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
import { writeProvisionalBar } from '../../src/store/provisional.js';
import { createSqliteMarketDataProvider } from '../../src/provider/provider.js';
import { withProvisionalFallback } from '../../src/provider/provisionalFallback.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };
const PROVISIONAL_BAR = {
  date: '2026-01-20',
  open: 30,
  high: 31,
  low: 29,
  close: 30.5,
  volume: 777,
};

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-provisional-fallback-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

function realProvider() {
  const result = createSqliteMarketDataProvider(store, IDENTITY);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('withProvisionalFallback', () => {
  it('leaves latestKnownDate/barsAsOf untouched when there is no provisional bar', () => {
    const wrapped = withProvisionalFallback(realProvider());
    expect(wrapped.latestKnownDate('ACME')).toBe('2026-01-12');
    expect(wrapped.barsAsOf('ACME', '2026-01-12', 100)).toEqual(SAMPLE_ACME_BARS);
  });

  it("advances latestKnownDate to the provisional bar's date when it is later", () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', PROVISIONAL_BAR, '2026-01-20T15:00:00.000Z');
    const wrapped = withProvisionalFallback(realProvider());
    expect(wrapped.latestKnownDate('ACME')).toBe('2026-01-20');
  });

  it('appends the provisional bar to barsAsOf when asOfDate reaches it', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', PROVISIONAL_BAR, '2026-01-20T15:00:00.000Z');
    const wrapped = withProvisionalFallback(realProvider());
    expect(wrapped.barsAsOf('ACME', '2026-01-20', 100)).toEqual([
      ...SAMPLE_ACME_BARS,
      PROVISIONAL_BAR,
    ]);
  });

  it('never leaks the provisional bar into a query for an EARLIER asOfDate', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', PROVISIONAL_BAR, '2026-01-20T15:00:00.000Z');
    const wrapped = withProvisionalFallback(realProvider());
    expect(wrapped.barsAsOf('ACME', '2026-01-12', 100)).toEqual(SAMPLE_ACME_BARS);
  });

  it('respects maxDays when appending the provisional bar', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', PROVISIONAL_BAR, '2026-01-20T15:00:00.000Z');
    const wrapped = withProvisionalFallback(realProvider());
    const result = wrapped.barsAsOf('ACME', '2026-01-20', 2);
    expect(result).toHaveLength(2);
    expect(result.at(-1)).toEqual(PROVISIONAL_BAR);
  });

  it('the ORIGINAL provider is completely unaffected — this is a read-only decorator', () => {
    writeProvisionalBar(store, IDENTITY, 'ACME', PROVISIONAL_BAR, '2026-01-20T15:00:00.000Z');
    const real = realProvider();
    withProvisionalFallback(real);
    expect(real.latestKnownDate('ACME')).toBe('2026-01-12');
    expect(real.barsAsOf('ACME', '2026-01-20', 100)).toEqual(SAMPLE_ACME_BARS);
  });
});
