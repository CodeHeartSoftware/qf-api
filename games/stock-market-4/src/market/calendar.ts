import type { CalendarDate } from '../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Every `CalendarDate` is treated as UTC midnight, uniformly, so calendar arithmetic never
 * depends on the host machine's local timezone (distinct from `decisionTimezone`, which only
 * governs when within a trading day the decision deadline falls, not which dates count as
 * trading days). */
function toEpochMillis(date: CalendarDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromEpochMillis(epochMillis: number): CalendarDate {
  const iso = new Date(epochMillis).toISOString();
  return iso.slice(0, 10);
}

function isWeekend(date: CalendarDate): boolean {
  const day = new Date(toEpochMillis(date)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Every trading day from `startDate` to `endDate` inclusive: every calendar date except weekends
 * and any date named in `holidays` — this is historical replay's round-to-date backbone
 * (`state.round` N corresponds to `calendar[N]`), replacing the placeholder raw-calendar-day
 * count games/stock-market-4 started with.
 *
 * `holidays` is organizer-declared (`config.tradingHolidays`) rather than a baked-in exchange
 * calendar: this game can replay any historical date range, and a hardcoded holiday table would
 * need not just NYSE's own list but the right one *for that range's actual years*, including
 * floating holidays (Thanksgiving, MLK Day, ...) this module deliberately doesn't try to compute.
 */
export function generateTradingCalendar(
  startDate: CalendarDate,
  endDate: CalendarDate,
  holidays: ReadonlySet<CalendarDate> = new Set(),
): CalendarDate[] {
  const calendar: CalendarDate[] = [];
  const endMillis = toEpochMillis(endDate);
  for (let millis = toEpochMillis(startDate); millis <= endMillis; millis += MS_PER_DAY) {
    const date = fromEpochMillis(millis);
    if (!isWeekend(date) && !holidays.has(date)) {
      calendar.push(date);
    }
  }
  return calendar;
}
