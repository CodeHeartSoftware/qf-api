import { describe, expect, it } from 'vitest';
import { computeTradingDecisions, type DailyBar, type PortfolioObservation } from '@quant-fusion/quant-sdk-js';
import { DEFAULT_FUSION_QUANT_CONFIG } from '../src/config.js';
import { FUSION_DOMAIN_ADAPTER } from '../src/index.js';
import { emptyPortfolio, fusionStateAt } from './support/fixtures.js';

const DATE = '2026-09-11';
const RESEARCH_STATE = fusionStateAt(`${DATE}T00:00:00Z`);

function bars(count: number, start: number): DailyBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-08-${String(10 + i).padStart(2, '0')}`,
    open: start,
    high: start,
    low: start,
    close: start + i * 0.1,
    volume: 100_000,
  }));
}

function baseParams(portfolio: PortfolioObservation) {
  const currentPricesByTicker = new Map<string, number>();
  const historyByTicker = new Map<string, DailyBar[]>();
  for (const security of DEFAULT_FUSION_QUANT_CONFIG.securities) {
    currentPricesByTicker.set(security.ticker, security.valuation.baseBusinessValuePerShare.base);
    historyByTicker.set(security.ticker, bars(15, security.valuation.baseBusinessValuePerShare.base));
  }
  return {
    date: DATE,
    config: DEFAULT_FUSION_QUANT_CONFIG,
    domain: FUSION_DOMAIN_ADAPTER,
    previousResearchState: undefined,
    currentResearchState: RESEARCH_STATE,
    currentPricesByTicker,
    historyByTicker,
    previousByTicker: new Map(),
    realizedAlphaSamples: [],
    portfolio,
  };
}

describe('computeTradingDecisions', () => {
  it('is deterministic: identical inputs produce identical decisions', () => {
    const params = baseParams(emptyPortfolio());
    const first = computeTradingDecisions(params);
    const second = computeTradingDecisions(params);
    expect(JSON.stringify(first.decisions)).toBe(JSON.stringify(second.decisions));
  });

  it('skips a security with no price this round entirely (no decision recorded for it)', () => {
    const params = baseParams(emptyPortfolio());
    params.currentPricesByTicker.delete('ELMT');
    const { decisions } = computeTradingDecisions(params);
    expect(decisions.some((d) => d.security === 'ELMT')).toBe(false);
  });

  it('produces one decision per priced security, each with a full explainability record', () => {
    const { decisions } = computeTradingDecisions(baseParams(emptyPortfolio()));
    expect(decisions).toHaveLength(DEFAULT_FUSION_QUANT_CONFIG.securities.length);
    for (const decision of decisions) {
      expect(decision.valuationBreakdown).toBeDefined();
      expect(decision.exposure).toBeDefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(decision.action);
      expect(decision.ensembleWeights).toBeDefined();
    }
  });

  it('alphaContribution is an exact per-factor decomposition of expectedReturn on real decisions', () => {
    const { decisions } = computeTradingDecisions(baseParams(emptyPortfolio()));
    for (const decision of decisions) {
      const sum = Object.values(decision.alphaContribution).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(decision.expectedReturn);
    }
  });

  it('threads realized-alpha-sample bookkeeping across rounds without throwing, and samples accumulate', () => {
    const params = baseParams(emptyPortfolio());
    const roundOne = computeTradingDecisions(params);

    const roundTwoPrices = new Map(params.currentPricesByTicker);
    for (const [ticker, price] of roundTwoPrices) roundTwoPrices.set(ticker, price * 1.01);

    const roundTwo = computeTradingDecisions({
      ...params,
      previousResearchState: RESEARCH_STATE,
      currentPricesByTicker: roundTwoPrices,
      previousByTicker: roundOne.updatedPreviousByTicker,
      realizedAlphaSamples: roundOne.updatedRealizedAlphaSamples,
    });

    expect(roundTwo.updatedRealizedAlphaSamples.length).toBeGreaterThan(roundOne.updatedRealizedAlphaSamples.length);
  });

  it('never lets the whole round of BUY orders jointly spend more than the account actually had available', () => {
    const smallPortfolio = emptyPortfolio(1_000_00); // $1,000
    const params = baseParams(smallPortfolio);
    const { decisions } = computeTradingDecisions(params);
    const totalBuyCents = decisions
      .flatMap((d) => d.orders)
      .filter((o) => o.side === 'BUY')
      .reduce((sum, o) => sum + o.quantity * Math.round(params.currentPricesByTicker.get(o.ticker)! * 100), 0);
    expect(totalBuyCents).toBeLessThanOrEqual(smallPortfolio.cashCents);
  });
});
