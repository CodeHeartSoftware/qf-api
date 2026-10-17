import { describe, expect, it } from 'vitest';
import { estimateOrderCost, type ExecutionCostPolicy } from '../../src/execution/costs.js';

const POLICY: ExecutionCostPolicy = {
  flatFeeUsd: 1,
  impactCoefficient: 0.1,
  averageDailyVolumeUsdByTicker: new Map([['LIQUID', 10_000_000]]),
  defaultAverageDailyVolumeUsd: 1_000_000,
};

describe('estimateOrderCost', () => {
  it('is just the flat fee for a tiny order relative to ADV', () => {
    const result = estimateOrderCost({ ticker: 'LIQUID', notionalUsd: 100, policy: POLICY });
    expect(result.flatFeeUsd).toBe(1);
    expect(result.marketImpactUsd).toBeCloseTo(0.1 * (100 / 10_000_000) * 100);
    expect(result.totalCostUsd).toBeCloseTo(1 + result.marketImpactUsd);
  });

  it('scales market impact with participation rate (order notional / ADV proxy)', () => {
    const small = estimateOrderCost({ ticker: 'X', notionalUsd: 10_000, policy: POLICY });
    const large = estimateOrderCost({ ticker: 'X', notionalUsd: 500_000, policy: POLICY });
    expect(large.marketImpactUsd).toBeGreaterThan(small.marketImpactUsd);
  });

  it('falls back to the default ADV for an unlisted ticker', () => {
    const result = estimateOrderCost({ ticker: 'UNKNOWN', notionalUsd: 100_000, policy: POLICY });
    expect(result.marketImpactUsd).toBeCloseTo(0.1 * (100_000 / 1_000_000) * 100_000);
  });

  it('reports cost in bps relative to notional', () => {
    const result = estimateOrderCost({ ticker: 'LIQUID', notionalUsd: 10_000, policy: POLICY });
    expect(result.totalCostBps).toBeCloseTo((result.totalCostUsd / 10_000) * 10_000);
  });

  it('is zero bps for a zero-notional order (defensive, avoids divide-by-zero)', () => {
    const result = estimateOrderCost({ ticker: 'X', notionalUsd: 0, policy: POLICY });
    expect(result.totalCostBps).toBe(0);
  });
});
