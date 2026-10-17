import { describe, expect, it } from 'vitest';
import { computeMomentumAlpha } from '../../src/alpha/momentum.js';
import type { DailyBar } from '../../src/marketTypes.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

describe('computeMomentumAlpha', () => {
  it('is silent when there is not enough history for the requested window', () => {
    const result = computeMomentumAlpha({
      ticker: 'X',
      date: null,
      priceHistory: [],
      currentPriceDollars: 10,
      windowDays: 10,
    });
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('is the trailing return, with confidence scaled by how much of the window is covered', () => {
    const history = Array.from({ length: 5 }, (_, i) => bar(`2026-01-0${String(i + 1)}`, 10));
    const result = computeMomentumAlpha({
      ticker: 'X',
      date: null,
      priceHistory: history,
      currentPriceDollars: 11,
      windowDays: 5,
    });
    expect(result.value).toBeCloseTo(0.1);
    expect(result.confidence).toBeCloseTo(0.5); // full window coverage -> full 0.5 base confidence
  });
});
