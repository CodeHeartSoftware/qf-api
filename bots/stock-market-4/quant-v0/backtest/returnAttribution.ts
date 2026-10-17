import type { EquityPoint, TradingDecision } from '@quant-fusion/quant-sdk-js';
import { attributeToBasket, type BasketAttribution } from './basketAttribution.js';

export interface CostAttribution {
  /** Every order's `totalCostUsd` (flat fee + market-impact estimate — see `execution/costs.ts`),
   * summed over every decision in the run. */
  totalCostUsd: number;
  /** `totalCostUsd` against the run's own average equity, in basis points — "how much of the
   * account did trading costs consume," independent of account size. */
  costDragBps: number;
}

export interface AlphaFactorAttribution {
  factor: string;
  /** Mean ABSOLUTE contribution to expected return (see `TradingDecision.alphaContribution`),
   * across every decision where this factor carried nonzero weight — how much this factor
   * typically moved the combined view, regardless of direction. Not signed: a factor that's
   * reliably negative is still "influential," and signed contributions would mostly cancel out
   * across many securities/rounds, hiding exactly the thing this is meant to surface. */
  meanAbsContribution: number;
  /** Of every decision where AT LEAST ONE factor had nonzero weight, the fraction where THIS
   * factor's contribution had the single largest magnitude — "how often was this the primary
   * driver of the view," the most direct answer to "which of the 5 signals is actually earning
   * the returns." */
  primaryDriverShare: number;
  /** How many decisions this factor had any (nonzero) weight in at all — so a factor's own
   * `meanAbsContribution`/`primaryDriverShare` can be read alongside how much data backs it. */
  sampleCount: number;
}

export interface ReturnAttribution {
  /** Beta/alpha/residual-Sharpe against the tracked universe's own basket — unchanged from
   * `basketAttribution.ts`, included here so cost + alpha-factor attribution sit alongside it in
   * one report instead of two. `null` when there's too little equity history to regress. */
  vsBasket: BasketAttribution | null;
  cost: CostAttribution;
  /** Sorted by `meanAbsContribution`, descending — the most-influential factor first. */
  alphaFactors: AlphaFactorAttribution[];
}

/**
 * Combines everything the README's "full alpha/beta/cost return-attribution decomposition" asked
 * for, out of data this bot already computes every round but previously discarded once `orders`
 * were extracted from it (see `src/index.ts`'s own `onDecision` hook, and `walkForward.ts`'s
 * `quantParticipant` helper, which is what actually captures `decisions` for a backtest run):
 *
 * - **Beta/alpha** — delegates to `attributeToBasket`, unchanged; never re-derived here.
 * - **Cost** — sums every order's own `OrderCostEstimate.totalCostUsd`, already computed by
 *   `execution/costs.ts` per decision but never aggregated across a run before now.
 * - **Alpha** — aggregates `TradingDecision.alphaContribution`, an EXACT per-factor decomposition
 *   of that decision's own expected return (see `alpha/ic.ts`'s `combineAlphaEnsemble`), into
 *   "which factor typically drove the view, and how often was it the primary one."
 */
export function computeReturnAttribution(
  decisions: TradingDecision[],
  equityHistory: EquityPoint[],
  basketReturnByDate: Map<string, number>,
): ReturnAttribution {
  const vsBasket = attributeToBasket(equityHistory, basketReturnByDate);

  let totalCostUsd = 0;
  for (const decision of decisions) {
    for (const orderCost of decision.orderCosts) totalCostUsd += orderCost.totalCostUsd;
  }
  const averageEquityUsd =
    equityHistory.length === 0
      ? 0
      : equityHistory.reduce((sum, point) => sum + point.equityCents, 0) / equityHistory.length / 100;
  const costDragBps = averageEquityUsd <= 0 ? 0 : (totalCostUsd / averageEquityUsd) * 10_000;

  const byFactor = new Map<string, { absSum: number; sampleCount: number; primaryCount: number }>();
  let decisionsWithAnyContribution = 0;
  for (const decision of decisions) {
    const entries = Object.entries(decision.alphaContribution);
    if (entries.length === 0) continue;
    decisionsWithAnyContribution += 1;

    let primaryFactor: string | undefined;
    let primaryAbs = -1;
    for (const [factor, contribution] of entries) {
      const abs = Math.abs(contribution);
      const bucket = byFactor.get(factor) ?? { absSum: 0, sampleCount: 0, primaryCount: 0 };
      bucket.absSum += abs;
      bucket.sampleCount += 1;
      byFactor.set(factor, bucket);
      if (abs > primaryAbs) {
        primaryAbs = abs;
        primaryFactor = factor;
      }
    }
    if (primaryFactor !== undefined) {
      const bucket = byFactor.get(primaryFactor);
      if (bucket !== undefined) bucket.primaryCount += 1;
    }
  }

  const alphaFactors: AlphaFactorAttribution[] = [...byFactor.entries()]
    .map(([factor, bucket]) => ({
      factor,
      meanAbsContribution: bucket.absSum / bucket.sampleCount,
      primaryDriverShare:
        decisionsWithAnyContribution === 0 ? 0 : bucket.primaryCount / decisionsWithAnyContribution,
      sampleCount: bucket.sampleCount,
    }))
    .sort((a, b) => b.meanAbsContribution - a.meanAbsContribution);

  return { vsBasket, cost: { totalCostUsd, costDragBps }, alphaFactors };
}

/** One-line-per-factor, human-readable summary — the same "dev/testing trace" spirit as
 * `formatStrategyTrace` in `@quant-fusion/quant-sdk-js`'s `decision.ts`. */
export function formatReturnAttribution(attribution: ReturnAttribution): string {
  const lines = [
    `vsBasket: ${
      attribution.vsBasket === null
        ? '(not enough equity history)'
        : `beta ${attribution.vsBasket.beta.toFixed(2)}, annualized alpha ${(attribution.vsBasket.annualizedAlpha * 100).toFixed(1)}%, residual Sharpe ${attribution.vsBasket.residualSharpe?.toFixed(2) ?? '(n/a)'}`
    }`,
    `cost drag: ${attribution.cost.costDragBps.toFixed(1)} bps ($${attribution.cost.totalCostUsd.toFixed(2)} total)`,
    'alpha factors (most influential first):',
    ...attribution.alphaFactors.map(
      (f) =>
        `  ${f.factor}: mean |contribution| ${(f.meanAbsContribution * 100).toFixed(3)}%, primary driver in ${(f.primaryDriverShare * 100).toFixed(0)}% of decisions (n=${f.sampleCount})`,
    ),
  ];
  return lines.join('\n');
}
