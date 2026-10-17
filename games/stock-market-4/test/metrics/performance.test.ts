import { describe, expect, it } from 'vitest';
import {
  annualizedVolatility,
  benchmarkBuyAndHoldReturn,
  computePerformanceMetrics,
  maxDrawdown,
  periodReturns,
  sharpeRatio,
  totalReturn,
} from '../../src/metrics/performance.js';
import type { DailyBar, EquityPoint } from '../../src/types.js';

function point(date: string, equityCents: number): EquityPoint {
  return { date, equityCents };
}

describe('periodReturns', () => {
  it('computes one fractional return per consecutive pair', () => {
    expect(periodReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it('is empty for fewer than two readings', () => {
    expect(periodReturns([100])).toEqual([]);
    expect(periodReturns([])).toEqual([]);
  });

  it('skips a pair whose starting value is 0 rather than dividing by it', () => {
    expect(periodReturns([0, 100])).toEqual([]);
  });
});

describe('totalReturn', () => {
  it('is the fractional change from first to last reading', () => {
    expect(totalReturn([100, 150])).toBe(0.5);
    expect(totalReturn([100, 80])).toBe(-0.2);
  });

  it('is 0 for fewer than two readings or a zero starting value', () => {
    expect(totalReturn([100])).toBe(0);
    expect(totalReturn([])).toBe(0);
    expect(totalReturn([0, 100])).toBe(0);
  });
});

describe('maxDrawdown', () => {
  it('is 0 for a monotonically increasing curve', () => {
    expect(maxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  it('finds the single worst peak-to-trough decline, not just the last one', () => {
    // Peaks at 150 then drops to 90 (a 40% drawdown) before recovering to 140 and dipping to 133
    // (a much smaller ~5% drawdown from that later, lower peak).
    expect(maxDrawdown([100, 150, 90, 140, 133])).toBeCloseTo((150 - 90) / 150, 10);
  });

  it('is 0 for a flat curve', () => {
    expect(maxDrawdown([100, 100, 100])).toBe(0);
  });

  it('is 0 for an empty or single-point curve', () => {
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([100])).toBe(0);
  });
});

describe('annualizedVolatility', () => {
  it('is 0 for fewer than two returns', () => {
    expect(annualizedVolatility([])).toBe(0);
    expect(annualizedVolatility([0.01])).toBe(0);
  });

  it('is 0 for a constant return series', () => {
    expect(annualizedVolatility([0.01, 0.01, 0.01])).toBe(0);
  });

  it('scales with the spread of the return series', () => {
    const tight = annualizedVolatility([0.01, -0.01, 0.01, -0.01]);
    const wide = annualizedVolatility([0.1, -0.1, 0.1, -0.1]);
    expect(wide).toBeGreaterThan(tight);
  });
});

describe('sharpeRatio', () => {
  it('is null when volatility is 0', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 0)).toBeNull();
    expect(sharpeRatio([], 0)).toBeNull();
  });

  it('is positive when mean return exceeds the risk-free rate', () => {
    expect(sharpeRatio([0.01, 0.02, -0.005, 0.015], 0)).toBeGreaterThan(0);
  });

  it('is negative when mean return falls short of the risk-free rate', () => {
    expect(sharpeRatio([0.001, 0.002, -0.001], 0.5)).toBeLessThan(0);
  });
});

describe('computePerformanceMetrics', () => {
  it('assembles all four metrics from an equity curve', () => {
    // 3 points -> 2 period returns, enough for a defined (non-null) Sharpe ratio — a single
    // return has no variance to compute one from (see sharpeRatio's own tests above).
    const history = [
      point('2026-01-01', 100_000),
      point('2026-01-02', 108_000),
      point('2026-01-05', 110_000),
    ];
    const metrics = computePerformanceMetrics(history, 0);
    expect(metrics.totalReturn).toBeCloseTo(0.1, 10);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.sharpeRatio).not.toBeNull();
  });

  it('reports every metric as flat/null for a curve with no trades', () => {
    const history = [point('2026-01-01', 100_000), point('2026-01-02', 100_000)];
    const metrics = computePerformanceMetrics(history, 0);
    expect(metrics).toEqual({
      totalReturn: 0,
      maxDrawdown: 0,
      annualizedVolatility: 0,
      sharpeRatio: null,
    });
  });

  it('handles an empty equity curve without throwing', () => {
    expect(computePerformanceMetrics([], 0)).toEqual({
      totalReturn: 0,
      maxDrawdown: 0,
      annualizedVolatility: 0,
      sharpeRatio: null,
    });
  });
});

describe('benchmarkBuyAndHoldReturn', () => {
  function bar(date: string, close: number): DailyBar {
    return { date, open: close, high: close, low: close, close, volume: 1 };
  }

  const SERIES: DailyBar[] = [
    bar('2025-12-01', 90), // before the range — must not be used as the "first" bar
    bar('2026-01-05', 100),
    bar('2026-01-06', 105),
    bar('2026-01-09', 120),
    bar('2026-06-01', 200), // after the range — must not be used as the "last" bar
  ];

  it('computes buy-and-hold return using only bars within [startDate, endDate]', () => {
    const result = benchmarkBuyAndHoldReturn(SERIES, '2026-01-05', '2026-01-09');
    expect(result).toBeCloseTo((120 - 100) / 100, 10);
  });

  it('is null when no bar falls within the range', () => {
    expect(benchmarkBuyAndHoldReturn(SERIES, '2027-01-01', '2027-06-01')).toBeNull();
  });

  it('is null when the first in-range bar closed at 0', () => {
    expect(
      benchmarkBuyAndHoldReturn(
        [bar('2026-01-05', 0), bar('2026-01-06', 10)],
        '2026-01-05',
        '2026-01-06',
      ),
    ).toBeNull();
  });

  it('is 0 when only a single bar falls within the range', () => {
    expect(benchmarkBuyAndHoldReturn(SERIES, '2026-01-05', '2026-01-05')).toBe(0);
  });
});
