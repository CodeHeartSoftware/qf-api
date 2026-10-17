import { describe, expect, it } from 'vitest';
import { computeEffectiveCorrelation } from '../../src/correlation/blended.js';

describe('computeEffectiveCorrelation', () => {
  it('is a weighted blend of statistical and causal correlation', () => {
    const result = computeEffectiveCorrelation(0.4, 0.8, { causalWeight: 0.5 });
    expect(result).toBeCloseTo(0.6);
  });

  it('treats an undefined statistical correlation (insufficient price history) as neutral 0, not as skipping the blend', () => {
    const result = computeEffectiveCorrelation(undefined, 0.8, { causalWeight: 0.5 });
    expect(result).toBeCloseTo(0.4); // (1-0.5)*0 + 0.5*0.8
  });

  it('causalWeight 0 reproduces pure statistical correlation', () => {
    expect(computeEffectiveCorrelation(0.7, 0.9, { causalWeight: 0 })).toBeCloseTo(0.7);
  });

  it('causalWeight 1 reproduces pure causal overlap', () => {
    expect(computeEffectiveCorrelation(0.7, 0.9, { causalWeight: 1 })).toBeCloseTo(0.9);
  });
});
