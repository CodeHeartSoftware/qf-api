import type { DailyBar, EquityPoint } from '@quant-fusion/quant-sdk-js';

const TRADING_DAYS_PER_YEAR = 252;

/**
 * The tracked universe's own equal-weight daily return per date — the average of every ticker's
 * close-to-close return on that date (tickers with no bar on either side of a date are skipped for
 * it). All 11 names are one thematic basket that moves together, so this is the "market" a
 * strategy's return has to be measured against before any of it can be called alpha.
 */
export function basketDailyReturns(priceSeriesByTicker: Record<string, DailyBar[]>): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const bars of Object.values(priceSeriesByTicker)) {
    for (let i = 1; i < bars.length; i++) {
      const previous = bars[i - 1]!;
      const current = bars[i]!;
      if (previous.close <= 0) continue;
      const entry = sums.get(current.date) ?? { total: 0, count: 0 };
      entry.total += current.close / previous.close - 1;
      entry.count += 1;
      sums.set(current.date, entry);
    }
  }
  return new Map([...sums].map(([date, { total, count }]) => [date, total / count]));
}

export interface BasketAttribution {
  /** Sensitivity of the strategy's daily return to the basket's (OLS slope). */
  beta: number;
  /** Annualized mean of the residual daily return (the part the basket doesn't explain). */
  annualizedAlpha: number;
  /** Annualized mean/stdev of the residual — the Sharpe of the alpha alone. `null` when the
   * residual has no variance (e.g. an all-cash participant). */
  residualSharpe: number | null;
  observations: number;
}

/**
 * Regresses a participant's daily equity return on `basketDailyReturns` (OLS, one factor) —
 * `r_t = alpha + beta * basket_t + e_t` — so a long-the-theme book in a rising month shows up as
 * beta, not alpha. Only dates present in both series are used. `null` with fewer than 3 paired
 * days.
 */
export function attributeToBasket(
  equityHistory: EquityPoint[],
  basketReturnByDate: Map<string, number>,
): BasketAttribution | null {
  const strategy: number[] = [];
  const basket: number[] = [];
  for (let i = 1; i < equityHistory.length; i++) {
    const previous = equityHistory[i - 1]!;
    const current = equityHistory[i]!;
    const basketReturn = basketReturnByDate.get(current.date);
    if (basketReturn === undefined || previous.equityCents <= 0) continue;
    strategy.push(current.equityCents / previous.equityCents - 1);
    basket.push(basketReturn);
  }
  const n = strategy.length;
  if (n < 3) return null;

  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanStrategy = mean(strategy);
  const meanBasket = mean(basket);
  let covariance = 0;
  let basketVariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (strategy[i]! - meanStrategy) * (basket[i]! - meanBasket);
    basketVariance += (basket[i]! - meanBasket) ** 2;
  }
  const beta = basketVariance === 0 ? 0 : covariance / basketVariance;
  const residuals = strategy.map((r, i) => r - beta * basket[i]!);
  const meanResidual = mean(residuals);
  const residualStdev = Math.sqrt(residuals.reduce((sum, e) => sum + (e - meanResidual) ** 2, 0) / (n - 1));

  return {
    beta,
    annualizedAlpha: meanResidual * TRADING_DAYS_PER_YEAR,
    residualSharpe:
      residualStdev < 1e-12 ? null : (meanResidual / residualStdev) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    observations: n,
  };
}
