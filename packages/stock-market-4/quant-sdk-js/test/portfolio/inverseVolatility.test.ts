import { describe, expect, it } from 'vitest';
import { inverseVolatilityStrategy } from '../../src/portfolio/inverseVolatility.js';
import type { PortfolioConstructionPolicy } from '../../src/portfolio/types.js';

const POLICY: PortfolioConstructionPolicy = {
  activationThreshold: 0.01,
  totalGrossBudgetPct: 0.6,
  maxPositionWeight: 0.5,
};

function mustGet(map: Map<string, number>, ticker: string): number {
  const value = map.get(ticker);
  if (value === undefined) throw new Error(`expected a weight for "${ticker}"`);
  return value;
}

describe('inverseVolatilityStrategy', () => {
  it('sizes a calmer security larger than a wilder one', () => {
    const result = inverseVolatilityStrategy.construct(
      {
        alphas: [
          { ticker: 'CALM', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.01 },
          { ticker: 'WILD', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.1 },
        ],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    expect(mustGet(result.weightByTicker, 'CALM')).toBeGreaterThan(
      mustGet(result.weightByTicker, 'WILD'),
    );
  });

  it('falls back to the average measured inverse-volatility for a security with no volatility reading yet', () => {
    const result = inverseVolatilityStrategy.construct(
      {
        alphas: [
          { ticker: 'KNOWN', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.02 },
          { ticker: 'UNKNOWN', expectedReturn: 0.1, confidence: 1, dailyVolatility: undefined },
        ],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    // With only one known volatility, UNKNOWN's fallback equals KNOWN's own inverse-vol, so both
    // get an equal share of the gross budget.
    expect(result.weightByTicker.get('KNOWN')).toBeCloseTo(
      mustGet(result.weightByTicker, 'UNKNOWN'),
    );
  });

  it('is fully in cash when nothing activates', () => {
    const result = inverseVolatilityStrategy.construct(
      {
        alphas: [{ ticker: 'A', expectedReturn: 0, confidence: 1, dailyVolatility: 0.02 }],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    expect(result.weightByTicker.get('A')).toBe(0);
  });
});
