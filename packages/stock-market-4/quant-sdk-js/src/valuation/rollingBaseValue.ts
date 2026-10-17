import type { DailyBar } from '../marketTypes.js';
import type { ScenarioValue } from './types.js';

/** v2-only: how many trailing trading days feed the rolling base-value calculation below. A month
 * of trading days — short enough to actually track a moving market, long enough to smooth out a
 * single day's noise. An explicit, documented starting assumption (spec §28), not a researched
 * figure; see `computeRollingBaseValuePerShare`'s own doc comment for the rest of the design. */
export const ROLLING_BASE_VALUE_WINDOW_DAYS = 20;

/**
 * Recomputes `baseBusinessValuePerShare` from a security's own trailing real price history,
 * instead of a one-time-pulled, ever-more-stale config constant (see `config.ts`'s own doc
 * comment on that field for why this replaced it). `bear`/`bull` are the trailing window's own
 * low/high close — an OBSERVED range, not a guess — and `base` is the trailing window's mean
 * close (not simply "yesterday's close," which would make the valuation gap a tautological
 * one-day price-change signal rather than a genuine deviation from a recent baseline).
 *
 * Returns `undefined` when `history` is empty (a security's first-ever round in a match, with
 * nothing to compute a window from yet) — the caller falls back to `SecurityConfig`'s own static
 * `baseBusinessValuePerShare` in that case, exactly the "no basis for a view yet" honesty this
 * bot already applies elsewhere (spec §28), not an invented number.
 */
export function computeRollingBaseValuePerShare(
  history: DailyBar[],
  windowDays: number = ROLLING_BASE_VALUE_WINDOW_DAYS,
): ScenarioValue | undefined {
  if (history.length === 0) return undefined;

  const window = history.slice(-windowDays);
  const closes = window.map((bar) => bar.close);
  const bear = Math.min(...closes);
  const bull = Math.max(...closes);
  const base = closes.reduce((sum, close) => sum + close, 0) / closes.length;

  return { bear, base, bull };
}

/**
 * Blends a security's STATIC config anchor with the rolling calculation above, instead of fully
 * replacing one with the other. A pure rolling replacement (v2's first cut) turned out to make
 * this a straight mean-reversion strategy — buying every dip relative to a fast-moving recent
 * average — which loses badly during a genuinely sustained decline (confirmed empirically: a
 * 108-combination sweep over window length and confidence calibration alone never got within 25
 * points of v1's real return on the same window, because none of those knobs touch the underlying
 * mean-reversion character). Blending keeps a "sticky" fundamentals anchor (like v1's static one)
 * dominant by default, while still letting the anchor drift toward the market's own recent range
 * over time — which was the actual ask ("anchors that can move with recent price history"), not
 * "replace fundamentals with a moving average."
 *
 * `blendWeight` is the ROLLING calculation's own share of the result (0 = pure static/v1-like,
 * 1 = pure rolling/v2's original first cut) — applied per Bear/Base/Bull field independently.
 * Falls back to the pure static value when there's no history yet (same as
 * `computeRollingBaseValuePerShare` returning `undefined`) — `blendWeight` never matters on a
 * security's first-ever round.
 */
export function computeBlendedBaseValuePerShare(
  staticValue: ScenarioValue,
  history: DailyBar[],
  windowDays: number = ROLLING_BASE_VALUE_WINDOW_DAYS,
  blendWeight = 0.3,
): ScenarioValue {
  const rolling = computeRollingBaseValuePerShare(history, windowDays);
  if (rolling === undefined) return staticValue;

  const blend = (staticField: number, rollingField: number) =>
    staticField * (1 - blendWeight) + rollingField * blendWeight;
  return {
    bear: blend(staticValue.bear, rolling.bear),
    base: blend(staticValue.base, rolling.base),
    bull: blend(staticValue.bull, rolling.bull),
  };
}
