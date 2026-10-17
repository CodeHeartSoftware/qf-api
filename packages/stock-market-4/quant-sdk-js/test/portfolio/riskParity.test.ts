import { describe, expect, it } from 'vitest';
import { effectiveCorrelationKey } from '../../src/portfolio/types.js';
import { riskParityStrategy } from '../../src/portfolio/riskParity.js';
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

describe('riskParityStrategy', () => {
  it('sizes a security more correlated with the rest of the book smaller than an equally-volatile, less-correlated one', () => {
    const alphas = [
      { ticker: 'A', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.02 },
      { ticker: 'B', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.02 },
      { ticker: 'C', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.02 },
    ];
    const effectiveCorrelationByPair = new Map([
      [effectiveCorrelationKey('A', 'B'), 0.9], // A and B are highly correlated with each other
      [effectiveCorrelationKey('A', 'C'), 0.0],
      [effectiveCorrelationKey('B', 'C'), 0.0],
    ]);
    const result = riskParityStrategy.construct({ alphas, effectiveCorrelationByPair }, POLICY);
    // C is uncorrelated with everything and gets the largest weight; A and B (correlated with
    // each other) get scaled down and should be roughly equal to each other.
    expect(mustGet(result.weightByTicker, 'C')).toBeGreaterThan(
      mustGet(result.weightByTicker, 'A'),
    );
    expect(result.weightByTicker.get('A')).toBeCloseTo(mustGet(result.weightByTicker, 'B'));
  });

  it('is fully in cash when nothing activates', () => {
    const result = riskParityStrategy.construct(
      {
        alphas: [{ ticker: 'A', expectedReturn: 0, confidence: 1, dailyVolatility: 0.02 }],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    expect(result.weightByTicker.get('A')).toBe(0);
  });
});
