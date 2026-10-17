import { createMarketDataStore, queryBarsAsOf, queryTickers } from '@quant-fusion/market-data';
import type { DailyBar } from '@quant-fusion/quant-sdk-js';

/** The dataset every in-process backtest replays — the same committed `@quant-fusion/market-data`
 * migrations a real match reads, so the harness can never drift from the game's own data (it used
 * to replay hand-copied `*HistoricalPrices.ts` files). Version 4 = Yahoo Finance, 2026-01-02 onward. */
export const BACKTEST_DATASET = { id: 'fusion-fundamental-v0', version: '4' } as const;

/**
 * Every ticker's full bar series from `dataset`, oldest first. Builds an in-memory store by
 * replaying every committed migration — no database file needed, deterministic, and exactly what
 * `fetchAndAppendBars.ts`/`fetchAndPublishVersion.ts` treat as the current state.
 */
export function loadPriceSeriesFromMarketData(
  dataset: { id: string; version: string } = BACKTEST_DATASET,
): Record<string, DailyBar[]> {
  const store = createMarketDataStore(':memory:');
  try {
    const tickers = queryTickers(store, dataset);
    if (tickers.length === 0) throw new Error(`market-data has no bars for dataset "${dataset.id}" version "${dataset.version}"`);
    return Object.fromEntries(
      tickers.map((ticker) => [ticker, queryBarsAsOf(store, dataset, ticker, '9999-12-31', Number.POSITIVE_INFINITY)]),
    );
  } finally {
    store.db.close();
  }
}
