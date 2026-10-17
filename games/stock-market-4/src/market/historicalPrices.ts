import type { CalendarDate, DailyBar } from '../types.js';

/** Indexes one security's bar series by date for O(1) lookup — build once per security (e.g. once
 * per match, from `config.historicalPrices[ticker]`), not once per round. */
export function indexHistoricalPrices(
  bars: readonly DailyBar[],
): ReadonlyMap<CalendarDate, DailyBar> {
  return new Map(bars.map((bar) => [bar.date, bar]));
}

/** The bar for exactly `date`, or `undefined` if the historical record has no bar for that day —
 * a genuine data gap (e.g. a trading halt), surfaced as-is rather than silently carried forward
 * from a prior close. Never looks past `date`: this is the one place a future bar could leak into
 * a bot's decision, so it deliberately does only an exact lookup, nothing fuzzier. */
export function getHistoricalBar(
  index: ReadonlyMap<CalendarDate, DailyBar>,
  date: CalendarDate,
): DailyBar | undefined {
  return index.get(date);
}

/**
 * Every bar at or before `date`, oldest first, capped to the trailing `maxDays` — the warmup
 * window `config.historicalContextDays` describes (spec §10). Filtering by `bar.date <= date`
 * rather than by array position is what makes this safe to call with the FULL bar series
 * (including days past `date`, if the caller has them) and still never leak a future bar: the
 * cutoff is the date itself, not "how far into the array we've gotten."
 */
export function historicalBarsAsOf(
  bars: readonly DailyBar[],
  date: CalendarDate,
  maxDays: number,
): DailyBar[] {
  const visible = bars.filter((bar) => bar.date <= date);
  return visible.slice(-maxDays);
}
