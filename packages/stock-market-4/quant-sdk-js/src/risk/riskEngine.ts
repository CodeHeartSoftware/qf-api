import { applyThesisGroupCaps, type ThesisGroupCapPolicy } from '../portfolio/optimizer.js';

export interface RiskPolicy {
  maxPositionWeight: number;
  thesisGroupCap: ThesisGroupCapPolicy;
  /** A flat average-daily-volume-USD proxy used when no ticker-specific figure is available (see
   * `../execution/costs.ts`, which uses the SAME kind of proxy for its own, separate purpose —
   * transaction-cost estimation, not a hard cap). Converted here into a position-size ceiling: a
   * weight whose notional would exceed this many dollars is capped, on the theory that a position
   * this bot couldn't realistically build or unwind in a single day without moving the price
   * shouldn't be sized past that in the first place. */
  defaultLiquidityCapUsd: number;
}

export interface RiskAdjustment {
  ticker: string;
  reason: string;
  weightBefore: number;
  weightAfter: number;
}

export interface RiskEngineResult {
  weightByTicker: Map<string, number>;
  adjustments: RiskAdjustment[];
}

/**
 * The independent RISK stage (plan Phase 1, item 6 — the critique's key distinction): takes
 * portfolio construction's desired weights and ONLY EVER SHRINKS them toward zero, in three
 * sequential passes (single-position cap, liquidity/ADV-proxy cap, thesis-group cap — reusing
 * `fusion-fundamental-v7`'s own `applyThesisGroupCaps`, unchanged, for the last one). Every
 * shrink is reported in `adjustments` with WHY, never silently applied — this stage never
 * overrides or replaces the alpha/portfolio-construction opinion, only reports what it wouldn't
 * let through at full size. When nothing needs shrinking, `weightByTicker` is byte-identical to
 * `desiredWeightByTicker` and `adjustments` is empty — see `test/risk/riskEngine.test.ts` for the
 * pass-through contract this is meant to guarantee.
 */
export function applyRiskEngine(params: {
  desiredWeightByTicker: Map<string, number>;
  exposureFootprintByTicker: Map<string, Set<string>>;
  equityCents: number;
  policy: RiskPolicy;
}): RiskEngineResult {
  const adjustments: RiskAdjustment[] = [];

  const afterConcentration = new Map<string, number>();
  for (const [ticker, weight] of params.desiredWeightByTicker) {
    const capped = Math.max(
      -params.policy.maxPositionWeight,
      Math.min(params.policy.maxPositionWeight, weight),
    );
    if (capped !== weight) {
      adjustments.push({
        ticker,
        reason: `single-position cap: |${(weight * 100).toFixed(1)}%| exceeds the ${(params.policy.maxPositionWeight * 100).toFixed(1)}% per-name maximum.`,
        weightBefore: weight,
        weightAfter: capped,
      });
    }
    afterConcentration.set(ticker, capped);
  }

  const maxWeightFromLiquidity =
    params.equityCents > 0
      ? (params.policy.defaultLiquidityCapUsd * 100) / params.equityCents
      : Number.POSITIVE_INFINITY;
  const afterLiquidity = new Map<string, number>();
  for (const [ticker, weight] of afterConcentration) {
    const cappedMagnitude = Math.min(Math.abs(weight), maxWeightFromLiquidity);
    const capped = Math.sign(weight) * cappedMagnitude;
    if (capped !== weight) {
      adjustments.push({
        ticker,
        reason: `liquidity/ADV-proxy cap: notional would exceed the $${params.policy.defaultLiquidityCapUsd.toLocaleString()} proxy.`,
        weightBefore: weight,
        weightAfter: capped,
      });
    }
    afterLiquidity.set(ticker, capped);
  }

  const { adjustedWeightByTicker, adjustments: thesisAdjustments } = applyThesisGroupCaps({
    targetWeightByTicker: afterLiquidity,
    exposureFootprintByTicker: params.exposureFootprintByTicker,
    policy: params.policy.thesisGroupCap,
  });
  for (const adjustment of thesisAdjustments) {
    for (const ticker of adjustment.group) {
      adjustments.push({
        ticker,
        reason: adjustment.note,
        weightBefore: afterLiquidity.get(ticker) ?? 0,
        weightAfter: adjustedWeightByTicker.get(ticker) ?? 0,
      });
    }
  }

  const weightByTicker = new Map<string, number>();
  for (const [ticker, weight] of adjustedWeightByTicker) weightByTicker.set(ticker, weight ?? 0);

  return { weightByTicker, adjustments };
}
