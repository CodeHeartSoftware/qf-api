import type { CorporateAction } from '../../src/schema/corporateAction.js';
import type { DailyBar } from '../../src/schema/dailyBar.js';
import type { DatasetVersionInput } from '../../src/store/ingest.js';

/**
 * A small, hand-authored, two-ticker synthetic proof dataset — NOT a transcription of the real
 * `bots/stock-market-4/fusion-fundamental-v0` fixtures (ALM/ELMT/FREEM/FUR/VITZ). Those bot-side
 * files live under `bots/**`, which is deliberately excluded from the Yarn workspace graph
 * (ADR-0008), so this package cannot depend on them; transcribing them into a package-owned
 * fixture is left as a follow-up once that's actually needed (e.g. wiring the fusion bot itself
 * to this package), rather than done speculatively here.
 *
 * This fixture exists to exercise every mechanic `queries.ts`/`provider.ts` need to prove: two
 * tickers, a gap day, a STOCK_SPLIT (to prove split-timing doesn't leak backward), and a
 * CASH_DIVIDEND.
 */

function bar(date: string, close: number, volume = 1000): DailyBar {
  return { date, open: close, high: close, low: close, close, volume };
}

export const SAMPLE_DATASET_ID = 'sample-proof-dataset';
export const SAMPLE_DATASET_VERSION = '1';

export const SAMPLE_ACME_BARS: DailyBar[] = [
  bar('2026-01-02', 100),
  bar('2026-01-05', 101),
  bar('2026-01-06', 102),
  // 2026-01-07 deliberately missing — a genuine data gap.
  bar('2026-01-08', 104),
  bar('2026-01-09', 52), // post 2-for-1 split, effective today
  bar('2026-01-12', 53),
];

export const SAMPLE_GLOBEX_BARS: DailyBar[] = [
  bar('2026-01-02', 50),
  bar('2026-01-05', 50.5),
  bar('2026-01-06', 51),
  bar('2026-01-07', 51.2),
  bar('2026-01-08', 51.5),
  bar('2026-01-09', 51.7),
  bar('2026-01-12', 52),
];

export const SAMPLE_CORPORATE_ACTIONS: CorporateAction[] = [
  { type: 'STOCK_SPLIT', ticker: 'ACME', date: '2026-01-09', fromShares: 1, toShares: 2 },
  { type: 'CASH_DIVIDEND', ticker: 'GLOBEX', date: '2026-01-08', perShare: 0.25 },
];

export const SAMPLE_TRADING_HOLIDAYS = ['2026-01-01'];

export const SAMPLE_DATASET_INPUT: DatasetVersionInput = {
  description: 'Small synthetic dataset for market-data package tests.',
  bars: { ACME: SAMPLE_ACME_BARS, GLOBEX: SAMPLE_GLOBEX_BARS },
  corporateActions: SAMPLE_CORPORATE_ACTIONS,
  tradingHolidays: SAMPLE_TRADING_HOLIDAYS,
};
