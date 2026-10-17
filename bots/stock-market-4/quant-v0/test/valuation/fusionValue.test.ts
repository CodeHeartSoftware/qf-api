import { describe, expect, it } from 'vitest';
import { computeFusionValue, type FusionValuationAssumptions } from '../../src/valuation/fusionValue.js';

function constant(value: number) {
  return { bear: value, base: value, bull: value };
}

describe('computeFusionValue', () => {
  it('computes Fusion Revenue = deployments * tonnes * price * capture * replacementDemand', () => {
    const assumptions: FusionValuationAssumptions = {
      reactorDeployments: constant(10),
      tungstenContentTonnes: constant(5),
      tungstenPriceUsdPerTonne: constant(1000),
      supplierCapture: constant(0.5),
      replacementDemand: constant(2),
      incrementalEbitMargin: constant(0.2),
      valuationMultiple: constant(3),
    };
    const result = computeFusionValue(assumptions);

    // revenue = 10 * 5 * 1000 * 0.5 * 2 = 50,000
    expect(result.fusionRevenue.base).toBeCloseTo(50_000);
    // ebit = 50,000 * 0.2 = 10,000
    expect(result.fusionEbit.base).toBeCloseTo(10_000);
    // value = 10,000 * 3 = 30,000
    expect(result.fusionValue.base).toBeCloseTo(30_000);
  });

  it('keeps bear/base/bull legs independent all the way through the chain', () => {
    const assumptions: FusionValuationAssumptions = {
      reactorDeployments: { bear: 1, base: 2, bull: 4 },
      tungstenContentTonnes: constant(10),
      tungstenPriceUsdPerTonne: constant(100),
      supplierCapture: constant(1),
      replacementDemand: constant(1),
      incrementalEbitMargin: constant(1),
      valuationMultiple: constant(1),
    };
    const result = computeFusionValue(assumptions);
    expect(result.fusionValue).toEqual({ bear: 1_000, base: 2_000, bull: 4_000 });
  });

  it('a zero supplierCapture (no evidenced supplier relationship) yields zero fusion value', () => {
    const assumptions: FusionValuationAssumptions = {
      reactorDeployments: constant(10),
      tungstenContentTonnes: constant(10),
      tungstenPriceUsdPerTonne: constant(1000),
      supplierCapture: constant(0),
      replacementDemand: constant(1),
      incrementalEbitMargin: constant(0.2),
      valuationMultiple: constant(5),
    };
    const result = computeFusionValue(assumptions);
    expect(result.fusionValue).toEqual({ bear: 0, base: 0, bull: 0 });
  });
});
