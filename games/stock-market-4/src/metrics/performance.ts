import type { CalendarDate, DailyBar, EquityPoint, PerformanceMetrics } from '../types.js';

/** Same convention as `portfolio/borrow.ts`'s daily borrow-fee rate — one round is one trading
 * day, so this is what annualizes a per-round figure. */
const TRADING_DAYS_PER_YEAR = 252;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator) — the conventional choice for a return series,
 * which is itself a sample of the strategy's behavior, not its entire population. `0` for fewer
 * than 2 values, since a single value has no variance to speak of. */
function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** One fractional return per consecutive pair of equity readings — the input every metric below
 * is built from. Skips (rather than divides by zero on) a pair whose starting value is 0. */
export function periodReturns(equityCents: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCents.length; i++) {
    const previous = equityCents[i - 1];
    const current = equityCents[i];
    if (previous === undefined || current === undefined || previous === 0) continue;
    returns.push((current - previous) / previous);
  }
  return returns;
}

/** Fractional return from the first equity reading to the last — `0` for a curve with fewer than
 * two points or a zero starting value, since there's nothing to compare. */
export function totalReturn(equityCents: readonly number[]): number {
  const first = equityCents[0];
  const last = equityCents.at(-1);
  if (first === undefined || last === undefined || first === 0) return 0;
  return (last - first) / first;
}

/** Largest peak-to-trough decline anywhere in the curve, as a non-negative fraction of the peak
 * at that point (spec §22) — tracks a running peak rather than checking every pair, so this is
 * O(n) regardless of how many points the curve has. */
export function maxDrawdown(equityCents: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const equity of equityCents) {
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = (peak - equity) / peak;
      if (drawdown > worst) worst = drawdown;
    }
  }
  return worst;
}

/** Annualized volatility of `returns` (each assumed to be one trading day) — sample standard
 * deviation scaled by `sqrt(252)`, the standard square-root-of-time convention. */
export function annualizedVolatility(returns: readonly number[]): number {
  return sampleStdDev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** `(annualized mean return - annualRiskFreeRate) / annualized volatility` — `null` when
 * volatility is 0 (a perfectly flat return series, e.g. no trades at all), since the ratio is
 * undefined at that point rather than meaningfully zero or infinite. */
export function sharpeRatio(returns: readonly number[], annualRiskFreeRate: number): number | null {
  const volatility = annualizedVolatility(returns);
  if (volatility === 0) return null;
  const annualizedReturn = mean(returns) * TRADING_DAYS_PER_YEAR;
  return (annualizedReturn - annualRiskFreeRate) / volatility;
}

/** The full `PerformanceMetrics` for one participant's equity curve — see each function above
 * for what it computes; this just assembles them, plus derives `periodReturns` once and shares
 * it between `annualizedVolatility` and `sharpeRatio` rather than recomputing it twice. */
export function computePerformanceMetrics(
  equityHistory: readonly EquityPoint[],
  annualRiskFreeRate: number,
): PerformanceMetrics {
  const equityCents = equityHistory.map((point) => point.equityCents);
  const returns = periodReturns(equityCents);
  return {
    totalReturn: totalReturn(equityCents),
    maxDrawdown: maxDrawdown(equityCents),
    annualizedVolatility: annualizedVolatility(returns),
    sharpeRatio: sharpeRatio(returns, annualRiskFreeRate),
  };
}

/**
 * Buy-and-hold return of `bars` from the first bar at or after `startDate` through the last bar
 * at or before `endDate` (spec §22's benchmark comparison) — `null` if there's no bar in that
 * range at all, or the first such bar closed at 0. Never looks outside `[startDate, endDate]`, so
 * a benchmark series that extends further in either direction (e.g. `historicalContextDays`
 * warmup) doesn't skew the comparison to a window the match itself didn't actually cover.
 */
export function benchmarkBuyAndHoldReturn(
  bars: readonly DailyBar[],
  startDate: CalendarDate,
  endDate: CalendarDate,
): number | null {
  const inRange = bars.filter((bar) => bar.date >= startDate && bar.date <= endDate);
  const first = inRange[0];
  const last = inRange.at(-1);
  if (first === undefined || last === undefined || first.close === 0) return null;
  return (last.close - first.close) / first.close;
}
