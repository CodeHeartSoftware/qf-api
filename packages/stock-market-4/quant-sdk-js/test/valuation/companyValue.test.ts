import { describe, expect, it } from 'vitest';
import type { ModelEffect } from '../../src/research/interpretEvents.js';
import {
  computeCompanyValuation,
  type ValuationSensitivities,
} from '../../src/valuation/companyValue.js';

const sensitivities: ValuationSensitivities = {
  manufacturingCapabilityToBaseValuePerShare: 10,
  manufacturingCapabilityToDomainOptionPerShare: 2,
  hypothesisConfidenceToDomainOptionPerShare: 5,
  supplierCaptureToDomainOptionPerShare: 5,
};

describe('computeCompanyValuation', () => {
  it('with no effects, fair value is exactly base + domain + option baseline', () => {
    const valuation = computeCompanyValuation({
      ticker: 'ELMT',
      asOf: 't1',
      baseBusinessValue: { bear: 10, base: 20, bull: 30 },
      domainValue: { bear: 0, base: 4, bull: 0 },
      domainOptionValueBaseline: { bear: 1, base: 1, bull: 1 },
      effects: [],
      sensitivities,
      unknowns: ['x'],
    });
    // base leg: 20 + 4 + 1 = 25
    expect(valuation.fairValue.base).toBeCloseTo(25);
    expect(valuation.unknowns).toEqual(['x']);
  });

  it('a positive manufacturing_capability effect raises BOTH base value and domain option value, scaled by magnitude*confidence', () => {
    const effects: ModelEffect[] = [
      {
        factor: 'manufacturing_capability',
        direction: 'positive',
        magnitude: 0.8,
        confidence: 0.9,
        rationale: 'r',
      },
    ];
    const valuation = computeCompanyValuation({
      ticker: 'ELMT',
      asOf: 't1',
      baseBusinessValue: { bear: 10, base: 20, bull: 30 },
      domainValue: { bear: 0, base: 0, bull: 0 },
      domainOptionValueBaseline: { bear: 0, base: 0, bull: 0 },
      effects,
      sensitivities,
      unknowns: [],
    });
    const weight = 0.8 * 0.9;
    expect(valuation.baseBusinessValue.base).toBeCloseTo(20 + weight * 10);
    expect(valuation.domainOptionValue.base).toBeCloseTo(weight * 2);
  });

  it('a neutral effect (the anti-inference confirmation) changes nothing', () => {
    const effects: ModelEffect[] = [
      {
        factor: 'relationship:potential_fusion_customer:entity-arc',
        direction: 'neutral',
        magnitude: 0,
        confidence: 1,
        rationale: 'r',
      },
    ];
    const valuation = computeCompanyValuation({
      ticker: 'ELMT',
      asOf: 't1',
      baseBusinessValue: { bear: 10, base: 20, bull: 30 },
      domainValue: { bear: 0, base: 0, bull: 0 },
      domainOptionValueBaseline: { bear: 0, base: 0, bull: 0 },
      effects,
      sensitivities,
      unknowns: [],
    });
    expect(valuation.baseBusinessValue).toEqual({ bear: 10, base: 20, bull: 30 });
    expect(valuation.domainOptionValue).toEqual({ bear: 0, base: 0, bull: 0 });
  });

  it('a positive hypothesis effect raises domain option value only, never domain-derived value or base value', () => {
    const effects: ModelEffect[] = [
      {
        factor: 'hypothesis:Some belief',
        direction: 'positive',
        magnitude: 0.5,
        confidence: 1,
        rationale: 'r',
        sourceHypothesisId: 'h1',
      },
    ];
    const valuation = computeCompanyValuation({
      ticker: 'ELMT',
      asOf: 't1',
      baseBusinessValue: { bear: 10, base: 20, bull: 30 },
      domainValue: { bear: 0, base: 0, bull: 0 },
      domainOptionValueBaseline: { bear: 0, base: 0, bull: 0 },
      effects,
      sensitivities,
      unknowns: [],
    });
    expect(valuation.baseBusinessValue.base).toBe(20);
    expect(valuation.domainDerivedValue).toEqual({ bear: 0, base: 0, bull: 0 });
    expect(valuation.domainOptionValue.base).toBeCloseTo(0.5 * 5);
  });
});
