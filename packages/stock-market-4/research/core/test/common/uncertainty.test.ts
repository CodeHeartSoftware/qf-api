import { describe, expect, it } from 'vitest';
import { parseUncertainty } from '../../src/common/uncertainty.js';

describe('Uncertainty', () => {
  it('accepts a valid range with lower <= upper', () => {
    expect(parseUncertainty({ type: 'range', lower: 1, upper: 5 }).ok).toBe(true);
  });

  it('accepts a valid interval with lower <= upper', () => {
    expect(parseUncertainty({ type: 'interval', lower: -2, upper: -2 }).ok).toBe(true);
  });

  it('rejects a range/interval missing lower or upper', () => {
    expect(parseUncertainty({ type: 'range', upper: 5 }).ok).toBe(false);
    expect(parseUncertainty({ type: 'range', lower: 1 }).ok).toBe(false);
    expect(parseUncertainty({ type: 'interval' }).ok).toBe(false);
  });

  it('rejects lower > upper regardless of type', () => {
    const result = parseUncertainty({ type: 'range', lower: 10, upper: 1 });
    expect(result.ok).toBe(false);
  });

  it('accepts a distribution with a distribution description', () => {
    expect(
      parseUncertainty({ type: 'distribution', distribution: 'lognormal(mu=1, sigma=0.3)' }).ok,
    ).toBe(true);
  });

  it('rejects a distribution with no distribution description', () => {
    expect(parseUncertainty({ type: 'distribution' }).ok).toBe(false);
    expect(parseUncertainty({ type: 'distribution', distribution: '   ' }).ok).toBe(false);
  });

  it('accepts a qualitative uncertainty with a description', () => {
    expect(
      parseUncertainty({
        type: 'qualitative',
        description: 'directionally uncertain, no bound estimate',
      }).ok,
    ).toBe(true);
  });

  it('rejects a qualitative uncertainty with no description', () => {
    expect(parseUncertainty({ type: 'qualitative' }).ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(parseUncertainty({ type: 'made-up' }).ok).toBe(false);
  });
});
