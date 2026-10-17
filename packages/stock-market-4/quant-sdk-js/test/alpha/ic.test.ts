import { describe, expect, it } from 'vitest';
import {
  combineAlphaEnsemble,
  computeEnsembleWeights,
  measureAlphaIC,
  pearsonCorrelation,
  spearmanRankCorrelation,
  type RealizedAlphaSample,
} from '../../src/alpha/ic.js';
import type { AlphaSignal } from '../../src/alpha/types.js';

describe('pearsonCorrelation', () => {
  it('is undefined for fewer than 2 pairs', () => {
    expect(pearsonCorrelation([1], [1])).toBeUndefined();
  });

  it('is undefined for a zero-variance series', () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeUndefined();
  });

  it('is 1 for a perfectly linear positive relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });

  it('is -1 for a perfectly linear inverse relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
});

describe('spearmanRankCorrelation', () => {
  it('is 1 for a monotonic (but non-linear) positive relationship — a case plain Pearson would understate', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => x ** 3); // monotonic, strongly non-linear
    expect(spearmanRankCorrelation(xs, ys)).toBeCloseTo(1);
  });

  it('handles tied values without throwing', () => {
    expect(spearmanRankCorrelation([1, 1, 2, 2], [1, 2, 1, 2])).toBeDefined();
  });
});

describe('measureAlphaIC', () => {
  it('groups samples by factor and measures each independently', () => {
    const samples: RealizedAlphaSample[] = [
      { factor: 'a', predicted: 1, realizedForwardReturn: 1 },
      { factor: 'a', predicted: 2, realizedForwardReturn: 2 },
      { factor: 'a', predicted: 3, realizedForwardReturn: 3 },
      { factor: 'b', predicted: 1, realizedForwardReturn: -1 },
      { factor: 'b', predicted: 2, realizedForwardReturn: -2 },
    ];
    const stats = measureAlphaIC(samples);
    expect(stats.get('a')?.sampleSize).toBe(3);
    expect(stats.get('a')?.pearsonIC).toBeCloseTo(1);
    expect(stats.get('b')?.pearsonIC).toBeCloseTo(-1);
  });

  it('returns an empty map for no samples', () => {
    expect(measureAlphaIC([]).size).toBe(0);
  });
});

describe('computeEnsembleWeights', () => {
  it('falls back to equal weight across every present factor when NONE has enough history', () => {
    const weights = computeEnsembleWeights(new Map(), ['a', 'b', 'c'], 10);
    expect(weights.get('a')).toBeCloseTo(1 / 3);
    expect(weights.get('b')).toBeCloseTo(1 / 3);
    expect(weights.get('c')).toBeCloseTo(1 / 3);
  });

  it('weights a well-sampled factor close to its own |rank IC|, and shrinks an under-sampled factor heavily toward the prior', () => {
    const stats = new Map([
      ['a', { factor: 'a', sampleSize: 20, pearsonIC: 0.8, rankIC: 0.8 }],
      ['b', { factor: 'b', sampleSize: 3, pearsonIC: 0.99, rankIC: 0.99 }], // too few samples to fully trust
    ]);
    const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
    // Neither factor is dominated by b's unreliable, un-vetted 0.99 correlation — both land near
    // (not at) equal weight, since even the better-sampled factor (a, trust = 20/30 = 0.667) is
    // still meaningfully shrunk toward the shared prior, not taken at full, raw face value.
    expect(weights.get('a')).toBeCloseTo(0.4756, 3);
    expect(weights.get('b')).toBeCloseTo(0.5244, 3);
  });

  it('gives a reliably NEGATIVE predictor no weight of its own — clipped at zero, never |IC|', () => {
    const stats = new Map([
      ['a', { factor: 'a', sampleSize: 200, pearsonIC: -0.9, rankIC: -0.9 }],
      ['b', { factor: 'b', sampleSize: 200, pearsonIC: 0.3, rankIC: 0.3 }],
    ]);
    const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
    // a keeps only its small shrinkage share of the prior (10/210 of 0.15), never 0.9's magnitude.
    expect(weights.get('a')).toBeLessThan(0.03);
    expect(weights.get('b')).toBeGreaterThan(0.97);
  });

  it('gives every factor zero weight when none shows positive predictive power', () => {
    const stats = new Map([['a', { factor: 'a', sampleSize: 20, pearsonIC: -0.9, rankIC: -0.9 }]]);
    const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
    expect(weights.get('a')).toBe(0);
    expect(weights.get('b')).toBe(0);
  });

  it('returns an empty map when no factors are present', () => {
    expect(computeEnsembleWeights(new Map(), [], 10).size).toBe(0);
  });

  describe('continuous shrinkage (replaces the old sampleSize < minSamples hard cutoff)', () => {
    it('trusts a factor with EXACTLY minSamples observations at precisely 50% against the prior', () => {
      const stats = new Map([
        // Same magnitude on both so the prior equals the measured IC too — isolates the shrinkage
        // math itself from any cross-factor prior-averaging effect.
        ['a', { factor: 'a', sampleSize: 10, pearsonIC: 0.6, rankIC: 0.6 }],
        ['b', { factor: 'b', sampleSize: 10, pearsonIC: 0.6, rankIC: 0.6 }],
      ]);
      const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
      expect(weights.get('a')).toBeCloseTo(0.5, 6);
    });

    it('trust rises smoothly (no discontinuous jump) as sampleSize crosses the old hard-cutoff value', () => {
      const weightAt = (sampleSize: number) => {
        const stats = new Map([
          ['a', { factor: 'a', sampleSize, pearsonIC: 0.7, rankIC: 0.7 }],
          ['b', { factor: 'b', sampleSize: 200, pearsonIC: 0.1, rankIC: 0.1 }],
        ]);
        return computeEnsembleWeights(stats, ['a', 'b'], 10).get('a') ?? 0;
      };
      const justBelow = weightAt(9);
      const atThreshold = weightAt(10);
      const justAbove = weightAt(11);
      // Monotonic, and each step's SIZE is comparable to its neighbor — nothing resembling the
      // old all-or-nothing jump right at sampleSize === minSamples.
      expect(justBelow).toBeLessThan(atThreshold);
      expect(atThreshold).toBeLessThan(justAbove);
      expect(atThreshold - justBelow).toBeLessThan(0.05);
      expect(justAbove - atThreshold).toBeLessThan(0.05);
    });

    it('a factor with only ONE real sample still gets a nonzero share of its own measured IC, never exactly the flat prior', () => {
      const stats = new Map([
        ['a', { factor: 'a', sampleSize: 1, pearsonIC: 0.9, rankIC: 0.9 }],
        ['b', { factor: 'b', sampleSize: 200, pearsonIC: 0.1, rankIC: 0.1 }],
      ]);
      const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
      // trust(1, 10) = 1/11 ≈ 0.0909 — small, but NOT zero: a's raw IC (0.9) pulls its blended
      // weight measurably above the flat prior (0.5), unlike the old cutoff which ignored a's
      // one real sample entirely and gave it exactly the average-of-measured fallback.
      const prior = (0.9 + 0.1) / 2;
      const expectedA = (1 / 11) * 0.9 + (10 / 11) * prior;
      const expectedB = (200 / 210) * 0.1 + (10 / 210) * prior;
      const total = expectedA + expectedB;
      expect(weights.get('a')).toBeCloseTo(expectedA / total, 6);
    });

    it('a factor with ZERO real samples still gets exactly the cross-sectional prior, unchanged from before', () => {
      const stats = new Map([['a', { factor: 'a', sampleSize: 50, pearsonIC: 0.6, rankIC: 0.6 }]]);
      const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
      // b has no entry in `stats` at all — trust(0, 10) = 0, so b's raw weight is exactly the
      // prior (here, just a's own 0.6, the only measured factor) before normalization, same as
      // the fallback the old binary cutoff already gave an unmeasured factor.
      expect(weights.get('a')).toBeCloseTo(0.5, 6);
      expect(weights.get('b')).toBeCloseTo(0.5, 6);
    });
  });
});

