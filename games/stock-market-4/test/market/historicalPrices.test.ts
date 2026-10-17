import { describe, expect, it } from 'vitest';
import {
  getHistoricalBar,
  historicalBarsAsOf,
  indexHistoricalPrices,
} from '../../src/market/historicalPrices.js';
import type { DailyBar } from '../../src/types.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

const SERIES: DailyBar[] = [bar('2026-01-05', 100), bar('2026-01-06', 101), bar('2026-01-07', 102)];

describe('indexHistoricalPrices / getHistoricalBar', () => {
  it('finds the bar for an exact date', () => {
    const index = indexHistoricalPrices(SERIES);
    expect(getHistoricalBar(index, '2026-01-06')).toEqual(bar('2026-01-06', 101));
  });

  it('returns undefined for a date with no recorded bar (a genuine gap)', () => {
    const index = indexHistoricalPrices(SERIES);
    expect(getHistoricalBar(index, '2026-01-08')).toBeUndefined();
  });
});

describe('historicalBarsAsOf', () => {
  it('returns every bar at or before the given date, oldest first', () => {
    expect(historicalBarsAsOf(SERIES, '2026-01-06', 10)).toEqual([
      bar('2026-01-05', 100),
      bar('2026-01-06', 101),
    ]);
  });

  it('never includes a bar dated after the given date, even if the caller passes the full series', () => {
    const result = historicalBarsAsOf(SERIES, '2026-01-06', 10);
    expect(result.some((b) => b.date > '2026-01-06')).toBe(false);
  });

  it('caps the window to the trailing maxDays', () => {
    expect(historicalBarsAsOf(SERIES, '2026-01-07', 2)).toEqual([
      bar('2026-01-06', 101),
      bar('2026-01-07', 102),
    ]);
  });

  it('is empty when the date is before every bar in the series', () => {
    expect(historicalBarsAsOf(SERIES, '2026-01-01', 10)).toEqual([]);
  });
});
