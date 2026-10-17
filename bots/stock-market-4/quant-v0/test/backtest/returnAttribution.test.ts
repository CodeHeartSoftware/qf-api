import { describe, expect, it } from 'vitest';
import type { EquityPoint, TradingDecision } from '@quant-fusion/quant-sdk-js';
import { computeReturnAttribution } from '../../backtest/returnAttribution.js';

/** Only `alphaContribution` and `orderCosts` are ever read by `computeReturnAttribution` — every
 * other `TradingDecision` field is irrelevant to it, so this fixture fills only those two and
 * casts, rather than hand-building a full (and here meaningless) valuation/exposure record. */
function decision(overrides: {
  alphaContribution?: Record<string, number>;
  orderCosts?: { totalCostUsd: number }[];
}): TradingDecision {
  return {
    alphaContribution: overrides.alphaContribution ?? {},
    orderCosts: overrides.orderCosts ?? [],
  } as TradingDecision;
}

const flatEquity: EquityPoint[] = [
  { date: '2026-07-01', equityCents: 100_000_00 },
  { date: '2026-07-02', equityCents: 100_000_00 },
];

describe('computeReturnAttribution', () => {
  it('sums every orderCosts.totalCostUsd across every decision', () => {
    const decisions = [
      decision({ orderCosts: [{ totalCostUsd: 1.5 }, { totalCostUsd: 2.5 }] }),
      decision({ orderCosts: [{ totalCostUsd: 3 }] }),
    ];
    const result = computeReturnAttribution(decisions, flatEquity, new Map());
    expect(result.cost.totalCostUsd).toBeCloseTo(7);
    // $7 against $100,000 average equity = 0.7 bps
    expect(result.cost.costDragBps).toBeCloseTo(0.7);
  });

  it('reports zero cost drag (not NaN/Infinity) with no equity history', () => {
    const result = computeReturnAttribution([decision({})], [], new Map());
    expect(result.cost.costDragBps).toBe(0);
  });

  it('mean-abs-contribution and primary-driver-share are computed only over decisions where the factor had weight', () => {
    const decisions = [
      decision({ alphaContribution: { momentum: 0.02, valuation_gap: 0.01 } }),
      decision({ alphaContribution: { momentum: -0.05, valuation_gap: 0.01 } }),
      decision({ alphaContribution: { valuation_gap: 0.03 } }), // momentum ablated away this round
    ];
    const result = computeReturnAttribution(decisions, flatEquity, new Map());
    const momentum = result.alphaFactors.find((f) => f.factor === 'momentum')!;
    const valuationGap = result.alphaFactors.find((f) => f.factor === 'valuation_gap')!;

    // momentum: |0.02| and |-0.05| averaged over its 2 real appearances, not diluted by round 3.
    expect(momentum.meanAbsContribution).toBeCloseTo((0.02 + 0.05) / 2);
    expect(momentum.sampleCount).toBe(2);
    // momentum is the larger-magnitude factor in rounds 1 (0.02 > 0.01) AND 2 (0.05 > 0.01) -> 2 of 3.
    expect(momentum.primaryDriverShare).toBeCloseTo(2 / 3);
    // valuation_gap is only the larger-magnitude factor in round 3 (its lone appearance) -> 1 of 3.
    expect(valuationGap.primaryDriverShare).toBeCloseTo(1 / 3);
    // Sorted most-influential first.
    expect(result.alphaFactors[0]!.factor).toBe('momentum');
  });

  it('a decision with no active alpha factors at all contributes nothing and is not counted', () => {
    const decisions = [decision({ alphaContribution: { momentum: 0.01 } }), decision({ alphaContribution: {} })];
    const result = computeReturnAttribution(decisions, flatEquity, new Map());
    const momentum = result.alphaFactors.find((f) => f.factor === 'momentum')!;
    expect(momentum.primaryDriverShare).toBeCloseTo(1); // 1 of 1 REAL (nonempty) decision, not 1 of 2.
  });
});
