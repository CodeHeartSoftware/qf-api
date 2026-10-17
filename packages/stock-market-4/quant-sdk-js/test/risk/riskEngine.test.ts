import { describe, expect, it } from 'vitest';
import { applyRiskEngine, type RiskPolicy } from '../../src/risk/riskEngine.js';

/**
 * Locks in the risk engine's core behavioral contract (plan Phase 1, item 6): it only ever SHRINKS
 * a desired weight, reports every shrink with a reason, and passes weights through byte-identical
 * when nothing needs shrinking — it never silently overrides the upstream alpha/portfolio opinion.
 */
const POLICY: RiskPolicy = {
  maxPositionWeight: 0.25,
  thesisGroupCap: { minSharedExposureIds: 1, maxGroupWeight: 0.3 },
  defaultLiquidityCapUsd: 1_000_000,
};

describe('applyRiskEngine', () => {
  it('passes weights through unchanged, with no adjustments, when nothing needs shrinking', () => {
    const desired = new Map([
      ['A', 0.1],
      ['B', 0.05],
    ]);
    const result = applyRiskEngine({
      desiredWeightByTicker: desired,
      exposureFootprintByTicker: new Map([
        ['A', new Set(['x'])],
        ['B', new Set(['y'])],
      ]),
      equityCents: 100_000_000,
      policy: POLICY,
    });
    expect(result.weightByTicker.get('A')).toBe(0.1);
    expect(result.weightByTicker.get('B')).toBe(0.05);
    expect(result.adjustments).toEqual([]);
  });

  it('caps a single position above maxPositionWeight and reports why', () => {
    const result = applyRiskEngine({
      desiredWeightByTicker: new Map([['A', 0.4]]),
      exposureFootprintByTicker: new Map([['A', new Set()]]),
      equityCents: 100_000_000,
      policy: POLICY,
    });
    expect(result.weightByTicker.get('A')).toBe(0.25);
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]?.reason).toMatch(/single-position cap/);
  });

  it('caps a position whose notional would exceed the liquidity/ADV proxy', () => {
    // equityCents = $1,000,000; a $100,000 liquidity cap is 10% of equity — below the desired 20%.
    const result = applyRiskEngine({
      desiredWeightByTicker: new Map([['A', 0.2]]),
      exposureFootprintByTicker: new Map([['A', new Set()]]),
      equityCents: 100_000_000,
      policy: { ...POLICY, defaultLiquidityCapUsd: 100_000 },
    });
    expect(result.weightByTicker.get('A')).toBeCloseTo(0.1);
    expect(result.adjustments.some((a) => a.reason.includes('liquidity'))).toBe(true);
  });

  it('shrinks a thesis group sharing exposure ids that combine past the group cap', () => {
    const result = applyRiskEngine({
      desiredWeightByTicker: new Map([
        ['A', 0.2],
        ['B', 0.2],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['shared'])],
        ['B', new Set(['shared'])],
      ]),
      equityCents: 100_000_000,
      policy: POLICY,
    });
    const combined = (result.weightByTicker.get('A') ?? 0) + (result.weightByTicker.get('B') ?? 0);
    expect(combined).toBeCloseTo(POLICY.thesisGroupCap.maxGroupWeight);
    expect(result.adjustments.some((a) => a.ticker === 'A')).toBe(true);
    expect(result.adjustments.some((a) => a.ticker === 'B')).toBe(true);
  });
});
