import { describe, expect, it } from 'vitest';
import {
  computeCorrelationScaleFactors,
  computePearsonCorrelation,
  computeReturnsSeries,
} from '../src/correlation.js';
import type { DailyBar } from '../src/marketTypes.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

describe('computeReturnsSeries', () => {
  it('computes day-over-day returns over the trailing window', () => {
    const history = [bar('d1', 100), bar('d2', 110), bar('d3', 99)];
    const returns = computeReturnsSeries(history, 20);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1);
    expect(returns[1]).toBeCloseTo(-0.1);
  });
});

describe('computePearsonCorrelation', () => {
  it('is undefined with fewer than 2 overlapping returns', () => {
    expect(computePearsonCorrelation([0.01], [0.02])).toBeUndefined();
  });

  it('is ~1 for two perfectly co-moving series', () => {
    const a = [0.01, 0.02, -0.01, 0.03];
    const b = [0.02, 0.04, -0.02, 0.06]; // exactly 2x a
    expect(computePearsonCorrelation(a, b)).toBeCloseTo(1);
  });

  it('is ~-1 for two perfectly inversely-moving series', () => {
    const a = [0.01, 0.02, -0.01, 0.03];
    const b = [-0.01, -0.02, 0.01, -0.03];
    expect(computePearsonCorrelation(a, b)).toBeCloseTo(-1);
  });
});

describe('computeCorrelationScaleFactors', () => {
  it('scales down BOTH securities in a perfectly positively-correlated pair', () => {
    const returnsByTicker = new Map([
      ['A', [0.01, 0.02, -0.01, 0.03]],
      ['B', [0.02, 0.04, -0.02, 0.06]], // exactly 2x A -> perfectly positively correlated
    ]);
    const factors = computeCorrelationScaleFactors(returnsByTicker, 0.5, 0.25);
    // corr=1 -> scale = max(0.25, 1 - 1*0.5) = 0.5 for both.
    expect(factors.get('A')).toBeCloseTo(0.5);
    expect(factors.get('B')).toBeCloseTo(0.5);
  });

  it('does NOT penalize a perfectly anti-correlated (hedging) pair — a real diversification benefit, not a concentration risk', () => {
    const returnsByTicker = new Map([
      ['A', [0.01, 0.02, -0.01, 0.03]],
      ['B', [-0.01, -0.02, 0.01, -0.03]], // perfectly anti-correlated with A
    ]);
    const factors = computeCorrelationScaleFactors(returnsByTicker, 0.5, 0.25);
    expect(factors.get('A')).toBe(1);
    expect(factors.get('B')).toBe(1);
  });

  it('floors the scale factor at minScaleFactor regardless of how correlated', () => {
    const returnsByTicker = new Map([
      ['A', [0.01, 0.02, -0.01, 0.03]],
      ['B', [0.02, 0.04, -0.02, 0.06]], // perfectly correlated with A
    ]);
    // concentrationPenalty 1.0 would otherwise drive the scale to 0 — floored at 0.25 instead.
    const factors = computeCorrelationScaleFactors(returnsByTicker, 1.0, 0.25);
    expect(factors.get('A')).toBeCloseTo(0.25);
    expect(factors.get('B')).toBeCloseTo(0.25);
  });

  it('gives a lone security (no others to compare against) the full scale factor', () => {
    const returnsByTicker = new Map([['A', [0.01, 0.02, -0.01]]]);
    expect(computeCorrelationScaleFactors(returnsByTicker, 0.5, 0.25).get('A')).toBe(1);
  });
});
