import { describe, expect, it } from 'vitest';
import {
  applyFill,
  createPortfolio,
  equityCents,
  getPosition,
  grossPositionValueCents,
  isBelowMaintenance,
  longExposureCents,
  maintenanceRequirementCents,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
  remainingBuyingPowerCents,
  shortExposureCents,
} from '../../src/portfolio/accounting.js';
import type { RiskConfig } from '../../src/types.js';

const MARGIN: RiskConfig = {
  allowShortSelling: true,
  borrowableShares: 1000,
  borrowFeeAnnualized: 0.03,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

const CASH_ONLY: RiskConfig = { ...MARGIN, allowShortSelling: false };

describe('createPortfolio', () => {
  it('starts all-cash, no positions', () => {
    const portfolio = createPortfolio(1_000_000);
    expect(portfolio).toEqual({ cashCents: 1_000_000, positions: new Map() });
  });
});

describe('getPosition', () => {
  it('returns a flat position for a security never traded', () => {
    expect(getPosition(createPortfolio(1_000_000), 'security-nvda')).toEqual({
      shares: 0,
      averageEntryPriceCents: 0,
      realizedPnlCents: 0,
    });
  });
});

describe('applyFill — weighted-average cost basis across multiple securities', () => {
  it('opens a long in one security without disturbing another security already held', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-amd', 'BUY', 5, 2000, 0);
    expect(getPosition(portfolio, 'security-nvda')).toEqual({
      shares: 10,
      averageEntryPriceCents: 1000,
      realizedPnlCents: 0,
    });
    expect(getPosition(portfolio, 'security-amd')).toEqual({
      shares: 5,
      averageEntryPriceCents: 2000,
      realizedPnlCents: 0,
    });
    expect(portfolio.cashCents).toBe(1_000_000 - 10 * 1000 - 5 * 2000);
  });

  it('averages cost basis across two same-direction fills', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-nvda', 'BUY', 10, 1200, 0);
    const position = getPosition(portfolio, 'security-nvda');
    expect(position.shares).toBe(20);
    expect(position.averageEntryPriceCents).toBe(1100); // (10*1000 + 10*1200) / 20
    expect(position.realizedPnlCents).toBe(0);
  });

  it('realizes P&L on a partial close without disturbing the remaining cost basis', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-nvda', 'SELL', 4, 1500, 0);
    const position = getPosition(portfolio, 'security-nvda');
    expect(position.shares).toBe(6);
    expect(position.averageEntryPriceCents).toBe(1000);
    expect(position.realizedPnlCents).toBe((1500 - 1000) * 4);
  });

  it('closes a position flat and resets its cost basis to zero', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-nvda', 'SELL', 10, 1200, 0);
    expect(getPosition(portfolio, 'security-nvda')).toEqual({
      shares: 0,
      averageEntryPriceCents: 0,
      realizedPnlCents: (1200 - 1000) * 10,
    });
  });

  it('realizes P&L when a fill flips a position straight through flat', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-nvda', 'SELL', 15, 1200, 0);
    const position = getPosition(portfolio, 'security-nvda');
    expect(position.shares).toBe(-5);
    expect(position.averageEntryPriceCents).toBe(1200); // the new short leg opened at the fill price
    expect(position.realizedPnlCents).toBe((1200 - 1000) * 10); // only the closing 10 shares realize P&L
  });

  it('deducts a fee from cash on top of the trade notional', () => {
    const portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 50);
    expect(portfolio.cashCents).toBe(1_000_000 - 10 * 1000 - 50);
  });

  it('credits cash (minus fee) on a SELL', () => {
    const portfolio = applyFill(createPortfolio(0), 'security-nvda', 'SELL', 10, 1000, 25);
    expect(portfolio.cashCents).toBe(10 * 1000 - 25);
  });

  it('never mutates the portfolio passed in', () => {
    const before = createPortfolio(1_000_000);
    const beforeSnapshot = { cashCents: before.cashCents, positions: new Map(before.positions) };
    applyFill(before, 'security-nvda', 'BUY', 10, 1000, 0);
    expect(before).toEqual(beforeSnapshot);
  });
});

describe('equityCents', () => {
  it('sums cash plus every position marked at its own price', () => {
    let portfolio = applyFill(createPortfolio(500_00), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-amd', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['security-nvda', 1100],
      ['security-amd', 1800],
    ]);
    expect(equityCents(portfolio, marks)).toBe(portfolio.cashCents + 10 * 1100 + -5 * 1800);
  });

  it('treats an unmarked security (no price supplied) as worth zero', () => {
    const portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    expect(equityCents(portfolio, new Map())).toBe(portfolio.cashCents);
  });

  it('is just cash for an all-cash portfolio', () => {
    expect(equityCents(createPortfolio(1_000_000), new Map())).toBe(1_000_000);
  });
});

