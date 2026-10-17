import { describe, expect, it } from 'vitest';
import { computeCausalOverlap } from '../../src/correlation/causal.js';
import type { ExposureMap } from '../../src/research/exposure.js';

function emptyExposure(targetEntityId: string): ExposureMap {
  return {
    targetEntityId,
    architecture: [],
    material: [],
    component: [],
    manufacturing: [],
    bottleneck: [],
    qualification: [],
    contract: [],
    program: [],
  };
}

describe('computeCausalOverlap', () => {
  it('is 0 when either footprint is empty', () => {
    expect(computeCausalOverlap(emptyExposure('a'), emptyExposure('b'))).toBe(0);
  });

  it('is 1 for identical footprints', () => {
    const a = {
      ...emptyExposure('a'),
      material: [{ id: 'tungsten', name: 'Tungsten', weight: 1 }],
    };
    const b = {
      ...emptyExposure('b'),
      material: [{ id: 'tungsten', name: 'Tungsten', weight: 1 }],
    };
    expect(computeCausalOverlap(a, b)).toBe(1);
  });

  it('is a Jaccard fraction for partial overlap', () => {
    const a = {
      ...emptyExposure('a'),
      material: [
        { id: 'tungsten', name: 'Tungsten', weight: 1 },
        { id: 'vanadium', name: 'Vanadium', weight: 1 },
      ],
    };
    const b = {
      ...emptyExposure('b'),
      material: [{ id: 'tungsten', name: 'Tungsten', weight: 1 }],
    };
    expect(computeCausalOverlap(a, b)).toBeCloseTo(1 / 2);
  });
});
