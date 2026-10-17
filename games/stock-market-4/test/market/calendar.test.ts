import { describe, expect, it } from 'vitest';
import { generateTradingCalendar } from '../../src/market/calendar.js';

describe('generateTradingCalendar', () => {
  it('includes every weekday and excludes weekends, inclusive of both endpoints', () => {
    // 2026-01-02 (Fri) through 2026-01-06 (Tue): Sat/Sun in between are excluded.
    expect(generateTradingCalendar('2026-01-02', '2026-01-06')).toEqual([
      '2026-01-02',
      '2026-01-05',
      '2026-01-06',
    ]);
  });

  it('is a single day when startDate equals endDate on a weekday', () => {
    expect(generateTradingCalendar('2026-01-05', '2026-01-05')).toEqual(['2026-01-05']);
  });

  it('is empty when startDate equals endDate on a weekend', () => {
    expect(generateTradingCalendar('2026-01-03', '2026-01-03')).toEqual([]);
  });

  it('excludes a declared holiday that falls on a weekday', () => {
    const calendar = generateTradingCalendar('2026-01-05', '2026-01-09', new Set(['2026-01-07']));
    expect(calendar).toEqual(['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09']);
  });

  it('is unaffected by a declared holiday that falls on a weekend anyway', () => {
    const calendar = generateTradingCalendar('2026-01-02', '2026-01-06', new Set(['2026-01-03']));
    expect(calendar).toEqual(['2026-01-02', '2026-01-05', '2026-01-06']);
  });

  it('never depends on the host machine local timezone (UTC-normalized boundaries)', () => {
    // A regression guard: date-only arithmetic must never drift a day depending on local TZ.
    expect(generateTradingCalendar('2026-02-02', '2026-02-02')).toEqual(['2026-02-02']);
  });
});
