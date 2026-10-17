import type { SecurityConfig } from '../config.js';
import type { DailyBar } from '../marketTypes.js';
import type { ScenarioValue } from './types.js';

/**
 * Where a security's STATIC base-business anchor (the sticky half of
 * `computeBlendedBaseValuePerShare`) comes from:
 *
 * - `first_observed` (the default) — the first close this decision loop ever saw for the security
 *   (`priceHistory[0]`, or the current price on its very first round), with a symmetric
 *   `bandPct` bear/bull spread. Point-in-time by construction, for ANY replay start date.
 * - `config` — `SecurityConfig.valuation.baseBusinessValuePerShare` as written. Only honest when
 *   that anchor was knowable before the first date traded — see `assertPointInTimeAnchors`.
 *
 * Why `first_observed` is the default: the config anchors in quant-v0 were pulled AFTER the
 * backtest window (min/last/max close of the window itself), which handed `valuation_gap` the
 * window's ending price on day one — a 2026-09 audit measured that hindsight at roughly 20-30
 * points of walk-forward return.
 */
export type BaseAnchorPolicy = { mode: 'first_observed'; bandPct: number } | { mode: 'config' };

export const DEFAULT_BASE_ANCHOR_POLICY: BaseAnchorPolicy = {
  mode: 'first_observed',
  bandPct: 0.25,
};

export function resolveStaticBaseAnchor(
  configAnchor: ScenarioValue,
  priceHistory: DailyBar[],
  currentPriceDollars: number,
  policy: BaseAnchorPolicy = DEFAULT_BASE_ANCHOR_POLICY,
): ScenarioValue {
  if (policy.mode === 'config') return configAnchor;
  const first = priceHistory[0]?.close ?? currentPriceDollars;
  return { bear: first * (1 - policy.bandPct), base: first, bull: first * (1 + policy.bandPct) };
}

/**
 * Throws when `policy` uses config anchors that were not knowable on `firstTradingDate` — an
 * anchor with no `anchorAsOf` at all, or one dated after it. The same "fail loudly instead of
 * reporting a contaminated number" rule the walk-forward harness applies to its own inputs. A
 * no-op for `first_observed`, which can't look ahead.
 */
export function assertPointInTimeAnchors<T>(
  securities: SecurityConfig<T>[],
  policy: BaseAnchorPolicy,
  firstTradingDate: string,
): void {
  if (policy.mode !== 'config') return;
  const offenders = securities
    .filter(
      (s) => s.valuation.anchorAsOf === undefined || s.valuation.anchorAsOf > firstTradingDate,
    )
    .map((s) => `${s.ticker} (anchorAsOf ${s.valuation.anchorAsOf ?? 'missing'})`);
  if (offenders.length > 0) {
    throw new Error(
      `config base-value anchors are from after the first trading date ${firstTradingDate}: ` +
        `${offenders.join(', ')}. Use baseAnchor mode 'first_observed' or start later.`,
    );
  }
}
