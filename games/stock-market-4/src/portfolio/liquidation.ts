import { applyFill, isBelowMaintenance } from './accounting.js';
import type { Fill, PortfolioAccount, RiskConfig } from '../types.js';

function markPriceOf(marksCents: ReadonlyMap<string, number>, ticker: string): number {
  return marksCents.get(ticker) ?? 0;
}

/**
 * Forces a participant's positions flat, ticker by ticker, until equity is back at or above the
 * maintenance requirement (or there's nothing left to liquidate) — spec §38, adapted from
 * stock-market-3's order-book-ladder-based `forceLiquidatePortfolio`. This game has no order book
 * (see the manifest), so each forced trade fills fully, in one step, against that ticker's own
 * historical close for the day — the same reference price a MARKET order would use (see
 * `execution/orders.ts`); `Fill.kind` is reported as `'MARKET'` for exactly that reason, even
 * though nothing here came from a submitted order.
 *
 * Liquidation order is deterministic — largest gross exposure first, ticker name as a tiebreak —
 * so replay/testing never depends on `Map` iteration order. A ticker with no mark price that day
 * is skipped (nothing to fill against); if that leaves the shortfall uncured, the returned
 * portfolio can still be below maintenance (see `PortfolioObservation.belowMaintenance`'s own doc
 * comment for what that means to a bot observing it).
 */
export function forceLiquidatePortfolio(args: {
  portfolio: PortfolioAccount;
  marksCents: ReadonlyMap<string, number>;
  risk: RiskConfig;
  feeRate: number;
}): { portfolio: PortfolioAccount; fills: Fill[] } {
  const { marksCents, risk, feeRate } = args;
  let portfolio = args.portfolio;
  const fills: Fill[] = [];

  const tickersByExposureDesc = [...portfolio.positions.entries()]
    .filter(([, position]) => position.shares !== 0)
    .sort(([tickerA, a], [tickerB, b]) => {
      const exposureA = Math.abs(a.shares) * markPriceOf(marksCents, tickerA);
      const exposureB = Math.abs(b.shares) * markPriceOf(marksCents, tickerB);
      return exposureB - exposureA || tickerA.localeCompare(tickerB);
    })
    .map(([ticker]) => ticker);

  for (const ticker of tickersByExposureDesc) {
    if (!isBelowMaintenance(portfolio, marksCents, risk)) {
      break;
    }
    const position = portfolio.positions.get(ticker);
    if (position === undefined || position.shares === 0) {
      continue;
    }
    const priceCents = markPriceOf(marksCents, ticker);
    if (priceCents <= 0) {
      continue; // no real mark for this ticker today — nothing to liquidate against
    }

    const side = position.shares > 0 ? 'SELL' : 'BUY';
    const quantity = Math.abs(position.shares);
    const feeCents = Math.round(quantity * priceCents * feeRate);
    portfolio = applyFill(portfolio, ticker, side, quantity, priceCents, feeCents);
    fills.push({
      ticker,
      side,
      kind: 'MARKET',
      requestedQuantity: quantity,
      filledQuantity: quantity,
      priceCents,
      feeCents,
    });
  }

  return { portfolio, fills };
}
