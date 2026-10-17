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
  queryTickers,
  queryTradingHolidays,
} from '../../src/store/queries.js';
import {
  renderAppendBarsSql,
  renderCheckedThroughSql,
  renderPublishDatasetVersionSql,
} from '../../src/store/sqlGen.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
  SAMPLE_GLOBEX_BARS,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

function bar(date: string, close: number, volume = 1000) {
  return { date, open: close, high: close, low: close, close, volume };
}

let dir: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-sqlgen-test-'));
  store = createMarketDataStore(join(dir, 'dataset.sqlite'));
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('renderPublishDatasetVersionSql', () => {
  it('produces SQL that publishes a dataset identical to a direct publishDatasetVersion call', () => {
    const sql = renderPublishDatasetVersionSql(
      IDENTITY,
      SAMPLE_DATASET_INPUT,
      '2026-01-01T00:00:00Z',
    );
    store.db.exec(sql);

    expect(queryTickers(store, IDENTITY)).toEqual(['ACME', 'GLOBEX']);
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-12', 10)).toEqual(SAMPLE_ACME_BARS);
    expect(queryBarsAsOf(store, IDENTITY, 'GLOBEX', '2026-01-12', 10)).toEqual(SAMPLE_GLOBEX_BARS);
    // `queryCorporateActionsAsOf` orders by date ASC, not input array order — GLOBEX's
    // 2026-01-08 dividend precedes ACME's 2026-01-09 split.
    expect(queryCorporateActionsAsOf(store, IDENTITY, null, '2026-01-12')).toEqual(
      [...(SAMPLE_DATASET_INPUT.corporateActions ?? [])].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    expect(queryTradingHolidays(store, IDENTITY)).toEqual(['2026-01-01']);
  });

  it('fails the second migration (duplicate id/version) at apply time via the PRIMARY KEY, not silently', () => {
    const sql = renderPublishDatasetVersionSql(
      IDENTITY,
      SAMPLE_DATASET_INPUT,
      '2026-01-01T00:00:00Z',
    );
    store.db.exec(sql);
    expect(() => {
      store.db.exec(sql);
    }).toThrow();
  });
});

describe('renderAppendBarsSql', () => {
  beforeEach(() => {
    const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
    if (!result.ok) throw new Error(result.reason);
  });

  it('produces SQL that extends an already-published version with rows queryable back out', () => {
    const rendered = renderAppendBarsSql(store, IDENTITY, {
      bars: { ACME: [bar('2026-01-13', 54)] },
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value);

    expect(queryLatestKnownDate(store, IDENTITY, 'ACME')).toBe('2026-01-13');
    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-13', 10)).toEqual([
      ...SAMPLE_ACME_BARS,
      bar('2026-01-13', 54),
    ]);
  });

  it('fails closed (no SQL rendered) against a dataset version that was never published', () => {
    const rendered = renderAppendBarsSql(
      store,
      { id: SAMPLE_DATASET_ID, version: 'nope' },
      { bars: { ACME: [bar('2026-01-13', 54)] } },
    );
    expect(rendered.ok).toBe(false);
    if (!rendered.ok) expect(rendered.reason).toContain('never been published');
  });

  it("refuses (no SQL rendered) for a bar dated at or before the ticker's current latest known date", () => {
    const rendered = renderAppendBarsSql(store, IDENTITY, {
      bars: { ACME: [bar('2026-01-12', 999)] },
    });
    expect(rendered.ok).toBe(false);
    if (!rendered.ok) expect(rendered.reason).toContain('already known through 2026-01-12');
  });

  it('accepts a genuinely new ticker with no prior bars in this dataset version (add:new-ticker relies on this)', () => {
    const rendered = renderAppendBarsSql(store, IDENTITY, {
      bars: { NVDA: [bar('2026-01-10', 100), bar('2026-01-13', 105)] },
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value);

    expect(queryLatestKnownDate(store, IDENTITY, 'NVDA')).toBe('2026-01-13');
    expect(queryBarsAsOf(store, IDENTITY, 'NVDA', '2026-01-13', 10)).toEqual([
      bar('2026-01-10', 100),
      bar('2026-01-13', 105),
    ]);
  });

  it('composes across two sequentially-generated migrations into one continuous series', () => {
    const first = renderAppendBarsSql(store, IDENTITY, { bars: { ACME: [bar('2026-01-13', 54)] } });
    if (!first.ok) throw new Error(first.reason);
    store.db.exec(first.value);

    const second = renderAppendBarsSql(store, IDENTITY, {
      bars: { ACME: [bar('2026-01-14', 55)] },
    });
    if (!second.ok) throw new Error(second.reason);
    store.db.exec(second.value);

    expect(queryBarsAsOf(store, IDENTITY, 'ACME', '2026-01-14', 10)).toEqual([
      ...SAMPLE_ACME_BARS,
      bar('2026-01-13', 54),
      bar('2026-01-14', 55),
    ]);
  });
});

describe('renderCheckedThroughSql', () => {
  beforeEach(() => {
    const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
    if (!result.ok) throw new Error(result.reason);
  });

  it('records a fresh watermark for a ticker never checked before', () => {
    const sql = renderCheckedThroughSql(IDENTITY, [
      { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: '2026-01-21T00:00:00.000Z' },
    ]);
    store.db.exec(sql);
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-20');
  });

  it('advances an existing watermark to a later date', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: 'a' },
      ]),
    );
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-22', checkedAt: 'b' },
      ]),
    );
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-22');
  });

  it('refuses to regress an existing watermark to an earlier date', () => {
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-20', checkedAt: 'a' },
      ]),
    );
    store.db.exec(
      renderCheckedThroughSql(IDENTITY, [
        { ticker: 'ACME', checkedThroughDate: '2026-01-05', checkedAt: 'b' },
      ]),
    );
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-20');
  });

  it('composes across two sequentially-generated migrations, like renderAppendBarsSql', () => {
    const first = renderCheckedThroughSql(IDENTITY, [
      { ticker: 'ACME', checkedThroughDate: '2026-01-13', checkedAt: 'a' },
    ]);
    store.db.exec(first);
    const second = renderCheckedThroughSql(IDENTITY, [
      { ticker: 'ACME', checkedThroughDate: '2026-01-14', checkedAt: 'b' },
    ]);
    store.db.exec(second);
    expect(queryCheckedThroughDate(store, IDENTITY, 'ACME')).toBe('2026-01-14');
  });
});
