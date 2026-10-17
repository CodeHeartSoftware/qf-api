import type { OrderSide, PortfolioAccount, Position, RiskConfig } from '../types.js';

const EMPTY_POSITION: Position = { shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0 };

/** A fresh, all-cash portfolio — the starting point for every participant (spec §9's
 * `startingCapital`, converted to cents via `money.ts`'s `toCents`). */
export function createPortfolio(startingCashCents: number): PortfolioAccount {
  return { cashCents: startingCashCents, positions: new Map() };
}

export function getPosition(portfolio: PortfolioAccount, securityId: string): Position {
  return portfolio.positions.get(securityId) ?? EMPTY_POSITION;
}

/**
 * Applies one fill in one security to a portfolio (spec §29/§30 — portfolio-level accounting
 * across many securities). The per-position math (weighted-average cost basis; realizing P&L
 * correctly through a partial close, a full close, or a fill large enough to flip straight
 * through flat) is ported unchanged from games/stock-market-3's `applyFill` — only the *key*
 * changes: `securityId` (a `Security.id`, stable across a ticker change) rather than a ticker
 * symbol, since this game's positions must survive a rename untouched (see `Security` in
 * types.ts).
 */
export function applyFill(
  portfolio: PortfolioAccount,
  securityId: string,
  side: OrderSide,
  quantity: number,
  priceCents: number,
  feeCents: number,
): PortfolioAccount {
  const position = getPosition(portfolio, securityId);
  const signedDelta = side === 'BUY' ? quantity : -quantity;
  const oldShares = position.shares;
  const newShares = oldShares + signedDelta;

  let realizedDeltaCents = 0;
  let averageEntryPriceCents = position.averageEntryPriceCents;

  if (oldShares === 0 || Math.sign(oldShares) === Math.sign(signedDelta)) {
    const oldNotionalCents = Math.abs(oldShares) * position.averageEntryPriceCents;
    const addNotionalCents = quantity * priceCents;
    averageEntryPriceCents = Math.round(
      (oldNotionalCents + addNotionalCents) / Math.abs(newShares),
    );
  } else {
    const closingQuantity = Math.min(Math.abs(oldShares), quantity);
    const pnlPerShareCents =
      oldShares > 0
        ? priceCents - position.averageEntryPriceCents
        : position.averageEntryPriceCents - priceCents;
    realizedDeltaCents = pnlPerShareCents * closingQuantity;

    if (newShares === 0) {
      averageEntryPriceCents = 0;
    } else if (Math.sign(newShares) !== Math.sign(oldShares)) {
      averageEntryPriceCents = priceCents;
    }
  }

  const cashDeltaCents = (side === 'BUY' ? -1 : 1) * quantity * priceCents - feeCents;
  const nextPositions = new Map(portfolio.positions);
  nextPositions.set(securityId, {
    shares: newShares,
    averageEntryPriceCents: newShares === 0 ? 0 : averageEntryPriceCents,
    realizedPnlCents: position.realizedPnlCents + realizedDeltaCents,
  });

  return {
    ...portfolio,
    cashCents: portfolio.cashCents + cashDeltaCents,
    positions: nextPositions,
  };
}

function markPriceOf(markPricesCents: ReadonlyMap<string, number>, securityId: string): number {
  return markPricesCents.get(securityId) ?? 0;
}

/** Net liquidation value across every security the account holds. */
export function equityCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
): number {
  let total = portfolio.cashCents;
  for (const [securityId, position] of portfolio.positions) {
    total += position.shares * markPriceOf(markPricesCents, securityId);
  }
  return total;
}

/** Total gross exposure (long + short, across all securities) — what portfolio-level margin
 * requirements will eventually be sized against once the risk/financing phase lands. */
export function grossPositionValueCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const [securityId, position] of portfolio.positions) {
    total += Math.abs(position.shares) * markPriceOf(markPricesCents, securityId);
  }
  return total;
}

export function longExposureCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const [securityId, position] of portfolio.positions) {
    if (position.shares > 0) {
      total += position.shares * markPriceOf(markPricesCents, securityId);
    }
  }
  return total;
}

export function shortExposureCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const [securityId, position] of portfolio.positions) {
    if (position.shares < 0) {
      total += -position.shares * markPriceOf(markPricesCents, securityId);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Margin (spec §38, ported from stock-market-3's `portfolio/accounting.ts`) — meaningful only
// when `risk.allowShortSelling` is on; every function below is written so `allowShortSelling:
// false` degenerates to "no margin capacity, no maintenance requirement, never below it," which
// is exactly what a plain cash account needs (see `execution/orders.ts`, which uses `cashCents`
// itself, not these, as its own cap in that case).
// ---------------------------------------------------------------------------

/** Total gross position value this account may hold across every ticker combined right now
 * (Reg-T-style: equity / initialMarginRatio), minus whatever's already in use. `0` whenever
 * short selling/margin is disabled. */
export function remainingBuyingPowerCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
  risk: RiskConfig,
): number {
  if (!risk.allowShortSelling) {
    return 0;
  }
  const totalCapacity = Math.max(
    0,
    equityCents(portfolio, markPricesCents) / risk.initialMarginRatio,
  );
  const used = grossPositionValueCents(portfolio, markPricesCents);
  return Math.max(0, totalCapacity - used);
}

export function maintenanceRequirementCents(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
  risk: RiskConfig,
): number {
  if (!risk.allowShortSelling) {
    return 0;
  }
  return risk.maintenanceMarginRatio * grossPositionValueCents(portfolio, markPricesCents);
}

export function isBelowMaintenance(
  portfolio: PortfolioAccount,
  markPricesCents: ReadonlyMap<string, number>,
  risk: RiskConfig,
): boolean {
  if (!risk.allowShortSelling || portfolio.positions.size === 0) {
    return false;
  }
  return (
    equityCents(portfolio, markPricesCents) <
    maintenanceRequirementCents(portfolio, markPricesCents, risk)
  );
}

/** Ported unchanged from stock-market-3 (itself ported from stock-market-2) — these two only ever
 * operate on plain numbers (one ticker's current share count, and the account's already-computed
 * *remaining* buying power), so nothing here needs to change to be reused as-is. */
export function maxBuyQuantityByMargin(
  currentShares: number,
  buyingPower: number,
  priceCents: number,
): number {
  if (priceCents <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (currentShares <= 0) {
    const coveringRoom = -currentShares;
    const longRoomAfterFlat = Math.floor(buyingPower / priceCents);
    return coveringRoom + Math.max(0, longRoomAfterFlat);
  }
  return Math.max(0, Math.floor(buyingPower / priceCents) - currentShares);
}

export function maxSellQuantityByMargin(
  currentShares: number,
  buyingPower: number,
  priceCents: number,
  borrowableShares: number,
): number {
  if (priceCents <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (currentShares >= 0) {
    const reducingRoom = currentShares;
    const shortRoomByMargin = Math.floor(buyingPower / priceCents);
    return reducingRoom + Math.max(0, Math.min(shortRoomByMargin, borrowableShares));
  }
  const currentShortSize = -currentShares;
  const shortRoomByMargin = Math.max(0, Math.floor(buyingPower / priceCents) - currentShortSize);
  const shortRoomByBorrow = Math.max(0, borrowableShares - currentShortSize);
  return Math.min(shortRoomByMargin, shortRoomByBorrow);
}
