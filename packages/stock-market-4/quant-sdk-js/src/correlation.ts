import type { DailyBar } from './marketTypes.js';

/** v6-only: trailing daily returns over the window — the same per-security series
 * `signal.ts`'s volatility/confidence helpers compute internally, exposed here for cross-security
 * comparison (a single security's own return series means nothing on its own; correlation needs
 * two of them, computed at the multi-security orchestration level — see `decision.ts`'s
 * `computeTradingDecisions`, the only caller with visibility into every tracked security's history
 * at once). */
export function computeReturnsSeries(history: DailyBar[], windowDays: number): number[] {
  const closes = history.slice(-windowDays).map((bar) => bar.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const close = closes[i];
    const previousClose = closes[i - 1];
    if (close === undefined || previousClose === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
    returns.push(close / previousClose - 1);
  }
  return returns;
}

/** Standard Pearson correlation coefficient between two real daily-return series, using only
 * their overlapping trailing window. Returns `undefined` when there are fewer than 2 overlapping
 * returns, or either series has zero variance (a flat/degenerate series — correlation is
 * undefined, not zero, in that case). */
export function computePearsonCorrelation(a: number[], b: number[]): number | undefined {
  const n = Math.min(a.length, b.length);
  if (n < 2) return undefined;
  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const meanA = aSlice.reduce((sum, v) => sum + v, 0) / n;
  const meanB = bSlice.reduce((sum, v) => sum + v, 0) / n;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const a1 = aSlice[i];
    const b1 = bSlice[i];
    if (a1 === undefined || b1 === undefined) continue; // unreachable given n = min(a.length, b.length); satisfies noUncheckedIndexedAccess
    const da = a1 - meanA;
    const db = b1 - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 || varianceB === 0) return undefined;
  return covariance / Math.sqrt(varianceA * varianceB);
}

/**
 * v6-only: a real-world portfolio-construction practice — avoid sizing several highly-correlated
 * positions each as if they were independent bets, since several tungsten/fusion-supply-chain
 * names moving together is really ONE concentrated bet wearing multiple tickers, not genuine
 * diversification. For each ticker, computes its average correlation against every OTHER ticker's
 * own real trailing returns, then maps that to a size-scaling factor: uncorrelated (avg 0) or
 * NEGATIVELY correlated (avg < 0) keeps the full target — an anti-correlated pair is a real hedge,
 * a diversification BENEFIT, not a concentration risk, so it is deliberately never penalized here
 * (only positive correlation is averaged in; a negative correlation contributes 0, not a negative
 * number that would otherwise cancel out a genuinely concentrated OTHER pairing). Only positive
 * average correlation (toward 1) scales down toward `minScaleFactor`, at a rate set by
 * `concentrationPenalty`. Only ever scales DOWN, never up — being uncorrelated or hedged isn't a
 * reason to size UP a position, only being redundant with the rest of the book is a reason to
 * size DOWN.
 */
export function computeCorrelationScaleFactors(
  returnsByTicker: Map<string, number[]>,
  concentrationPenalty: number,
  minScaleFactor: number,
): Map<string, number> {
  const scaleByTicker = new Map<string, number>();
  for (const [ticker, returns] of returnsByTicker) {
    const positiveCorrelations: number[] = [];
    for (const [otherTicker, otherReturns] of returnsByTicker) {
      if (otherTicker === ticker) continue;
      const correlation = computePearsonCorrelation(returns, otherReturns);
      if (correlation !== undefined) positiveCorrelations.push(Math.max(0, correlation));
    }
    const avgPositiveCorrelation =
      positiveCorrelations.length > 0
        ? positiveCorrelations.reduce((sum, c) => sum + c, 0) / positiveCorrelations.length
        : 0;
    scaleByTicker.set(
      ticker,
      Math.max(minScaleFactor, 1 - avgPositiveCorrelation * concentrationPenalty),
    );
  }
  return scaleByTicker;
}
