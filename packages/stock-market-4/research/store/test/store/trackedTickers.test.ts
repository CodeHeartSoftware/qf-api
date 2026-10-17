import { describe, expect, it } from 'vitest';
import { createResearchStore } from '../../src/store/db.js';
import {
  listTrackedTickers,
  renderAddTrackedTickerSql,
  renderRemoveTrackedTickerSql,
} from '../../src/store/trackedTickers.js';

const FUSION_DATASET_ID = 'dataset-fusion-2026-09';

describe('listTrackedTickers', () => {
  it('lists the real, migration-seeded fusion watchlist', () => {
    const store = createResearchStore(':memory:');
    const tickers = listTrackedTickers(store, FUSION_DATASET_ID).map((t) => t.ticker);
    expect(tickers).toContain('ELMT');
    expect(tickers).toContain('AMSC');
    expect(tickers.length).toBe(11);
  });

  it('is empty for a domain with no tracked tickers (e.g. quantum)', () => {
    const store = createResearchStore(':memory:');
    expect(listTrackedTickers(store, 'dataset-quantum-skeleton')).toEqual([]);
  });
});

describe('renderAddTrackedTickerSql', () => {
  it('renders an INSERT for a new ticker', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderAddTrackedTickerSql(
      store,
      FUSION_DATASET_ID,
      'NVDA',
      'NVIDIA',
      '2026-09-19T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('INSERT INTO tracked_tickers');
    expect(rendered.value).toContain('NVDA');
    expect(rendered.value).toContain('NVIDIA');
  });

  it('refuses a ticker already tracked for this domain (case-insensitive)', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderAddTrackedTickerSql(
      store,
      FUSION_DATASET_ID,
      'elmt',
      'ELMT',
      '2026-09-19T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses a blank ticker or company name', () => {
    const store = createResearchStore(':memory:');
    expect(
      renderAddTrackedTickerSql(store, FUSION_DATASET_ID, '  ', 'X', '2026-09-19T00:00:00Z').ok,
    ).toBe(false);
    expect(
      renderAddTrackedTickerSql(store, FUSION_DATASET_ID, 'X', '  ', '2026-09-19T00:00:00Z').ok,
    ).toBe(false);
  });
});

describe('renderRemoveTrackedTickerSql', () => {
  it('renders a DELETE for an existing ticker', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderRemoveTrackedTickerSql(store, FUSION_DATASET_ID, 'ELMT');
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('DELETE FROM tracked_tickers');
    expect(rendered.value).toContain('ELMT');
  });

  it('refuses a ticker that is not currently tracked', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderRemoveTrackedTickerSql(store, FUSION_DATASET_ID, 'NOPE');
    expect(rendered.ok).toBe(false);
  });
});
