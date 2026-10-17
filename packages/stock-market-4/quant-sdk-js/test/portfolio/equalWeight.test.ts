import { describe, expect, it } from 'vitest';
import { equalWeightStrategy } from '../../src/portfolio/equalWeight.js';
import type { PortfolioConstructionPolicy } from '../../src/portfolio/types.js';

const POLICY: PortfolioConstructionPolicy = {
  activationThreshold: 0.01,
  totalGrossBudgetPct: 0.6,
  maxPositionWeight: 0.25,
};

describe('equalWeightStrategy', () => {
  it('leaves everything at zero (fully in cash) when nothing activates', () => {
    const result = equalWeightStrategy.construct(
      {
        alphas: [{ ticker: 'A', expectedReturn: 0, confidence: 1, dailyVolatility: undefined }],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    expect(result.weightByTicker.get('A')).toBe(0);
  });

  it('splits the gross budget equally across active names, ignoring volatility entirely', () => {
    const result = equalWeightStrategy.construct(
      {
        alphas: [
          { ticker: 'A', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.5 },
          { ticker: 'B', expectedReturn: 0.1, confidence: 1, dailyVolatility: 0.01 },
        ],
        effectiveCorrelationByPair: new Map(),
      },
      { ...POLICY, maxPositionWeight: 0.5 }, // raised so the per-name cap doesn't mask the split
    );
    expect(result.weightByTicker.get('A')).toBeCloseTo(0.3);
    expect(result.weightByTicker.get('B')).toBeCloseTo(0.3);
  });

  it('is long-only: a negative combined signal never activates a position', () => {
    const result = equalWeightStrategy.construct(
      {
        alphas: [{ ticker: 'A', expectedReturn: -0.5, confidence: 1, dailyVolatility: undefined }],
        effectiveCorrelationByPair: new Map(),
      },
      POLICY,
    );
    expect(result.weightByTicker.get('A')).toBe(0);
  });

  it('clips a share above the per-name cap', () => {
    const result = equalWeightStrategy.construct(
      {
        alphas: [{ ticker: 'A', expectedReturn: 0.1, confidence: 1, dailyVolatility: undefined }],
        effectiveCorrelationByPair: new Map(),
      },
      { ...POLICY, totalGrossBudgetPct: 0.9 },
    );
    expect(result.weightByTicker.get('A')).toBe(POLICY.maxPositionWeight);
  });
});
