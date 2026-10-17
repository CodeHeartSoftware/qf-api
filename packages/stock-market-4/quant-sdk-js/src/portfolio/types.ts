import type { SelectionPolicy } from './selection.js';

/** One security's inputs to portfolio construction — everything a `PortfolioStrategy` needs,
 * already computed upstream by the alpha ensemble (`../alpha/ic.ts`) and volatility math
 * (`../signal.ts`, reused unchanged). */
export interface AlphaInput {
  ticker: string;
  expectedReturn: number;
  confidence: number;
  /** `undefined` when there isn't enough trailing price history yet — see
   * `inverseVolatility.ts`/`riskParity.ts` for how each strategy falls back when this is missing. */
  dailyVolatility: number | undefined;
}

export interface PortfolioConstructionInput {
  alphas: AlphaInput[];
  /** Blended statistical+causal correlation (`../correlation/blended.ts`) between every PAIR of
   * securities, keyed by `${a}|${b}` with `a < b` (lexicographic) so a lookup never depends on
   * argument order — see `effectiveCorrelationKey`. */
  effectiveCorrelationByPair: Map<string, number>;
}

export function effectiveCorrelationKey(tickerA: string, tickerB: string): string {
  return tickerA < tickerB ? `${tickerA}|${tickerB}` : `${tickerB}|${tickerA}`;
}

/** Config every `PortfolioStrategy` shares — NOT strategy-specific tuning (each strategy may still
 * have its own additional knobs, e.g. `riskParity.ts`'s correlation penalty), just the common
 * "how much conviction before a name is even considered" / "how much gross exposure to deploy"
 * inputs every allocation scheme needs. */
export interface PortfolioConstructionPolicy {
  /** A security whose `expectedReturn * confidence` is below this is left at zero weight — the
   * activation gate every strategy below applies identically, so differences between strategies
   * come only from HOW active names are sized relative to each other, not WHICH names are active.
   * Phase 1 is deliberately LONG-ONLY (a negative combined signal means "not held," not "shorted")
   * — see `../portfolio.ts`'s `buildOrders` doc comment; shorting is an explicitly deferred
   * extension, not an oversight. */
  activationThreshold: number;
  /** Fraction of equity to distribute (gross, i.e. summed as absolute values) across every active
   * security — the "how much to deploy" budget, independent of `maxPositionWeight`'s per-name cap
   * (a strategy's raw share can still be individually clipped below). */
  totalGrossBudgetPct: number;
  maxPositionWeight: number;
  /** Which names get sized at all — see `./selection.ts`. Omitted means `threshold` (the
   * `activationThreshold` gate above). */
  selection?: SelectionPolicy;
}

export interface PortfolioConstructionResult {
  weightByTicker: Map<string, number>;
  note: string;
}

/** Pluggable, empirically-comparable portfolio-construction strategy (plan Phase 1, item 5) — NOT
 * a hardcoded mean-variance optimizer, which the plan explicitly rejects as premature "manufactured
 * precision" given ~11 securities and ~2 months of real history (a covariance matrix estimated from
 * that little data would be dominated by estimation noise, not signal). */
export interface PortfolioStrategy {
  name: string;
  construct(
    input: PortfolioConstructionInput,
    policy: PortfolioConstructionPolicy,
  ): PortfolioConstructionResult;
}
