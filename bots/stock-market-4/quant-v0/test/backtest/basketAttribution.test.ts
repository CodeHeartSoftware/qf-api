import { describe, expect, it } from 'vitest';
import { attributeToBasket, basketDailyReturns } from '../../backtest/basketAttribution.js';

const bar = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07'];

describe('basketDailyReturns', () => {
  it('averages each ticker’s close-to-close return per date', () => {
    const basket = basketDailyReturns({
      A: [bar(dates[0]!, 100), bar(dates[1]!, 110)],
      B: [bar(dates[0]!, 50), bar(dates[1]!, 45)],
    });
    expect(basket.get(dates[1]!)).toBeCloseTo((0.1 - 0.1) / 2);
    expect(basket.has(dates[0]!)).toBe(false);
  });
});

describe('attributeToBasket', () => {
  const basketReturns = [0.02, -0.01, 0.03, -0.02];
  const basket = new Map(dates.slice(1).map((d, i) => [d, basketReturns[i]!]));

  function equityFrom(returns: number[]) {
    let equity = 1_000_000;
    return [{ date: dates[0]!, equityCents: equity }, ...returns.map((r, i) => ({ date: dates[i + 1]!, equityCents: (equity *= 1 + r) }))];
  }

  it('a pure 2x-levered basket book is all beta, no alpha', () => {
    const result = attributeToBasket(equityFrom(basketReturns.map((r) => 2 * r)), basket)!;
    expect(result.beta).toBeCloseTo(2);
    expect(result.annualizedAlpha).toBeCloseTo(0);
    expect(result.residualSharpe).toBeNull();
  });

  it('a constant daily edge on top of the basket shows up as alpha', () => {
    const result = attributeToBasket(equityFrom(basketReturns.map((r) => r + 0.001)), basket)!;
    expect(result.beta).toBeCloseTo(1);
    expect(result.annualizedAlpha).toBeCloseTo(0.252);
  });

  it('returns null with too few paired days', () => {
    expect(attributeToBasket(equityFrom([0.01]), basket)).toBeNull();
  });
});
