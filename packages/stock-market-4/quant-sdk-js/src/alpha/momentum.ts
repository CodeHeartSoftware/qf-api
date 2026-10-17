import type { DailyBar } from '../marketTypes.js';
import { computeTrailingReturn } from '../signal.js';
import type { AlphaSignal } from './types.js';

/**
 * The one genuinely NEW alpha this bot adds beyond what `fusion-fundamental-v7` already computed
 * (plan Phase 1, item 2): a plain trailing-return momentum signal, reusing
 * `fusion-fundamental-v7`'s own `computeTrailingReturn` (kept unchanged in `../signal.ts`) rather
 * than re-deriving trailing-return math. Deliberately the ONLY alpha classified as "price, not
 * research" by `../ablation.ts` — the null-research/price-only ablation modes are built around
 * this alpha being the one thing that survives zeroing every research-derived factor.
 *
 * `confidence` scales with how much of the requested window is actually available — a security's
 * first few rounds (or a newly re-listed one) has less basis to trust a "windowDays-day" return
 * than one with a full window of real history, but a PARTIAL window is still real information, not
 * nothing (never `0` just because history is short of the ideal length, only when there's truly
 * nothing, i.e. `computeTrailingReturn` itself returns `undefined`).
 */
export function computeMomentumAlpha(params: {
  ticker: string;
  date: string | null;
  priceHistory: DailyBar[];
  currentPriceDollars: number;
  windowDays: number;
}): AlphaSignal {
  const trailingReturn = computeTrailingReturn(
    params.priceHistory,
    params.currentPriceDollars,
    params.windowDays,
  );
  if (trailingReturn === undefined) {
    return {
      factor: 'momentum',
      ticker: params.ticker,
      date: params.date,
      value: 0,
      confidence: 0,
    };
  }
  const coverage = Math.min(1, params.priceHistory.length / params.windowDays);
  return {
    factor: 'momentum',
    ticker: params.ticker,
    date: params.date,
    value: trailingReturn,
    confidence: 0.5 * coverage,
  };
}
