import { toCents } from '../money.js';
import {
  applyFill,
  getPosition,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
  remainingBuyingPowerCents,
} from '../portfolio/accounting.js';
import type {
  DailyBar,
  ExecutionConfig,
  Fill,
  OrderRequest,
  PortfolioAccount,
  RiskConfig,
} from '../types.js';

/** What `resolveOrdersForPortfolio` needs beyond the bars themselves to model realistic
 * execution — see `ExecutionConfigSchema` in `../types.ts`. `advSharesByTicker` is each ticker's
 * average daily volume over the trailing window BEFORE the fill date (a ticker with no such
 * history is simply absent: no participation cap and no impact, rather than an invented volume). */
export interface ExecutionContext {
  config: ExecutionConfig;
  advSharesByTicker: ReadonlyMap<string, number>;
}

/** Original behavior: same-close MARKET fills, no spread/impact/volume cap. */
const LEGACY_EXECUTION: ExecutionContext = {
  config: {
    fillTiming: 'same_close',
    halfSpreadBps: 0,
    impactCoefficientBps: 0,
    maxAdvParticipation: null,
    advWindowDays: 20,
  },
  advSharesByTicker: new Map(),
};

/**
 * The price (in dollars) `order` would fill at against `bar`, or `null` if it doesn't fill at all
 * this round — spec §29/§30's simplified, order-book-free execution: every order is a price-taker
 * against the real historical tape, never matched against another participant.
 *
 * - MARKET always fills — at the day's close under `fillTiming: 'same_close'` (the same close
 *   the bot already saw), or at the day's OPEN under `'next_open'` (`game.ts` then resolves an
 *   order against the trading day AFTER the one it was submitted on). Spread/impact are applied on
 *   top of this reference price by `marketFillPriceDollars`, not here.
 * - LIMIT fills only if the day's range would plausibly have let it: a BUY if the day's low was at
 *   or below the limit, a SELL if the day's high was at or above it — and fills AT the limit price
 *   itself (no price-improvement modeling; simplest defensible rule for a game with no order book
 *   to derive a better fill from).
 */
function referencePriceDollars(
  order: OrderRequest,
  bar: DailyBar,
  fillTiming: ExecutionConfig['fillTiming'],
): number | null {
  if (order.kind === 'MARKET') {
    return fillTiming === 'next_open' ? bar.open : bar.close;
  }
  if (order.side === 'BUY') {
    return bar.low <= order.limitPrice ? order.limitPrice : null;
  }
  return bar.high >= order.limitPrice ? order.limitPrice : null;
}

/**
 * How much of `order` can actually execute — a requested quantity beyond either cap is silently
 * reduced (a partial fill), never rejected outright; see `Fill`'s own doc comment for why the
 * reduced amount is still reported rather than treated as an error.
 *
 * `risk.allowShortSelling` decides which rules apply (spec §38):
 * - **Off** (a plain cash account): the original, long-only rule — SELL capped to shares
 *   currently held (never opens a short), BUY capped to what literal cash affords, fee included.
 * - **On** (margin/short account): capacity comes from buying power (equity / initialMarginRatio,
 *   minus exposure already in use — see `portfolio/accounting.ts`'s `remainingBuyingPowerCents`),
 *   not literal cash — a real margin account can buy beyond its cash balance, financed by a
 *   margin loan (cash is simply allowed to go negative; see `applyFill`). A SELL beyond current
 *   shares opens/extends a short, additionally capped by `risk.borrowableShares`.
 */
function maxFillableQuantity(
  order: OrderRequest,
  portfolio: PortfolioAccount,
  priceCents: number,
  feeRate: number,
  risk: RiskConfig,
  marksCents: ReadonlyMap<string, number>,
): number {
  const currentShares = getPosition(portfolio, order.ticker).shares;

  if (!risk.allowShortSelling) {
    if (order.side === 'SELL') {
      return Math.max(0, Math.min(order.quantity, currentShares));
    }
    if (priceCents <= 0) {
      return order.quantity;
    }
    const costPerShareCents = priceCents * (1 + feeRate);
    const affordable = Math.floor(portfolio.cashCents / costPerShareCents);
    return Math.max(0, Math.min(order.quantity, affordable));
  }

  const buyingPower = remainingBuyingPowerCents(portfolio, marksCents, risk);
  if (order.side === 'BUY') {
    return Math.max(
      0,
      Math.min(order.quantity, maxBuyQuantityByMargin(currentShares, buyingPower, priceCents)),
    );
  }
  return Math.max(
    0,
    Math.min(
      order.quantity,
      maxSellQuantityByMargin(currentShares, buyingPower, priceCents, risk.borrowableShares),
    ),
  );
}

