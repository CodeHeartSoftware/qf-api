import { describe, expect, it } from 'vitest';
import { dailyBorrowFeeCents } from '../../src/portfolio/borrow.js';

describe('dailyBorrowFeeCents', () => {
  it('charges the annualized rate pro-rated over 252 trading days', () => {
    // 100 shares @ $10.00 (1000 cents) notional, 3% annualized -> daily rate = 0.03/252.
    const feeCents = dailyBorrowFeeCents(100, 1000, 0.03);
    expect(feeCents).toBe(Math.round((100 * 1000 * 0.03) / 252));
  });

  it('is 0 for a zero annualized fee', () => {
    expect(dailyBorrowFeeCents(100, 1000, 0)).toBe(0);
  });

  it('is 0 for zero shares', () => {
    expect(dailyBorrowFeeCents(0, 1000, 0.03)).toBe(0);
  });

  it('scales linearly with share count and mark price', () => {
    const base = dailyBorrowFeeCents(100, 1000, 0.03);
    expect(dailyBorrowFeeCents(200, 1000, 0.03)).toBe(base * 2);
    expect(dailyBorrowFeeCents(100, 2000, 0.03)).toBe(base * 2);
  });
});
