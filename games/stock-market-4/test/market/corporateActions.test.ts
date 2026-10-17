import { describe, expect, it } from 'vitest';
import {
  adjustPositionForSplit,
  cumulativeSplitFactor,
  dividendCashDeltaCents,
  settleCorporateActionsForPortfolio,
  splitAdjustedBarsAsOf,
  visibleCorporateActions,
} from '../../src/market/corporateActions.js';
import { applyFill, createPortfolio } from '../../src/portfolio/accounting.js';
import type { CorporateAction, DailyBar, Position } from '../../src/types.js';

function bar(date: string, price: number): DailyBar {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

const TWO_FOR_ONE: CorporateAction = {
  type: 'STOCK_SPLIT',
  ticker: 'NVDA',
  date: '2026-01-07',
  fromShares: 1,
  toShares: 2,
};

const ONE_FOR_FOUR_REVERSE: CorporateAction = {
  type: 'REVERSE_SPLIT',
  ticker: 'NVDA',
  date: '2026-01-07',
  fromShares: 4,
  toShares: 1,
};

describe('cumulativeSplitFactor', () => {
  it('is 1 (no adjustment) for a bar dated on or after the split itself', () => {
    expect(cumulativeSplitFactor([TWO_FOR_ONE], 'NVDA', '2026-01-07', '2026-01-10')).toBe(1);
    expect(cumulativeSplitFactor([TWO_FOR_ONE], 'NVDA', '2026-01-08', '2026-01-10')).toBe(1);
  });

  it('halves a bar dated before a 2-for-1 split, once the split has happened', () => {
    expect(cumulativeSplitFactor([TWO_FOR_ONE], 'NVDA', '2026-01-05', '2026-01-10')).toBe(0.5);
  });

  it('quadruples a bar dated before a 1-for-4 reverse split, once it has happened', () => {
    expect(cumulativeSplitFactor([ONE_FOR_FOUR_REVERSE], 'NVDA', '2026-01-05', '2026-01-10')).toBe(
      4,
    );
  });

  it("does NOT adjust a bar for a split that hasn't happened yet as of asOfDate — no lookahead", () => {
    // asOfDate (01-06) is before the split's own date (01-07): from today's vantage point, the
    // split simply hasn't occurred, so it must contribute nothing.
    expect(cumulativeSplitFactor([TWO_FOR_ONE], 'NVDA', '2026-01-05', '2026-01-06')).toBe(1);
  });

  it('compounds two splits on the same ticker', () => {
    const secondSplit: CorporateAction = { ...TWO_FOR_ONE, date: '2026-02-01' };
    const factor = cumulativeSplitFactor(
      [TWO_FOR_ONE, secondSplit],
      'NVDA',
      '2026-01-01',
      '2026-03-01',
    );
    expect(factor).toBe(0.25); // 0.5 * 0.5
  });

  it('ignores a split on a different ticker', () => {
    expect(cumulativeSplitFactor([TWO_FOR_ONE], 'AMD', '2026-01-05', '2026-01-10')).toBe(1);
  });

  it('ignores non-split action types', () => {
    const dividend: CorporateAction = {
      type: 'CASH_DIVIDEND',
      ticker: 'NVDA',
      date: '2026-01-07',
      perShare: 1,
    };
    expect(cumulativeSplitFactor([dividend], 'NVDA', '2026-01-05', '2026-01-10')).toBe(1);
  });
});

describe('splitAdjustedBarsAsOf', () => {
  const series = [bar('2026-01-05', 400), bar('2026-01-06', 404), bar('2026-01-07', 202)];

  it('reads as a continuous series across the split date — no fake cliff', () => {
    const adjusted = splitAdjustedBarsAsOf(series, [TWO_FOR_ONE], 'NVDA', '2026-01-07', 10);
    expect(adjusted.map((b) => b.close)).toEqual([200, 202, 202]); // 400/2, 404/2, 202 (unadjusted)
  });

  it('shows the raw, unadjusted series before the split has happened — no lookahead', () => {
    const adjusted = splitAdjustedBarsAsOf(series, [TWO_FOR_ONE], 'NVDA', '2026-01-06', 10);
    expect(adjusted.map((b) => b.close)).toEqual([400, 404]);
  });

  it('never leaks a bar dated after asOfDate, same as historicalBarsAsOf', () => {
    const adjusted = splitAdjustedBarsAsOf(series, [TWO_FOR_ONE], 'NVDA', '2026-01-06', 10);
    expect(adjusted.every((b) => b.date <= '2026-01-06')).toBe(true);
  });

  it('leaves volume unscaled', () => {
    const adjusted = splitAdjustedBarsAsOf(series, [TWO_FOR_ONE], 'NVDA', '2026-01-07', 10);
    expect(adjusted.every((b) => b.volume === 1000)).toBe(true);
  });
});

describe('adjustPositionForSplit', () => {
  it('doubles shares and halves cost basis on a 2-for-1 split', () => {
    const position: Position = { shares: 10, averageEntryPriceCents: 100_00, realizedPnlCents: 0 };
    expect(adjustPositionForSplit(position, TWO_FOR_ONE)).toEqual({
      shares: 20,
      averageEntryPriceCents: 50_00,
      realizedPnlCents: 0,
    });
  });

  it('quarters shares and quadruples cost basis on a 1-for-4 reverse split', () => {
    const position: Position = { shares: 40, averageEntryPriceCents: 10_00, realizedPnlCents: 0 };
    expect(adjustPositionForSplit(position, ONE_FOR_FOUR_REVERSE)).toEqual({
      shares: 10,
      averageEntryPriceCents: 40_00,
      realizedPnlCents: 0,
    });
  });

  it('is a no-op for a flat position', () => {
    const flat: Position = { shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0 };
    expect(adjustPositionForSplit(flat, TWO_FOR_ONE)).toEqual(flat);
  });

  it('is a no-op for a non-split action type', () => {
    const position: Position = { shares: 10, averageEntryPriceCents: 100_00, realizedPnlCents: 5 };
    const dividend: CorporateAction = {
      type: 'CASH_DIVIDEND',
      ticker: 'NVDA',
      date: '2026-01-07',
      perShare: 1,
    };
    expect(adjustPositionForSplit(position, dividend)).toEqual(position);
  });

  it('preserves realizedPnlCents (a split never itself realizes or destroys P&L)', () => {
    const position: Position = {
      shares: 10,
      averageEntryPriceCents: 100_00,
      realizedPnlCents: 500,
    };
    expect(adjustPositionForSplit(position, TWO_FOR_ONE).realizedPnlCents).toBe(500);
  });
});

describe('dividendCashDeltaCents', () => {
  it('is positive for a long position', () => {
    const long: Position = { shares: 100, averageEntryPriceCents: 0, realizedPnlCents: 0 };
    expect(dividendCashDeltaCents(long, 50)).toBe(5000);
  });

  it('is negative for a short position (owed to the lender)', () => {
    const short: Position = { shares: -100, averageEntryPriceCents: 0, realizedPnlCents: 0 };
    expect(dividendCashDeltaCents(short, 50)).toBe(-5000);
  });

  it('is zero for a flat position', () => {
    const flat: Position = { shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0 };
    expect(dividendCashDeltaCents(flat, 50)).toBe(0);
  });
});

describe('visibleCorporateActions', () => {
  it('makes a dividend/split/buyback visible only once its own date arrives', () => {
    expect(visibleCorporateActions([TWO_FOR_ONE], '2026-01-06')).toEqual([]);
    expect(visibleCorporateActions([TWO_FOR_ONE], '2026-01-07')).toEqual([TWO_FOR_ONE]);
  });

  it('makes an acquisition/delisting visible from its earlier announcedDate, not its effective date', () => {
    const acquisition: CorporateAction = {
      type: 'ACQUISITION',
      ticker: 'NVDA',
      date: '2026-03-01',
      announcedDate: '2026-01-10',
      cashPerShare: 150,
    };
    expect(visibleCorporateActions([acquisition], '2026-01-09')).toEqual([]);
    expect(visibleCorporateActions([acquisition], '2026-01-10')).toEqual([acquisition]);
    expect(visibleCorporateActions([acquisition], '2026-02-01')).toEqual([acquisition]); // still visible, not yet effective
  });
});

describe('settleCorporateActionsForPortfolio', () => {
  it('applies a CASH_DIVIDEND effective exactly on date', () => {
    let portfolio = createPortfolio(1_000_000_00);
    portfolio = applyFill(portfolio, 'NVDA', 'BUY', 100, 100_00, 0);
    const dividend: CorporateAction = {
      type: 'CASH_DIVIDEND',
      ticker: 'NVDA',
      date: '2026-01-07',
      perShare: 2,
    };
    const settled = settleCorporateActionsForPortfolio(portfolio, [dividend], '2026-01-07');
    expect(settled.cashCents).toBe(portfolio.cashCents + 100 * 200);
  });

  it('applies a STOCK_SPLIT effective exactly on date', () => {
    let portfolio = createPortfolio(1_000_000_00);
    portfolio = applyFill(portfolio, 'NVDA', 'BUY', 10, 400_00, 0);
    const settled = settleCorporateActionsForPortfolio(portfolio, [TWO_FOR_ONE], '2026-01-07');
    expect(settled.positions.get('NVDA')).toEqual({
      shares: 20,
      averageEntryPriceCents: 200_00,
      realizedPnlCents: 0,
    });
  });

  it('does not apply an action dated on a different day (before or after)', () => {
    let portfolio = createPortfolio(1_000_000_00);
    portfolio = applyFill(portfolio, 'NVDA', 'BUY', 10, 400_00, 0);
    const beforeSettled = settleCorporateActionsForPortfolio(
      portfolio,
      [TWO_FOR_ONE],
      '2026-01-06',
    );
    const afterSettled = settleCorporateActionsForPortfolio(portfolio, [TWO_FOR_ONE], '2026-01-08');
    expect(beforeSettled).toEqual(portfolio);
    expect(afterSettled).toEqual(portfolio);
  });

  it('does not apply an acquisition/delisting/buyback (no settlement mechanism for those yet)', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const acquisition: CorporateAction = {
      type: 'ACQUISITION',
      ticker: 'NVDA',
      date: '2026-01-07',
      cashPerShare: 150,
    };
    expect(settleCorporateActionsForPortfolio(portfolio, [acquisition], '2026-01-07')).toEqual(
      portfolio,
    );
  });

  it('is a safe no-op for a ticker the portfolio never held', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const dividend: CorporateAction = {
      type: 'CASH_DIVIDEND',
      ticker: 'NVDA',
      date: '2026-01-07',
      perShare: 2,
    };
    const settled = settleCorporateActionsForPortfolio(portfolio, [dividend], '2026-01-07');
    expect(settled.cashCents).toBe(portfolio.cashCents);
  });
});