/** A MARKET order's all-in fill price: the reference price moved against the trader by half the
 * spread plus square-root impact on `quantity` shares relative to average daily volume. */
function marketFillPriceDollars(
  order: OrderRequest,
  referenceDollars: number,
  quantity: number,
  execution: ExecutionContext,
): number {
  const adv = execution.advSharesByTicker.get(order.ticker);
  const impactBps =
    adv !== undefined && adv > 0
      ? execution.config.impactCoefficientBps * Math.sqrt(quantity / adv)
      : 0;
  const costFraction = (execution.config.halfSpreadBps + impactBps) / 10_000;
  return order.side === 'BUY'
    ? referenceDollars * (1 + costFraction)
    : referenceDollars * (1 - costFraction);
}

/** `order.quantity` capped at `maxAdvParticipation` of average daily volume, when both are known. */
function participationCappedQuantity(order: OrderRequest, execution: ExecutionContext): number {
  const cap = execution.config.maxAdvParticipation;
  const adv = execution.advSharesByTicker.get(order.ticker);
  if (cap === null || adv === undefined) return order.quantity;
  return Math.min(order.quantity, Math.floor(cap * adv));
}

function zeroFill(order: OrderRequest, priceCents = 0): Fill {
  return {
    ticker: order.ticker,
    side: order.side,
    kind: order.kind,
    requestedQuantity: order.quantity,
    filledQuantity: 0,
    priceCents,
    feeCents: 0,
  };
}

/**
 * Resolves one participant's whole order list against that round's bars, in submission order —
 * so a SELL later in the same list sees the position a BUY earlier in it just opened. Every order
 * produces exactly one `Fill` (possibly `0`-filled), even one for a ticker with no bar that day
 * (a data gap — see `market/historicalPrices.ts`) or a LIMIT that never crossed.
 *
 * `execution` (default: the original same-close, cost-free model) sets the MARKET reference price
 * (close vs. open), the spread/impact a MARKET fill pays, and the volume cap every fill obeys. A
 * LIMIT fills at its own limit price, so it pays no spread or impact, but is still volume-capped.
 */
export function resolveOrdersForPortfolio(
  portfolio: PortfolioAccount,
  orders: readonly OrderRequest[],
  barsByTicker: ReadonlyMap<string, DailyBar | null>,
  feeRate: number,
  risk: RiskConfig,
  execution: ExecutionContext = LEGACY_EXECUTION,
): { portfolio: PortfolioAccount; fills: Fill[] } {
  let nextPortfolio = portfolio;
  const fills: Fill[] = [];

  // The day's close, in cents, per ticker — used only for margin-capacity math (buying power is
  // computed against the CURRENT `nextPortfolio`, which does change fill-to-fill; the market
  // prices behind it don't, for the one day this whole batch resolves against).
  const marksCents = new Map<string, number>();
  for (const [ticker, bar] of barsByTicker) {
    if (bar !== null) {
      marksCents.set(ticker, toCents(bar.close));
    }
  }

  for (const order of orders) {
    const bar = barsByTicker.get(order.ticker) ?? null;
    if (bar === null) {
      fills.push(zeroFill(order));
      continue;
    }

    const referenceDollars = referencePriceDollars(order, bar, execution.config.fillTiming);
    if (referenceDollars === null) {
      fills.push(zeroFill(order));
      continue;
    }
    const cappedQuantity = participationCappedQuantity(order, execution);
    // Impact is priced on the volume-capped request (an upper bound on what actually fills), so
    // affordability below is checked against a price that can only be too high, never too low.
    const priceCents = toCents(
      order.kind === 'MARKET'
        ? marketFillPriceDollars(order, referenceDollars, cappedQuantity, execution)
        : referenceDollars,
    );

    const quantity = maxFillableQuantity(
      { ...order, quantity: cappedQuantity },
      nextPortfolio,
      priceCents,
      feeRate,
      risk,
      marksCents,
    );
    if (quantity === 0) {
      fills.push(zeroFill(order, priceCents));
      continue;
    }

    const feeCents = Math.round(quantity * priceCents * feeRate);
    nextPortfolio = applyFill(
      nextPortfolio,
      order.ticker,
      order.side,
      quantity,
      priceCents,
      feeCents,
    );
    fills.push({
      ticker: order.ticker,
      side: order.side,
      kind: order.kind,
      requestedQuantity: order.quantity,
      filledQuantity: quantity,
      priceCents,
      feeCents,
    });
  }

  return { portfolio: nextPortfolio, fills };
}
