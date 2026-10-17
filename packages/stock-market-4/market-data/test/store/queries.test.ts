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
  queryBarsAsOf,
  queryCheckedThroughDate,
  queryCorporateActionsAsOf,
  queryLatestKnownDate,
  queryTradingHolidays,
} from '../../src/store/queries.js';
import { renderCheckedThroughSql } from '../../src/store/sqlGen.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
  SAMPLE_TRADING_HOLIDAYS,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-queries-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

// These mirror games/stock-market-4/test/market/historicalPrices.test.ts's own assertions on
// `historicalBarsAsOf`, proving this package's SQL-backed query is semantically a drop-in
// replacement, not a parallel reimplementation with subtly different edge-case behavior.
describe('queryBarsAsOf', () => {
  it('returns every bar at or before the given date, oldest first', () => {
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-06', 10)).toEqual([
      SAMPLE_ACME_BARS[0],
      SAMPLE_ACME_BARS[1],
      SAMPLE_ACME_BARS[2],
    ]);
  });

  it('never includes a bar dated after the given date, even though the full series is stored', () => {
    const result = queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-06', 100);
    expect(result.some((bar) => bar.date > '2026-01-06')).toBe(false);
  });

  it('caps the window to the trailing maxDays', () => {
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-12', 2)).toEqual([
      SAMPLE_ACME_BARS[4],
      SAMPLE_ACME_BARS[5],
    ]);
  });

  it('is empty when the date is before every bar in the series', () => {
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2025-12-01', 10)).toEqual([]);
  });

  it('reflects a genuine data gap (no bar for 2026-01-07) rather than carrying a prior close forward', () => {
    const bars = queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-07', 10);
    expect(bars.at(-1)?.date).toBe('2026-01-06');
  });

  it('is empty for a ticker with no bars in this dataset version', () => {
    expect(queryBarsAsOf(store, IDENTITY, 'NOTREAL', '2026-01-12', 10)).toEqual([]);
  });
});

describe('queryCorporateActionsAsOf', () => {
  it('makes an action visible starting exactly on its own date (no announcedDate given)', () => {
    expect(queryCorporateActionsAsOf(store, IDENTITY, 'ACME', '2026-01-08')).toEqual([]);
    expect(queryCorporateActionsAsOf(store, IDENTITY, 'ACME', '2026-01-09')).toEqual([
      { type: 'STOCK_SPLIT', ticker: 'ACME', date: '2026-01-09', fromShares: 1, toShares: 2 },
    ]);
  });

  it('scopes to one ticker when given, or returns every ticker when null', () => {
    expect(queryCorporateActionsAsOf(store, IDENTITY, 'GLOBEX', '2026-01-12')).toEqual([
      { type: 'CASH_DIVIDEND', ticker: 'GLOBEX', date: '2026-01-08', perShare: 0.25 },
    ]);
    expect(queryCorporateActionsAsOf(store, IDENTITY, null, '2026-01-12')).toHaveLength(2);
  });

  it('never returns an action dated after asOfDate', () => {
    expect(queryCorporateActionsAsOf(store, IDENTITY, null, '2026-01-01')).toEqual([]);
  });
});

describe('queryTradingHolidays', () => {
  it('returns every organizer-declared holiday for this dataset version', () => {
    expect(queryTradingHolidays(store, IDENTITY)).toEqual(SAMPLE_TRADING_HOLIDAYS);
  });
});

describe('queryLatestKnownDate', () => {
  it('returns the max date across every bar recorded for a ticker', () => {
    expect(queryLatestKnownDate(store, IDENTITY, 'ACME')).toBe('2026-01-12');
  });

  it('returns null for a ticker with no bars in this dataset version', () => {
    expect(queryLatestKnownDate(store, IDENTITY, 'NOTREAL')).toBeNull();
  });

  it('does not let one dataset version leak its max date into another', () => {
    const v2 = { id: SAMPLE_DATASET_ID, version: '2-partial' };
    const publishResult = publishDatasetVersion(store, v2, {
      bars: { ACME: SAMPLE_ACME_BARS.slice(0, 1) },
    });
    if (!publishResult.ok) throw new Error(publishResult.reason);

    expect(queryLatestKnownDate(store, v2, 'ACME')).toBe('2026-01-02');
    expect(queryLatestKnownDate(store, IDENTITY, 'ACME')).toBe('2026-01-12');
  });
});

describe('queryCheckedThroughDate', () => {
  it('returns null for a ticker never confirmed-checked', () => {
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBeNull();
  });

  it('returns the watermark after one is recorded', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: '2026-01-21T00:00:00.000Z' },
      ]),
    );
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-20');
  });

  it('advances on a later, later-dated watermark', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: 'a' },
      ]),
    );
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-25', checkedAt: 'b' },
      ]),
    );
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-25');
  });

  it('never regresses to an earlier watermark', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: 'a' },
      ]),
    );
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-10', checkedAt: 'b' },
      ]),
    );
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-20');
  });
});

describe('dataset version isolation', () => {
  it('two versions of the same dataset id never leak rows into each other', () => {
    const v2 = { id: SAMPLE_DATASET_ID, version: '2-corrected' };
    const correctedBar = {
      date: '2026-01-02',
      open: 999,
      high: 999,
      low: 999,
      close: 999,
      volume: 1,
    };
    const publishResult = publishDatasetVersion(store, v2, {
      bars: { ACME: [correctedBar] },
    });
    if (!publishResult.ok) throw new Error(publishResult.reason);

    // v1's original bar is untouched by v2's "correction".
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-02', 10)).toEqual([SAMPLE_ACME_BARS[0]]);
    expect(queryBarsAsOf(store, v2, 'ACME', '2026-01-02', 10)).toEqual([correctedBar]);
  });

  it('two distinct dataset ids sharing one store file, with an overlapping ticker name, never cross-contaminate', () => {
    // The schema scopes every row by dataset_id, not just by file — this proves the SQL
    // predicate itself does the isolating, not merely "different datasets happen to live in
    // different files."
    const otherIdentity = { id: 'other-dataset', version: '1' };
    const otherBar = { date: '2026-01-02', open: 1, high: 1, low: 1, close: 1, volume: 1 };
    const publishResult = publishDatasetVersion(store, otherIdentity, {
      bars: { ACME: [otherBar] },
    });
    if (!publishResult.ok) throw new Error(publishResult.reason);

    expect(queryBarsAsOf(store, otherIdentity, 'ACME', '2026-01-02', 10)).toEqual([otherBar]);
    // The original dataset's own ACME series (same ticker name, different dataset id) is unaffected.
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-02', 10)).toEqual([SAMPLE_ACME_BARS[0]]);
  });
});