describe('exposure across every security combined', () => {
  it('grossPositionValueCents sums absolute exposure across every security', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-amd', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['security-nvda', 1000],
      ['security-amd', 2000],
    ]);
    expect(grossPositionValueCents(portfolio, marks)).toBe(10 * 1000 + 5 * 2000);
  });

  it('longExposureCents counts only long positions', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-amd', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['security-nvda', 1000],
      ['security-amd', 2000],
    ]);
    expect(longExposureCents(portfolio, marks)).toBe(10 * 1000);
  });

  it('shortExposureCents counts only short positions', () => {
    let portfolio = applyFill(createPortfolio(1_000_000), 'security-nvda', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'security-amd', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['security-nvda', 1000],
      ['security-amd', 2000],
    ]);
    expect(shortExposureCents(portfolio, marks)).toBe(5 * 2000);
  });

  it('are all zero for an all-cash portfolio', () => {
    const portfolio = createPortfolio(1_000_000);
    expect(grossPositionValueCents(portfolio, new Map())).toBe(0);
    expect(longExposureCents(portfolio, new Map())).toBe(0);
    expect(shortExposureCents(portfolio, new Map())).toBe(0);
  });
});

describe('margin (spec §38 — portfolio-level, sized against gross exposure across ALL tickers)', () => {
  describe('remainingBuyingPowerCents', () => {
    it('is 0 whenever short selling/margin is disabled', () => {
      expect(remainingBuyingPowerCents(createPortfolio(1_000_000), new Map(), CASH_ONLY)).toBe(0);
    });

    it('accounts for exposure already used in a different ticker', () => {
      // $2,000 cash; spends $1,000 buying 100 shares @ $10 -> $1,000 cash + $1,000 position =
      // $2,000 equity. Capacity = equity / 0.5 = $4,000; $1,000 of it is already used.
      const portfolio = applyFill(createPortfolio(2_000_00), 'NVDA', 'BUY', 100, 1000, 0);
      const marks = new Map([['NVDA', 1000]]);
      expect(remainingBuyingPowerCents(portfolio, marks, MARGIN)).toBe(300_000);
    });
  });

  describe('maintenanceRequirementCents / isBelowMaintenance', () => {
    it('are both 0 whenever short selling/margin is disabled, even with an (impossible) position', () => {
      const portfolio = createPortfolio(1_000_000);
      expect(maintenanceRequirementCents(portfolio, new Map(), CASH_ONLY)).toBe(0);
      expect(isBelowMaintenance(portfolio, new Map(), CASH_ONLY)).toBe(false);
    });

    it('flags below-maintenance once equity falls under maintenanceMarginRatio * gross exposure', () => {
      let portfolio = applyFill(createPortfolio(10_000), 'NVDA', 'SELL', 100, 1000, 0); // short 100 @ $10
      portfolio = { ...portfolio, cashCents: -80_000 }; // deliberately unhealthy, to prove the check fires
      const marks = new Map([['NVDA', 1000]]); // gross exposure = $1,000 -> requirement = $300
      expect(isBelowMaintenance(portfolio, marks, MARGIN)).toBe(true);
    });

    it('is false for a flat (all-cash) portfolio even with margin enabled', () => {
      expect(isBelowMaintenance(createPortfolio(1_000_000), new Map(), MARGIN)).toBe(false);
    });
  });

  describe('maxBuyQuantityByMargin', () => {
    it('always allows covering an existing short back toward flat regardless of margin', () => {
      expect(maxBuyQuantityByMargin(-50, 0, 1000)).toBe(50);
    });

    it('adds long room on top of covering room, bounded by buying power', () => {
      expect(maxBuyQuantityByMargin(-50, 10_000, 1000)).toBe(50 + 10); // covers 50, then 10 more
    });

    it('is capped by buying power alone when already long', () => {
      // Buying power covers 25 shares total @ $10; 20 already held -> 5 more room.
      expect(maxBuyQuantityByMargin(20, 25_000, 1000)).toBe(5);
    });

    it('is 0 once an existing long already exceeds what buying power alone would allow', () => {
      expect(maxBuyQuantityByMargin(20, 5_000, 1000)).toBe(0);
    });
  });

  describe('maxSellQuantityByMargin', () => {
    it('always allows reducing an existing long back toward flat regardless of margin/borrow', () => {
      expect(maxSellQuantityByMargin(50, 0, 1000, 0)).toBe(50);
    });

    it('caps new short room by the lesser of margin capacity and borrowable shares', () => {
      expect(maxSellQuantityByMargin(0, 1_000_000, 1000, 5)).toBe(5);
      expect(maxSellQuantityByMargin(0, 3_000, 1000, 500)).toBe(3);
    });

    it('reduces an existing short position toward its own borrow/margin room', () => {
      expect(maxSellQuantityByMargin(-10, 1_000_000, 1000, 20)).toBe(10); // 20 - 10 already short
    });
  });
});
