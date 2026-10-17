import { historicalBarsAsOf } from './historicalPrices.js';
import { toCents } from '../money.js';
import { getPosition } from '../portfolio/accounting.js';
import type {
  CalendarDate,
  CorporateAction,
  DailyBar,
  PortfolioAccount,
  Position,
} from '../types.js';

// ---------------------------------------------------------------------------
// Splits/reverse-splits — the only corporate-action types that mechanically adjust price history
// and an existing position (spec §40's worked example: a split must not look like a 50% loss).
// Ported from stock-market-3's `market/corporateActions.ts`, adapted from "mutate the simulated
// SecurityState in place" to "compute an adjusted VIEW of the static, organizer-supplied bar
// series" — this game replays real history rather than simulating it, so the raw bars themselves
// are never rewritten.
// ---------------------------------------------------------------------------

function isSplitLike(
  action: CorporateAction,
): action is Extract<CorporateAction, { type: 'STOCK_SPLIT' | 'REVERSE_SPLIT' }> {
  return action.type === 'STOCK_SPLIT' || action.type === 'REVERSE_SPLIT';
}

/**
 * The cumulative price-scaling factor a bar dated `barDate` must be multiplied by to read
 * correctly as of `asOfDate` — the product of `fromShares/toShares` for every split/reverse-split
 * on `ticker` strictly after `barDate` and at or before `asOfDate`. `1` (no adjustment) for a bar
 * on or after the most recent relevant split, or when no split has happened yet.
 *
 * The `action.date <= asOfDate` half of that condition is the one genuinely load-bearing rule
 * here: a split dated AFTER `asOfDate` (hasn't happened yet, from today's vantage point) must
 * contribute nothing, or every bar before it would silently encode a corporate action that, as of
 * today, hasn't occurred — a real lookahead bug, not just an inconvenience. Once `asOfDate`
 * reaches/passes the split's own date, the same bars retroactively become adjusted — this is
 * expected (real adjusted-close data behaves identically) and is not a second instance of the
 * same bug: it reflects what's knowable as of `asOfDate`, which is the only thing this function
 * is answerable to.
 */
export function cumulativeSplitFactor(
  actions: readonly CorporateAction[],
  ticker: string,
  barDate: CalendarDate,
  asOfDate: CalendarDate,
): number {
  let factor = 1;
  for (const action of actions) {
    if (action.ticker !== ticker || !isSplitLike(action)) continue;
    if (action.date > barDate && action.date <= asOfDate) {
      factor *= action.fromShares / action.toShares;
    }
  }
  return factor;
}

function scaleBar(bar: DailyBar, factor: number): DailyBar {
  if (factor === 1) return bar;
  return {
    ...bar,
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close: bar.close * factor,
    // Volume deliberately left unscaled — same simplification as stock-market-3's `adjustCandle`.
  };
}

/**
 * `historicalBarsAsOf` (no-lookahead date filtering), with every returned bar split-adjusted
 * against `actions` so the series reads as continuous across a split rather than showing a fake
 * price cliff on the split's own date — the combination that actually belongs in a bot's
 * observation (see `game.ts`).
 */
export function splitAdjustedBarsAsOf(
  bars: readonly DailyBar[],
  actions: readonly CorporateAction[],
  ticker: string,
  asOfDate: CalendarDate,
  maxDays: number,
): DailyBar[] {
  return historicalBarsAsOf(bars, asOfDate, maxDays).map((bar) =>
    scaleBar(bar, cumulativeSplitFactor(actions, ticker, bar.date, asOfDate)),
  );
}

/** Applies one STOCK_SPLIT/REVERSE_SPLIT to a held position: share count scales by
 * `toShares/fromShares`, cost basis scales by the inverse (the same `fromShares/toShares` factor
 * `scaleBar` above uses) — so unrealized P&L is unchanged by the split itself, exactly like a
 * real brokerage statement. A no-op (returns `position` unchanged) for any other action type. */
export function adjustPositionForSplit(position: Position, action: CorporateAction): Position {
  if (!isSplitLike(action)) return position;
  const shareFactor = action.toShares / action.fromShares;
  const priceFactor = action.fromShares / action.toShares;
  return {
    ...position,
    shares: Math.round(position.shares * shareFactor),
    averageEntryPriceCents:
      position.shares === 0 ? 0 : Math.round(position.averageEntryPriceCents * priceFactor),
  };
}

// ---------------------------------------------------------------------------
// Dividends — a cash event only; never touches price history or share count in this model.
// ---------------------------------------------------------------------------

/** The cash flow a CASH_DIVIDEND applies to one position — positive for a long (receives it),
 * negative for a short (owes it to the lender), one formula covering both signs of
 * `position.shares`, ported unchanged from stock-market-3. `perShareCents` is already converted
 * from the config-declared dollar amount (see `money.ts`'s `toCents`) by the caller. */
export function dividendCashDeltaCents(position: Position, perShareCents: number): number {
  return position.shares * perShareCents;
}

// ---------------------------------------------------------------------------
// Settlement — applying a STOCK_SPLIT/REVERSE_SPLIT/CASH_DIVIDEND directly onto a participant's
// portfolio the moment it takes effect. BUYBACK/ACQUISITION/DELISTING are deliberately absent
// here (see their doc comments above/in types.ts): forcing a position closed or repurchased needs
// a mechanism this game doesn't have yet (TODO risk/financing phase).
// ---------------------------------------------------------------------------

/**
 * Applies every STOCK_SPLIT/REVERSE_SPLIT/CASH_DIVIDEND effective on EXACTLY `date` (not merely
 * visible as of it — an acquisition's advance announcement, for instance, is visible well before
 * its own effective date and must not be settled here yet) to `portfolio`. Safe to call whether
 * or not `portfolio` holds the named ticker: `adjustPositionForSplit`/`dividendCashDeltaCents` are
 * both no-ops (0 shares, 0 cash) on a flat position, so this never needs its own "is it held"
 * check first.
 */
export function settleCorporateActionsForPortfolio(
  portfolio: PortfolioAccount,
  actions: readonly CorporateAction[],
  date: CalendarDate,
): PortfolioAccount {
  let next = portfolio;
  for (const action of actions) {
    if (action.date !== date) continue;

    if (isSplitLike(action)) {
      const nextPositions = new Map(next.positions);
      nextPositions.set(
        action.ticker,
        adjustPositionForSplit(getPosition(next, action.ticker), action),
      );
      next = { ...next, positions: nextPositions };
    } else if (action.type === 'CASH_DIVIDEND') {
      const cashDeltaCents = dividendCashDeltaCents(
        getPosition(next, action.ticker),
        toCents(action.perShare),
      );
      next = { ...next, cashCents: next.cashCents + cashDeltaCents };
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Visibility — which corporate actions a bot is even allowed to know about yet.
// ---------------------------------------------------------------------------

/** Every action already public as of `asOfDate`: a dividend/split/reverse-split/buyback the
 * moment it takes effect (no separate announcement in this model), or an acquisition/delisting
 * from its own, earlier `announcedDate` when one is declared — never before either date, so a
 * bot can never learn of a corporate action ahead of when it was actually knowable. */
export function visibleCorporateActions(
  actions: readonly CorporateAction[],
  asOfDate: CalendarDate,
): CorporateAction[] {
  return actions.filter((action) => (action.announcedDate ?? action.date) <= asOfDate);
}
