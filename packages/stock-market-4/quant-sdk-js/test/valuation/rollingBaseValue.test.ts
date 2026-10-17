import { describe, expect, it } from 'vitest';
import type { DailyBar } from '../../src/marketTypes.js';
import {
  computeBlendedBaseValuePerShare,
  computeRollingBaseValuePerShare,
  ROLLING_BASE_VALUE_WINDOW_DAYS,
} from '../../src/valuation/rollingBaseValue.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

describe('computeRollingBaseValuePerShare', () => {
  it('returns undefined with no history yet (first-ever round)', () => {
    expect(computeRollingBaseValuePerShare([])).toBeUndefined();
  });

  it('computes bear/base/bull as trailing low/mean/high over the window', () => {
    const history = [bar('d1', 10), bar('d2', 20), bar('d3', 30)];
    const result = computeRollingBaseValuePerShare(history, 20);
    expect(result).toEqual({ bear: 10, base: 20, bull: 30 });
  });

  it('only looks at the trailing N days, not the whole history', () => {
    // 25 bars of history, window of 20 -> only the last 20 (values 6..25) should count; the early
    // outlier (1) must NOT pull bear down.
    const history = Array.from({ length: 25 }, (_, i) => bar(`d${String(i + 1)}`, i + 1));
    const result = computeRollingBaseValuePerShare(history, 20);
    expect(result?.bear).toBe(6);
    expect(result?.bull).toBe(25);
  });

  it('defaults to a 20-trading-day window when none is given', () => {
    expect(ROLLING_BASE_VALUE_WINDOW_DAYS).toBe(20);
    const history = Array.from({ length: 25 }, (_, i) => bar(`d${String(i + 1)}`, i + 1));
    expect(computeRollingBaseValuePerShare(history)).toEqual(
      computeRollingBaseValuePerShare(history, 20),
    );
  });
});

describe('computeBlendedBaseValuePerShare', () => {
  const staticValue = { bear: 10, base: 20, bull: 30 };

  it('returns the pure static value with no history yet, regardless of blendWeight', () => {
    expect(computeBlendedBaseValuePerShare(staticValue, [], 20, 0.7)).toEqual(staticValue);
  });

  it('blendWeight 0 reproduces the pure static value exactly', () => {
    const history = [bar('d1', 100), bar('d2', 200), bar('d3', 300)];
    expect(computeBlendedBaseValuePerShare(staticValue, history, 20, 0)).toEqual(staticValue);
  });

  it('blendWeight 1 reproduces the pure rolling value exactly', () => {
    const history = [bar('d1', 100), bar('d2', 200), bar('d3', 300)];
    const rolling = computeRollingBaseValuePerShare(history, 20);
    expect(computeBlendedBaseValuePerShare(staticValue, history, 20, 1)).toEqual(rolling);
  });

  it('an intermediate blendWeight is a weighted average of the two', () => {
    const history = [bar('d1', 100), bar('d2', 200), bar('d3', 300)]; // rolling: bear 100, base 200, bull 300
    const result = computeBlendedBaseValuePerShare(staticValue, history, 20, 0.3);
    expect(result.bear).toBeCloseTo(10 * 0.7 + 100 * 0.3); // 37
    expect(result.base).toBeCloseTo(20 * 0.7 + 200 * 0.3); // 74
    expect(result.bull).toBeCloseTo(30 * 0.7 + 300 * 0.3); // 111
  });
});
