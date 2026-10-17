import { describe, expect, it } from 'vitest';
import { selectActiveAlphas } from '../../src/portfolio/selection.js';
import type { AlphaInput, PortfolioConstructionPolicy } from '../../src/portfolio/types.js';

const alpha = (ticker: string, expectedReturn: number, confidence = 1): AlphaInput => ({
  ticker,
  expectedReturn,
  confidence,
  dailyVolatility: 0.02,
});
const base: PortfolioConstructionPolicy = {
  activationThreshold: 0.01,
  totalGrossBudgetPct: 0.6,
  maxPositionWeight: 0.25,
};
const alphas = [
  alpha('A', 0.005),
  alpha('B', 0.03),
  alpha('C', -0.02),
  alpha('D', 0.02),
  alpha('E', 0.001),
];

describe('selectActiveAlphas', () => {
  it('threshold mode (the default) keeps every name clearing activationThreshold', () => {
    expect(selectActiveAlphas(alphas, base).map((a) => a.ticker)).toEqual(['B', 'D']);
  });

  it('top_k keeps the k best positive scores regardless of their absolute size', () => {
    const policy = { ...base, selection: { mode: 'top_k' as const, k: 3, minScore: 0 } };
    expect(selectActiveAlphas(alphas, policy).map((a) => a.ticker)).toEqual(['B', 'D', 'A']);
  });

  it('top_k never selects a non-positive view, even when fewer than k are positive', () => {
    const policy = { ...base, selection: { mode: 'top_k' as const, k: 10, minScore: 0 } };
    expect(selectActiveAlphas(alphas, policy).map((a) => a.ticker)).toEqual(['B', 'D', 'A', 'E']);
  });

  it('top_k ranks on expectedReturn * confidence and breaks ties by ticker', () => {
    const policy = { ...base, selection: { mode: 'top_k' as const, k: 2, minScore: 0 } };
    const tied = [alpha('Z', 0.04, 0.5), alpha('Y', 0.02, 1), alpha('X', 0.05, 0.1)];
    expect(selectActiveAlphas(tied, policy).map((a) => a.ticker)).toEqual(['Y', 'Z']);
  });
});
