import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendBars } from '../../src/store/append.js';
import {
  closeMarketDataStore,
  createMarketDataStore,
  type MarketDataStore,
} from '../../src/store/db.js';
import { publishDatasetVersion } from '../../src/store/ingest.js';
import { queryBarsAsOf, queryLatestKnownDate } from '../../src/store/queries.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

function bar(date: string, close: number, volume = 1000) {
  return { date, open: close, high: close, low: close, close, volume };
}

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-append-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('appendBars', () => {
  it('extends an already-published version with rows queryable back out', () => {
    const result = appendBars(store, IDENTITY, { bars: { ACME: [bar('2026-01-13', 54)] } });
    expect(result.ok).toBe(true);
    expect(queryLatestKnownDate(store, IDENTITY, 'ACME')).toBe('2026-01-13');
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-13', 10)).toEqual([
      ...SAMPLE_ACME_BARS,
      bar('2026-01-13', 54),
    ]);
  });

  it('fails closed against a dataset version that was never published', () => {
    const result = appendBars(
      store,
      { id: SAMPLE_DATASET_ID, version: 'nope' },
      {
        bars: { ACME: [bar('2026-01-13', 54)] },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('never been published');
  });

  it("rejects a bar dated at or before the ticker's current latest known date", () => {
    const result = appendBars(store, IDENTITY, { bars: { ACME: [bar('2026-01-12', 999)] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already known through 2026-01-12');
    // Rejected — the existing row must be untouched, not silently overwritten.
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-12', 1)).toEqual([
      { date: '2026-01-12', open: 53, high: 53, low: 53, close: 53, volume: 1000 },
    ]);
  });

  it('rolls back the whole batch if any ticker in it would violate the append rule', () => {
    const result = appendBars(store, IDENTITY, {
      bars: {
        // GLOBEX's append is valid on its own...
        GLOBEX: [bar('2026-01-13', 53)],
        // ...but ACME's is not — the whole call must roll back, not partially apply.
        ACME: [bar('2026-01-01', 1)],
      },
    });
    expect(result.ok).toBe(false);
    expect(queryLatestKnownDate(store, IDENTITY, 'GLOBEX')).toBe('2026-01-12');
  });

  it('introduces a brand-new ticker within an existing version', () => {
    expect(queryLatestKnownDate(store, IDENTITY, 'NEWCO')).toBeNull();
    const result = appendBars(store, IDENTITY, { bars: { NEWCO: [bar('2026-01-13', 10)] } });
    expect(result.ok).toBe(true);
    expect(queryLatestKnownDate(store, IDENTITY, 'NEWCO')).toBe('2026-01-13');
  });

  it('composes across two sequential calls into one continuous series', () => {
    expect(appendBars(store, IDENTITY, { bars: { ACME: [bar('2026-01-13', 54)] } }).ok).toBe(true);
    expect(appendBars(store, IDENTITY, { bars: { ACME: [bar('2026-01-14', 55)] } }).ok).toBe(true);
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-14', 10)).toEqual([
      ...SAMPLE_ACME_BARS,
      bar('2026-01-13', 54),
      bar('2026-01-14', 55),
    ]);
  });

  it('never lets an append to one version affect another version of the same dataset id', () => {
    const v2 = { id: SAMPLE_DATASET_ID, version: '2' };
    const published = publishDatasetVersion(store, v2, { bars: { ACME: [bar('2026-01-02', 1)] } });
    if (!published.ok) throw new Error(published.reason);

    expect(appendBars(store, v2, { bars: { ACME: [bar('2026-01-03', 2)] } }).ok).toBe(true);
    expect(queryLatestKnownDate(store, v2, 'ACME')).toBe('2026-01-03');
    // v1 (IDENTITY) is untouched by v2's append.
    expect(queryLatestKnownDate(store, IDENTITY, 'ACME')).toBe('2026-01-12');
  });
});
