import type { CalendarDate, ResearchEntry } from '../types.js';

/**
 * The research payload knowable as of `asOfDate` — the last entry in `timeline` (sorted by
 * strictly increasing `date`, enforced by `ResearchTimelineSchema`) with `date <= asOfDate`, or
 * `undefined` if none is knowable yet. Same "resolve the record in effect as of a date" idiom as
 * `market/security.ts`'s `resolveSecurityAsOf` and `market/historicalPrices.ts`'s
 * `historicalBarsAsOf` — the one place a future research entry could leak into a bot's decision,
 * so this deliberately never looks past `asOfDate`.
 *
 * Returns the entry's `payload` completely as-is: no parsing, no shape assumptions, nothing. See
 * types.ts's Research boundary section for why.
 */
export function researchAsOf(timeline: readonly ResearchEntry[], asOfDate: CalendarDate): unknown {
  let latest: ResearchEntry | undefined;
  for (const entry of timeline) {
    if (entry.date > asOfDate) break;
    latest = entry;
  }
  return latest?.payload;
}
