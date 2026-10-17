import { describe, expect, it } from 'vitest';
import { parseConfidence } from '../../src/common/confidence.js';

describe('Confidence', () => {
  it('accepts values within [0, 1], with or without a basis', () => {
    expect(parseConfidence({ value: 0 }).ok).toBe(true);
    expect(parseConfidence({ value: 1 }).ok).toBe(true);
    expect(parseConfidence({ value: 0.62, basis: 'analyst estimate' }).ok).toBe(true);
  });

  it('rejects values outside [0, 1]', () => {
    expect(parseConfidence({ value: -0.01 }).ok).toBe(false);
    expect(parseConfidence({ value: 1.01 }).ok).toBe(false);
  });

  it('rejects a missing value field', () => {
    expect(parseConfidence({ basis: 'no value here' }).ok).toBe(false);
  });

  it('rejects unknown extra fields (strict object)', () => {
    expect(parseConfidence({ value: 0.5, uncertainty: 'not allowed here' }).ok).toBe(false);
  });
});
