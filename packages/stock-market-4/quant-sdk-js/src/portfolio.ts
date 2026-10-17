import type { OrderRequest, PortfolioObservation } from './marketTypes.js';

/** Everything `buildOrders` needs from config, trimmed down from `fusion-fundamental-v7`'s much
 * larger `PortfolioPolicy` (that bot's discrete-signal-bucket target weights, short-selling gates,
 * emergency reserves, etc. have no equivalent in this bot's architecture — see
 * `./decision.ts`/`./config.ts`'s own doc comments on what replaced them). */
export interface OrderPolicy {
  /** Below this notional (cents), a rebalancing trade isn't worth generating. */
  minOrderNotionalCents: number;
  /** Fraction of equity: a position within this much of its target weight isn't rebalanced at
   * all, even if the target technically differs — stops ordinary daily price drift from re-trading
   * back to an exact target every round. */
  rebalanceToleranceWeight: number;
}

/**
 * The real spendable limit for a NEW buy, in either account mode — unchanged from
 * `fusion-fundamental-v7`'s own `spendableCentsFor` (see that bot's doc comment for the full
 * "why not just trust `buyingPowerCents`" rationale: a plain cash account reports that as exactly
 * `0`, so trusting it unconditionally would leave this bot unable to ever buy anything under the
 * engine's default cash-only risk settings).
 */
export function spendableCentsFor(portfolio: PortfolioObservation): number {
  return portfolio.buyingPowerCents > 0
    ? portfolio.buyingPowerCents
    : Math.max(0, portfolio.cashCents);
}

/**
 * Translates a target weight into ordinary stock-market-4 `OrderRequest`s — unchanged in spirit
 * from `fusion-fundamental-v7`'s own `buildOrders`, minus that bot's short-selling/short-budget
 * machinery (this bot's `risk/riskEngine.ts` only ever shrinks a weight toward zero, it never
 * produces a target weight more negative than what portfolio construction itself proposed, and
 * none of this bot's `PortfolioStrategy` implementations open shorts — see `portfolio/types.ts`).
 * Returns `[]` whenever there's nothing worth doing: no forced target, the position is already
 * within `rebalanceToleranceWeight` of the target, or the resulting trade is below
 * `minOrderNotionalCents`.
 */
export function buildOrders(params: {
  ticker: string;
  targetWeight: number | undefined;
  priceDollars: number;
  portfolio: PortfolioObservation;
  policy: OrderPolicy;
  availableBuyingPowerCents?: number | undefined;
}): OrderRequest[] {
  if (params.targetWeight === undefined) return [];
  if (params.priceDollars <= 0) return [];
  if (params.portfolio.equityCents <= 0) return [];

  const priceCents = Math.round(params.priceDollars * 100);
  const position = params.portfolio.positions.find((p) => p.ticker === params.ticker);
  const currentShares = position?.shares ?? 0;
  const currentPositionValueCents = currentShares * priceCents;
  const currentWeight = currentPositionValueCents / params.portfolio.equityCents;

  const weightDrift = Math.abs(params.targetWeight - currentWeight);
  if (weightDrift < params.policy.rebalanceToleranceWeight) return [];

  const targetEquityCents = params.targetWeight * params.portfolio.equityCents;
  const deltaCents = targetEquityCents - currentPositionValueCents;
  if (Math.abs(deltaCents) < params.policy.minOrderNotionalCents) return [];

  if (params.targetWeight <= 0) {
    if (currentShares <= 0) return [];
    return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity: currentShares }];
  }

  if (deltaCents > 0) {
    const buyingPowerCents = Math.max(
      0,
      params.availableBuyingPowerCents ?? spendableCentsFor(params.portfolio),
    );
    const buyCents = Math.min(deltaCents, buyingPowerCents);
    const quantity = Math.floor(buyCents / priceCents);
    if (quantity <= 0) return [];
    return [{ kind: 'MARKET', ticker: params.ticker, side: 'BUY', quantity }];
  }

  const sellCents = Math.min(-deltaCents, Math.max(0, currentPositionValueCents));
  const quantity = Math.min(Math.floor(sellCents / priceCents), Math.max(0, currentShares));
  if (quantity <= 0) return [];
  return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity }];
}
