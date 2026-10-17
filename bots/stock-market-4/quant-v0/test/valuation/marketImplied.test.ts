import { describe, expect, it } from 'vitest';
import { constantScenario } from '@quant-fusion/quant-sdk-js';
import { computeMarketImpliedExpectations } from '../../src/valuation/marketImplied.js';
import type { FusionValuationAssumptions } from '../../src/valuation/fusionValue.js';

const NO_FUSION: FusionValuationAssumptions = {
  reactorDeployments: constantScenario(0),
  tungstenContentTonnes: constantScenario(0),
  tungstenPriceUsdPerTonne: constantScenario(0),
  supplierCapture: constantScenario(0),
  replacementDemand: constantScenario(0),
  incrementalEbitMargin: constantScenario(0),
  valuationMultiple: constantScenario(0),
};

const REAL_FUSION: FusionValuationAssumptions = {
  reactorDeployments: constantScenario(10),
  tungstenContentTonnes: constantScenario(10),
  tungstenPriceUsdPerTonne: constantScenario(10),
  supplierCapture: { bear: 0, base: 0.1, bull: 0.2 },
  replacementDemand: constantScenario(1),
  incrementalEbitMargin: constantScenario(1),
  valuationMultiple: constantScenario(1),
};
// Fusion value at 100% capture = 10*10*10*1*1*1 = 1000 (total, all-legs-1 baseline).

describe('computeMarketImpliedExpectations', () => {
  it('returns undefined when the fusion chain is a flat zero (NO_FUSION_ASSUMPTIONS) — nothing to invert', () => {
    const result = computeMarketImpliedExpectations({
      marketPricePerShare: 20,
      baseBusinessValuePerSharebase: 18,
      domainOptionValuePerShareBase: 0.5,
      fusion: NO_FUSION,
      sharesOutstanding: 1_000_000,
    });
    expect(result).toBeUndefined();
  });

  it('inverts the fusion-value formula for supplierCapture, holding every other leg at base', () => {
    // sharesOutstanding = 100 -> fusion value per unit capture per share = 1000/100 = 10.
    // price = base(18) + option(0.5) + impliedCapture * 10 = 21 -> impliedCapture = 0.25.
    const result = computeMarketImpliedExpectations({
      marketPricePerShare: 21,
      baseBusinessValuePerSharebase: 18,
      domainOptionValuePerShareBase: 0.5,
      fusion: REAL_FUSION,
      sharesOutstanding: 100,
    });
    expect(result).toBeDefined();
    expect(result!.impliedValue).toBeCloseTo(0.25);
    expect(result!.assumedValue).toBeCloseTo(0.1);
    // The strategy assumes LESS capture (0.1) than the market implies (0.25) -> negative gap
    // (market already prices in more fusion success than this strategy currently assumes).
    expect(result!.gap).toBeCloseTo(0.1 - 0.25);
    // 0.25 exceeds even this security's own bull-case capture (0.2) — a real "valuation
    // blindness" flag (spec §39), distinct from gap (which only compares against base).
    expect(result!.gapVsRange).toBe('above_bull_case');
  });

  it('classifies impliedValue BELOW the bear case as the asymmetric-upside flag (spec §14)', () => {
    // price = 18 + 0.5 + impliedCapture*10 = 18.4 -> impliedCapture = -0.01, below bear (0).
    const result = computeMarketImpliedExpectations({
      marketPricePerShare: 18.4,
      baseBusinessValuePerSharebase: 18,
      domainOptionValuePerShareBase: 0.5,
      fusion: REAL_FUSION,
      sharesOutstanding: 100,
    });
    expect(result!.impliedValue).toBeLessThan(0);
    expect(result!.gapVsRange).toBe('below_bear_case');
  });

  it('classifies an implied capture inside [bear, bull] as within_range', () => {
    const result = computeMarketImpliedExpectations({
      marketPricePerShare: 18.6, // implied capture 0.01, inside [0, 0.2]
      baseBusinessValuePerSharebase: 18,
      domainOptionValuePerShareBase: 0.5,
      fusion: REAL_FUSION,
      sharesOutstanding: 100,
    });
    expect(result!.gapVsRange).toBe('within_range');
  });

  it('reports a positive gap when the market implies LESS success than the strategy assumes (the asymmetric-upside case, spec §14)', () => {
    // price = 18 + 0.5 + impliedCapture*10 = 18.6 -> impliedCapture = 0.01, well below assumed 0.1.
    const result = computeMarketImpliedExpectations({
      marketPricePerShare: 18.6,
      baseBusinessValuePerSharebase: 18,
      domainOptionValuePerShareBase: 0.5,
      fusion: REAL_FUSION,
      sharesOutstanding: 100,
    });
    expect(result!.impliedValue).toBeCloseTo(0.01);
    expect(result!.gap).toBeGreaterThan(0);
  });
});
