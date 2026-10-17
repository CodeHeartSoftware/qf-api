import type { MarketImpliedGap } from '../valuation/types.js';
import type { AlphaSignal } from './types.js';

/** Scales `MarketImpliedGap.gap` (a 0-1-unit domain-defined quantity's difference, see a domain
 * bot's own valuation inversion, e.g. quant-v0's `valuation/marketImplied.ts`) into an
 * expected-return-fraction unit — illustrative, not swept/tuned, same discipline as every other
 * alpha's own scale constant. */
export const MARKET_IMPLIED_SCALE = 0.3;

/**
 * Reverse-engineers what the CURRENT price already assumes (a domain bot's own value-chain
 * inversion, fed in as `marketImplied`) into its own alpha: a positive `gap` means the market
 * prices in LESS domain success than this strategy's own base-case assumption (a bullish
 * asymmetric-upside case); negative means the market already prices in MORE. `undefined` (no
 * modeled domain value chain to invert for this security) means this alpha is silent, not
 * zero-confidently bearish or bullish.
 */
export function computeMarketImpliedAlpha(params: {
  ticker: string;
  date: string | null;
  marketImplied: MarketImpliedGap | undefined;
}): AlphaSignal {
  if (params.marketImplied === undefined) {
    return {
      factor: 'market_implied',
      ticker: params.ticker,
      date: params.date,
      value: 0,
      confidence: 0,
    };
  }
  const value = params.marketImplied.gap * MARKET_IMPLIED_SCALE;
  // A finding OUTSIDE this strategy's own modeled bear/bull range is a stronger, more surprising
  // signal than one merely inside it (spec §39's "valuation blindness" case, carried over from
  // fusion-fundamental-v7) — reflected here as higher confidence, not a different sign/magnitude.
  const confidence = params.marketImplied.gapVsRange === 'within_range' ? 0.4 : 0.8;
  return { factor: 'market_implied', ticker: params.ticker, date: params.date, value, confidence };
}
