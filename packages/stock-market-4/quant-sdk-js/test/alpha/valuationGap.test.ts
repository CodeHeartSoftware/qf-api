import { describe, expect, it } from 'vitest';
import { computeValuationGapAlpha } from '../../src/alpha/valuationGap.js';

describe('computeValuationGapAlpha', () => {
  it('is the fair-value-vs-price fractional gap', () => {
    const result = computeValuationGapAlpha({
      ticker: 'X',
      date: null,
      fairValuePerShare: 11,
      marketPriceDollars: 10,
    });
    expect(result.value).toBeCloseTo(0.1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('is silent (zero confidence) for a non-positive market price rather than dividing by zero/negative', () => {
    const result = computeValuationGapAlpha({
      ticker: 'X',
      date: null,
      fairValuePerShare: 11,
      marketPriceDollars: 0,
    });
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
  });
});
