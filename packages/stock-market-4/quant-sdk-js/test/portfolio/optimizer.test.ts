import { describe, expect, it } from 'vitest';
import { applyThesisGroupCaps } from '../../src/portfolio/optimizer.js';

describe('applyThesisGroupCaps', () => {
  it('leaves weights untouched when no group exceeds the cap', () => {
    const result = applyThesisGroupCaps({
      targetWeightByTicker: new Map([
        ['A', 0.1],
        ['B', 0.1],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['x'])],
        ['B', new Set(['x'])],
      ]),
      policy: { minSharedExposureIds: 1, maxGroupWeight: 0.3 },
    });
    expect(result.adjustments).toHaveLength(0);
    expect(result.adjustedWeightByTicker.get('A')).toBe(0.1);
    expect(result.adjustedWeightByTicker.get('B')).toBe(0.1);
  });

  it('scales every member of an over-cap group down proportionally, preserving their relative sizes', () => {
    const result = applyThesisGroupCaps({
      targetWeightByTicker: new Map([
        ['A', 0.2],
        ['B', 0.2],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['reactor-x'])],
        ['B', new Set(['reactor-x'])],
      ]),
      policy: { minSharedExposureIds: 1, maxGroupWeight: 0.25 },
    });
    expect(result.adjustments).toHaveLength(1);
    // Combined 0.4 -> capped to 0.25 -> scale factor 0.625.
    expect(result.adjustedWeightByTicker.get('A')).toBeCloseTo(0.125);
    expect(result.adjustedWeightByTicker.get('B')).toBeCloseTo(0.125);
    const sumAfter =
      (result.adjustedWeightByTicker.get('A') ?? 0) + (result.adjustedWeightByTicker.get('B') ?? 0);
    expect(sumAfter).toBeCloseTo(0.25);
  });

  it('never scales a group that has no overlap at all, regardless of how large the combined weight is', () => {
    const result = applyThesisGroupCaps({
      targetWeightByTicker: new Map([
        ['A', 0.2],
        ['B', 0.2],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['reactor-x'])],
        ['B', new Set(['reactor-y'])], // no shared id
      ]),
      policy: { minSharedExposureIds: 1, maxGroupWeight: 0.25 },
    });
    expect(result.adjustments).toHaveLength(0);
    expect(result.adjustedWeightByTicker.get('A')).toBe(0.2);
    expect(result.adjustedWeightByTicker.get('B')).toBe(0.2);
  });

  it('treats an undefined (HOLD) target weight as zero, and never crashes on it', () => {
    const result = applyThesisGroupCaps({
      targetWeightByTicker: new Map([
        ['A', 0.3],
        ['B', undefined],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['x'])],
        ['B', new Set(['x'])],
      ]),
      policy: { minSharedExposureIds: 1, maxGroupWeight: 0.1 },
    });
    expect(result.adjustedWeightByTicker.get('B')).toBeUndefined();
    expect(result.adjustedWeightByTicker.get('A')).toBeCloseTo(0.1);
  });

  it('only ever scales DOWN — a negative (short) target weight shrinks toward zero, never flips sign', () => {
    const result = applyThesisGroupCaps({
      targetWeightByTicker: new Map([
        ['A', -0.2],
        ['B', -0.2],
      ]),
      exposureFootprintByTicker: new Map([
        ['A', new Set(['x'])],
        ['B', new Set(['x'])],
      ]),
      policy: { minSharedExposureIds: 1, maxGroupWeight: 0.25 },
    });
    expect(result.adjustedWeightByTicker.get('A')).toBeCloseTo(-0.125);
    expect(result.adjustedWeightByTicker.get('B')).toBeCloseTo(-0.125);
  });
});
