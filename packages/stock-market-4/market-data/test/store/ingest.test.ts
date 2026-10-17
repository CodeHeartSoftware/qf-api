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
import { datasetVersionExists, queryBarsAsOf, queryTickers } from '../../src/store/queries.js';
import {
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-ingest-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('publishDatasetVersion', () => {
  it('writes bars, corporate actions, and holidays queryable back out', () => {
    const identity = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };
    const result = publishDatasetVersion(store, identity, SAMPLE_DATASET_INPUT);
    expect(result.ok).toBe(true);

    expect(queryTickers(store, identity)).toEqual(['ACME', 'GLOBEX']);
    expect(queryBarsAsOf(store, identity, 'ACME', '2026-01-12', 10)).toHaveLength(6);
  });

  it('refuses to overwrite an already-published (id, version) — versions are immutable', () => {
    const identity = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };
    expect(publishDatasetVersion(store, identity, SAMPLE_DATASET_INPUT).ok).toBe(true);

    const second = publishDatasetVersion(store, identity, SAMPLE_DATASET_INPUT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('already exists');
  });

  it('allows publishing a second, distinct version of the same dataset id', () => {
    const v1 = { id: SAMPLE_DATASET_ID, version: '1' };
    const v2 = { id: SAMPLE_DATASET_ID, version: '2' };
    expect(publishDatasetVersion(store, v1, SAMPLE_DATASET_INPUT).ok).toBe(true);
    expect(
      publishDatasetVersion(store, v2, {
        ...SAMPLE_DATASET_INPUT,
        bars: { ACME: SAMPLE_DATASET_INPUT.bars.ACME ?? [] },
      }).ok,
    ).toBe(true);

    // v2's corrected data must not affect v1's already-published rows.
    expect(queryTickers(store, v1)).toEqual(['ACME', 'GLOBEX']);
    expect(queryTickers(store, v2)).toEqual(['ACME']);
  });

  it('rolls back entirely on a mid-publish failure, leaving no partial version', () => {
    const identity = { id: 'broken-dataset', version: '1' };
    const result = publishDatasetVersion(store, identity, {
      bars: {},
      // An invalid corporate-action type value would violate the SQL CHECK constraint.
      corporateActions: [
        { type: 'CASH_DIVIDEND' as const, ticker: 'ACME', date: '2026-01-01', perShare: 1 },
        // @ts-expect-error deliberately malformed to exercise the rollback path
        { type: 'NOT_A_REAL_TYPE', ticker: 'ACME', date: '2026-01-02' },
      ],
    });
    expect(result.ok).toBe(false);
    // The whole transaction rolls back, including the dataset_versions row itself — not just
    // the bars/actions tables — so a failed publish never leaves a half-published version behind.
    expect(datasetVersionExists(store, identity)).toBe(false);
  });
});
