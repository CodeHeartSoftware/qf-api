import type { AlphaSignal } from './types.js';

/**
 * The classic "model fair value vs. market price" alpha, reusing `fusion-fundamental-v7`'s
 * `computeCompanyValuation`/`computeFusionValue` output (unchanged in this bot — see
 * `../decision.ts`, which computes `fairValuePerShare` the same way that bot's `decision.ts` did)
 * rather than re-deriving fair value here. `confidence` is a fixed, deliberately moderate constant
 * — NOT derived from the gap's own size (a huge, unqualified gap isn't more trustworthy just for
 * being huge) — since this alpha's real uncertainty is already reflected in whatever weight `ic.ts`
 * ends up measuring for it historically, not in a per-round confidence guess.
 */
export const VALUATION_GAP_CONFIDENCE = 0.6;

export function computeValuationGapAlpha(params: {
  ticker: string;
  date: string | null;
  fairValuePerShare: number;
  marketPriceDollars: number;
}): AlphaSignal {
  if (params.marketPriceDollars <= 0) {
    return {
      factor: 'valuation_gap',
      ticker: params.ticker,
      date: params.date,
      value: 0,
      confidence: 0,
    };
  }
  const gap = params.fairValuePerShare / params.marketPriceDollars - 1;
  return {
    factor: 'valuation_gap',
    ticker: params.ticker,
    date: params.date,
    value: gap,
    confidence: VALUATION_GAP_CONFIDENCE,
  };
}
