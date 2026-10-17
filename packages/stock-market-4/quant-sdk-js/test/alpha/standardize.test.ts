import { describe, expect, it } from 'vitest';
import { computeFactorScales, standardizeSignals } from '../../src/alpha/standardize.js';
import type { AlphaSignal } from '../../src/alpha/types.js';

const signal = (factor: string, value: number, confidence = 1): AlphaSignal => ({
  factor,
  ticker: 'X',
  date: null,
  value,
  confidence,
});

describe('computeFactorScales', () => {
  it('is the RMS of each factor’s non-zero history plus live, confident signals', () => {
    const scales = computeFactorScales(
      [
        { factor: 'a', predicted: 3, realizedForwardReturn: 0 },
        { factor: 'a', predicted: 0, realizedForwardReturn: 0 },
      ],
      [signal('a', -4), signal('b', 9, 0)],
    );
    expect(scales.get('a')).toBeCloseTo(Math.sqrt((9 + 16) / 2));
    expect(scales.has('b')).toBe(false); // zero-confidence live signal is silent, not a reading
  });
});

describe('standardizeSignals', () => {
  const policy = { expectedReturnPerUnit: 0.03, clip: 3 };

  it('puts factors with wildly different raw units on the same scale', () => {
    const scales = new Map([
      ['valuation_gap', 0.5],
      ['evidence_delta', 0.02],
    ]);
    const [gap, evidence] = standardizeSignals(
      [signal('valuation_gap', 0.5), signal('evidence_delta', 0.02)],
      scales,
      policy,
    );
    expect(gap?.value).toBeCloseTo(0.03);
    expect(evidence?.value).toBeCloseTo(0.03);
  });

  it('clips outliers and keeps sign', () => {
    const [v] = standardizeSignals([signal('a', -10)], new Map([['a', 1]]), policy);
    expect(v?.value).toBeCloseTo(-0.09);
  });

  it('zeroes a factor with no scale yet', () => {
    expect(standardizeSignals([signal('a', 5)], new Map(), policy)[0]?.value).toBe(0);
  });
});
