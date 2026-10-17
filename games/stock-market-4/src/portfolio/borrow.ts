import { roundHalfUp } from '../money.js';

const TRADING_DAYS_PER_YEAR = 252;

/**
 * The cost of holding a short position in one ticker for one more trading day, charged on its
 * current mark-to-market notional — ported unchanged from stock-market-3 (itself ported from
 * stock-market-2). `borrowFeeAnnualized`/`availableShares` here are the static,
 * organizer-declared numbers from `RiskConfig` — see types.ts's Risk & financing section for why
 * this game doesn't dynamically scale them by aggregate short interest the way stock-market-3
 * does.
 */
export function dailyBorrowFeeCents(
  shortShares: number,
  markPriceCents: number,
  borrowFeeAnnualized: number,
): number {
  const dailyRate = borrowFeeAnnualized / TRADING_DAYS_PER_YEAR;
  return roundHalfUp(shortShares * markPriceCents * dailyRate);
}
