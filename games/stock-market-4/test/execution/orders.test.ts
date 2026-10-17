import { describe, expect, it } from 'vitest';
import { resolveOrdersForPortfolio } from '../../src/execution/orders.js';
import { applyFill, createPortfolio } from '../../src/portfolio/accounting.js';
import type { DailyBar, OrderRequest, RiskConfig } from '../../src/types.js';

function bar(overrides: Partial<DailyBar> = {}): DailyBar {
  return {
    date: '2026-01-05',
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
    ...overrides,
  };
}

const CASH_ONLY: RiskConfig = {
  allowShortSelling: false,
  borrowableShares: 0,
  borrowFeeAnnualized: 0,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

const MARGIN: RiskConfig = {
  allowShortSelling: true,
  borrowableShares: 1000,
  borrowFeeAnnualized: 0.03,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

describe('resolveOrdersForPortfolio', () => {
  it('fills a MARKET order at the day close', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 };
    const { portfolio: next, fills } = resolveOrdersForPortfolio(
      portfolio,
      [order],
      new Map([['NVDA', bar()]]),
      0,
      CASH_ONLY,
    );
    expect(fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'BUY',
        kind: 'MARKET',
        requestedQuantity: 10,
        filledQuantity: 10,
        priceCents: 105_00,
        feeCents: 0,
      },
    ]);
    expect(next.cashCents).toBe(1_000_000_00 - 10 * 105_00);
  });

  it('applies a proportional fee on top of the notional', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 };
    const { fills } = resolveOrdersForPortfolio(
      portfolio,
      [order],
      new Map([['NVDA', bar()]]),
      0.001,
      CASH_ONLY,
    );
    expect(fills[0]?.feeCents).toBe(Math.round(10 * 105_00 * 0.001));
  });

  it('does not fill an order for a ticker with no bar that day', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 };
    const { portfolio: next, fills } = resolveOrdersForPortfolio(
      portfolio,
      [order],
      new Map([['NVDA', null]]),
      0,
      CASH_ONLY,
    );
    expect(fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'BUY',
        kind: 'MARKET',
        requestedQuantity: 10,
        filledQuantity: 0,
        priceCents: 0,
        feeCents: 0,
      },
    ]);
    expect(next).toEqual(portfolio);
  });

  it('does not fill an order for a ticker missing from the bars map at all', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 };
    const { fills } = resolveOrdersForPortfolio(portfolio, [order], new Map(), 0, CASH_ONLY);
    expect(fills[0]?.filledQuantity).toBe(0);
  });

  describe('LIMIT orders', () => {
    it('fills a LIMIT BUY at the limit price when the day low reaches it', () => {
      const portfolio = createPortfolio(1_000_000_00);
      const order: OrderRequest = {
        kind: 'LIMIT',
        ticker: 'NVDA',
        side: 'BUY',
        quantity: 10,
        limitPrice: 95,
      };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]).toMatchObject({ filledQuantity: 10, priceCents: 95_00 });
    });

    it('does not fill a LIMIT BUY when the day low never reaches it', () => {
      const portfolio = createPortfolio(1_000_000_00);
      const order: OrderRequest = {
        kind: 'LIMIT',
        ticker: 'NVDA',
        side: 'BUY',
        quantity: 10,
        limitPrice: 80,
      };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]?.filledQuantity).toBe(0);
    });

    it('fills a LIMIT SELL at the limit price when the day high reaches it', () => {
      let portfolio = createPortfolio(0);
      portfolio = applyFill(portfolio, 'NVDA', 'BUY', 10, 100_00, 0);
      const order: OrderRequest = {
        kind: 'LIMIT',
        ticker: 'NVDA',
        side: 'SELL',
        quantity: 10,
        limitPrice: 108,
      };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]).toMatchObject({ filledQuantity: 10, priceCents: 108_00 });
    });

    it('does not fill a LIMIT SELL when the day high never reaches it', () => {
      let portfolio = createPortfolio(0);
      portfolio = applyFill(portfolio, 'NVDA', 'BUY', 10, 100_00, 0);
      const order: OrderRequest = {
        kind: 'LIMIT',
        ticker: 'NVDA',
        side: 'SELL',
        quantity: 10,
        limitPrice: 115,
      };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]?.filledQuantity).toBe(0);
    });
  });

  describe('cash-account caps (allowShortSelling: false)', () => {
    it('caps a BUY quantity to what cash affords', () => {
      const portfolio = createPortfolio(1000_00); // $1,000
      const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 100 };
      const { portfolio: next, fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar({ close: 105 })]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]?.filledQuantity).toBe(9); // floor(100000 / 10500) = 9
      expect(next.cashCents).toBeGreaterThanOrEqual(0);
    });

    it('caps a SELL quantity to shares currently held', () => {
      let portfolio = createPortfolio(0);
      portfolio = applyFill(portfolio, 'NVDA', 'BUY', 5, 100_00, 0);
      const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]?.filledQuantity).toBe(5);
    });

    it('never opens a short: a SELL with nothing held is fully unfilled', () => {
      const portfolio = createPortfolio(1_000_000_00);
      const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 };
      const { portfolio: next, fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        CASH_ONLY,
      );
      expect(fills[0]?.filledQuantity).toBe(0);
      expect(next.positions.size).toBe(0);
    });
  });

  describe('margin account (allowShortSelling: true)', () => {
    it('can buy beyond literal cash, financed by margin, up to buying power', () => {
      // $1,000 cash, initialMarginRatio 0.5 -> buying power = equity/0.5 = $2,000, i.e. up to 200
      // shares @ $10 — requesting 150 exceeds what $1,000 cash alone could ever afford (100
      // shares) but is still within buying power, so it fills in full, financed by margin.
      const portfolio = createPortfolio(1000_00);
      const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 150 };
      const { portfolio: next, fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar({ close: 10 })]]),
        0,
        MARGIN,
      );
      expect(fills[0]?.filledQuantity).toBe(150);
      expect(next.cashCents).toBeLessThan(0); // financed by margin, not covered by cash alone
    });

    it('opens a short when SELL exceeds shares held', () => {
      const portfolio = createPortfolio(1_000_000_00);
      const order: OrderRequest = { kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 };
      const { portfolio: next, fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        MARGIN,
      );
      expect(fills[0]?.filledQuantity).toBe(10);
      expect(next.positions.get('NVDA')?.shares).toBe(-10);
    });

    it('caps a short by borrowableShares even with ample buying power', () => {
      const portfolio = createPortfolio(1_000_000_000_00); // effectively unlimited cash
      const order: OrderRequest = {
        kind: 'MARKET',
        ticker: 'NVDA',
        side: 'SELL',
        quantity: 10_000,
      };
      const constrained: RiskConfig = { ...MARGIN, borrowableShares: 50 };
      const { fills } = resolveOrdersForPortfolio(
        portfolio,
        [order],
        new Map([['NVDA', bar()]]),
        0,
        constrained,
      );
      expect(fills[0]?.filledQuantity).toBe(50);
    });
  });

  it('processes multiple orders in submission order, each seeing the prior fill', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const orders: OrderRequest[] = [
      { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 },
      { kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 4 },
    ];
    const { portfolio: next, fills } = resolveOrdersForPortfolio(
      portfolio,
      orders,
      new Map([['NVDA', bar()]]),
      0,
      CASH_ONLY,
    );
    expect(fills.map((f) => f.filledQuantity)).toEqual([10, 4]);
    expect(next.positions.get('NVDA')?.shares).toBe(6);
  });

  it('handles orders across multiple tickers independently', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const orders: OrderRequest[] = [
      { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 },
      { kind: 'MARKET', ticker: 'AMD', side: 'BUY', quantity: 5 },
    ];
    const bars = new Map([
      ['NVDA', bar({ close: 105 })],
      ['AMD', bar({ close: 200 })],
    ]);
    const { portfolio: next, fills } = resolveOrdersForPortfolio(
      portfolio,
      orders,
      bars,
      0,
      CASH_ONLY,
    );
    expect(fills.map((f) => f.filledQuantity)).toEqual([10, 5]);
    expect(next.positions.get('NVDA')?.shares).toBe(10);
    expect(next.positions.get('AMD')?.shares).toBe(5);
  });
});
