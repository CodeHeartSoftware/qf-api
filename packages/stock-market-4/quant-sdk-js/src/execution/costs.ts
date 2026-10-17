export interface ExecutionCostPolicy {
  /** Flat, per-order dollar fee — the bounded, simple half of the model (plan Phase 1, item 7). */
  flatFeeUsd: number;
  /** Scales the market-impact term below — illustrative starting point (not calibrated against
   * any real broker/venue), same "labeled strategy assumption, not a researched fact" discipline
   * every other constant in this bot follows. */
  impactCoefficient: number;
  /** Ticker-specific average-daily-volume-in-dollars proxy, when known. */
  averageDailyVolumeUsdByTicker: Map<string, number>;
  /** Used for any ticker without its own entry above. */
  defaultAverageDailyVolumeUsd: number;
}

export interface OrderCostEstimate {
  ticker: string;
  notionalUsd: number;
  flatFeeUsd: number;
  marketImpactUsd: number;
  totalCostUsd: number;
  totalCostBps: number;
}

/**
 * A BOUNDED transaction-cost model (plan Phase 1, item 7) — a flat fee plus a market-impact term
 * scaled by (order notional / an average-daily-volume proxy), NOT a full bid/ask spread/slippage
 * model (this project has no real order-book or bid/ask data to calibrate one against). The
 * "participation rate" (`|notional| / ADV proxy`) is the standard, simple proxy real execution-cost
 * models use for how much a given order size would plausibly move the price on an average day.
 */
export function estimateOrderCost(params: {
  ticker: string;
  notionalUsd: number;
  policy: ExecutionCostPolicy;
}): OrderCostEstimate {
  const averageDailyVolumeUsd =
    params.policy.averageDailyVolumeUsdByTicker.get(params.ticker) ??
    params.policy.defaultAverageDailyVolumeUsd;
  const participationRate =
    averageDailyVolumeUsd > 0 ? Math.abs(params.notionalUsd) / averageDailyVolumeUsd : 0;
  const marketImpactUsd =
    params.policy.impactCoefficient * participationRate * Math.abs(params.notionalUsd);
  const totalCostUsd = params.policy.flatFeeUsd + marketImpactUsd;
  const totalCostBps =
    params.notionalUsd !== 0 ? (totalCostUsd / Math.abs(params.notionalUsd)) * 10_000 : 0;

  return {
    ticker: params.ticker,
    notionalUsd: params.notionalUsd,
    flatFeeUsd: params.policy.flatFeeUsd,
    marketImpactUsd,
    totalCostUsd,
    totalCostBps,
  };
}