describe('combineAlphaEnsemble', () => {
  function signal(factor: string, value: number, confidence: number): AlphaSignal {
    return { factor, ticker: 'X', date: null, value, confidence };
  }

  it('returns a zero-confidence zero when no signal carries any weight', () => {
    const result = combineAlphaEnsemble([signal('a', 1, 1)], new Map());
    expect(result).toEqual({ expectedReturn: 0, confidence: 0, contributionByFactor: {} });
  });

  it('is a weighted average of value*confidence, normalized by present weight', () => {
    const weights = new Map([
      ['a', 0.75],
      ['b', 0.25],
    ]);
    const result = combineAlphaEnsemble([signal('a', 0.1, 1), signal('b', -0.1, 1)], weights);
    // (0.75*0.1*1 + 0.25*-0.1*1) / (0.75+0.25) = (0.075 - 0.025) = 0.05
    expect(result.expectedReturn).toBeCloseTo(0.05);
    expect(result.confidence).toBeCloseTo(1);
  });

  it('excludes a factor absent from the signal list entirely, rather than treating it as a confident zero', () => {
    const weights = new Map([
      ['a', 0.5],
      ['b', 0.5],
    ]);
    // Only 'a' present this round (e.g. 'b' was ablated away) — the combined result should be
    // exactly 'a' alone, not diluted by 'b's absent weight.
    const result = combineAlphaEnsemble([signal('a', 0.2, 1)], weights);
    expect(result.expectedReturn).toBeCloseTo(0.2);
  });

  it('contributionByFactor is an exact per-factor decomposition of expectedReturn', () => {
    const weights = new Map([
      ['a', 0.75],
      ['b', 0.25],
    ]);
    const result = combineAlphaEnsemble([signal('a', 0.1, 1), signal('b', -0.1, 0.5)], weights);
    // a: 0.75*0.1*1 / (0.75+0.25) = 0.075; b: 0.25*-0.1*0.5 / 1 = -0.0125
    expect(result.contributionByFactor.a).toBeCloseTo(0.075);
    expect(result.contributionByFactor.b).toBeCloseTo(-0.0125);
    const sum = Object.values(result.contributionByFactor).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(result.expectedReturn);
  });

  it('omits a factor entirely from contributionByFactor when it carried zero weight', () => {
    const weights = new Map([
      ['a', 1],
      ['b', 0],
    ]);
    const result = combineAlphaEnsemble([signal('a', 0.2, 1), signal('b', 0.9, 1)], weights);
    expect(result.contributionByFactor).toEqual({ a: 0.2 });
  });
});
