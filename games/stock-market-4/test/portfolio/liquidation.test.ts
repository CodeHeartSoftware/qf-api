import { describe, expect, it } from 'vitest';
import { applyFill, createPortfolio } from '../../src/portfolio/accounting.js';
import { forceLiquidatePortfolio } from '../../src/portfolio/liquidation.js';
import type { RiskConfig } from '../../src/types.js';

const MARGIN: RiskConfig = {
  allowShortSelling: true,
  borrowableShares: 1000,
  borrowFeeAnnualized: 0.03,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

describe('forceLiquidatePortfolio', () => {
  it('does nothing when the portfolio is not below maintenance', () => {
    const portfolio = createPortfolio(1_000_000_00);
    const { portfolio: next, fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: new Map(),
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills).toEqual([]);
    expect(next).toEqual(portfolio);
  });

  it('liquidates the larger position first (deterministic, largest exposure first)', () => {
    let portfolio = applyFill(createPortfolio(0), 'NVDA', 'BUY', 100, 1000_00, 0); // $100,000 exposure
    portfolio = applyFill(portfolio, 'AMD', 'BUY', 10, 10_00, 0); // $100 exposure — much smaller
    portfolio = { ...portfolio, cashCents: -1_000_000_00 }; // force well below maintenance

    const marks = new Map([
      ['NVDA', 1000_00],
      ['AMD', 10_00],
    ]);
    const { fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: marks,
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills[0]?.ticker).toBe('NVDA');
  });

  it('fully closes each liquidated position in one step (no order book to partial-fill against)', () => {
    let portfolio = applyFill(createPortfolio(0), 'NVDA', 'BUY', 100, 1000_00, 0);
    portfolio = { ...portfolio, cashCents: -1_000_000_00 };
    const marks = new Map([['NVDA', 1000_00]]);
    const { portfolio: next, fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: marks,
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'SELL',
        kind: 'MARKET',
        requestedQuantity: 100,
        filledQuantity: 100,
        priceCents: 1000_00,
        feeCents: 0,
      },
    ]);
    expect(next.positions.get('NVDA')?.shares).toBe(0);
  });

  it('covers a short (BUY) rather than selling it further', () => {
    let portfolio = applyFill(createPortfolio(10_000_00), 'NVDA', 'SELL', 100, 1000_00, 0);
    portfolio = { ...portfolio, cashCents: -1_000_000_00 };
    const marks = new Map([['NVDA', 1000_00]]);
    const { fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: marks,
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills[0]?.side).toBe('BUY');
  });

  it('stops once equity is back at or above the maintenance requirement', () => {
    let portfolio = applyFill(createPortfolio(0), 'NVDA', 'BUY', 100, 1000_00, 0);
    portfolio = applyFill(portfolio, 'AMD', 'BUY', 100, 1000_00, 0);
    // Mild shortfall — liquidating just the first ticker should already cure it.
    portfolio = { ...portfolio, cashCents: -150_000_00 };
    const marks = new Map([
      ['NVDA', 1000_00],
      ['AMD', 1000_00],
    ]);
    const { fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: marks,
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills).toHaveLength(1);
  });

  it('skips a ticker with no mark price that day rather than crashing', () => {
    let portfolio = applyFill(createPortfolio(0), 'NVDA', 'BUY', 100, 1000_00, 0);
    portfolio = { ...portfolio, cashCents: -1_000_000_00 };
    const { fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: new Map(), // no mark for NVDA at all
      risk: MARGIN,
      feeRate: 0,
    });
    expect(fills).toEqual([]);
  });

  it('deducts a fee on each forced trade', () => {
    let portfolio = applyFill(createPortfolio(0), 'NVDA', 'BUY', 100, 1000_00, 0);
    portfolio = { ...portfolio, cashCents: -1_000_000_00 };
    const marks = new Map([['NVDA', 1000_00]]);
    const { fills } = forceLiquidatePortfolio({
      portfolio,
      marksCents: marks,
      risk: MARGIN,
      feeRate: 0.001,
    });
    expect(fills[0]?.feeCents).toBe(Math.round(100 * 1000_00 * 0.001));
  });
});
