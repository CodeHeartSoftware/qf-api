import { describe, expect, it } from 'vitest';
import { isQuantity, parseQuantity } from '../../src/common/quantity.js';

describe('Quantity', () => {
  it('accepts a bare value/unit pair', () => {
    expect(parseQuantity({ value: 24.7, unit: 'tonnes' })).toEqual({
      ok: true,
      value: { value: 24.7, unit: 'tonnes' },
    });
  });

  it('accepts an attached uncertainty', () => {
    const raw = {
      value: 24.7,
      unit: 'tonnes',
      uncertainty: { type: 'range', lower: 20, upper: 30 },
    };
    expect(parseQuantity(raw).ok).toBe(true);
  });

  it('rejects a non-finite value', () => {
    expect(parseQuantity({ value: Number.POSITIVE_INFINITY, unit: 'tonnes' }).ok).toBe(false);
    expect(parseQuantity({ value: Number.NaN, unit: 'tonnes' }).ok).toBe(false);
  });

  it('rejects a missing or empty unit', () => {
    expect(parseQuantity({ value: 1 }).ok).toBe(false);
    expect(parseQuantity({ value: 1, unit: '' }).ok).toBe(false);
  });

  it('rejects an invalid nested uncertainty', () => {
    const raw = {
      value: 24.7,
      unit: 'tonnes',
      uncertainty: { type: 'range', lower: 30, upper: 20 },
    };
    expect(parseQuantity(raw).ok).toBe(false);
  });

  it('round-trips through JSON with semantic equality', () => {
    const original = {
      value: 11.4,
      unit: 'T',
      uncertainty: { type: 'qualitative' as const, description: 'proxy estimate' },
    };
    const roundTripped: unknown = JSON.parse(JSON.stringify(original));
    expect(roundTripped).toEqual(original);
    expect(parseQuantity(roundTripped).ok).toBe(true);
  });

  it('isQuantity distinguishes a Quantity from a plain ResearchValue object', () => {
    expect(isQuantity({ value: 1, unit: 'tonnes' })).toBe(true);
    expect(isQuantity({ foo: 'bar' })).toBe(false);
    expect(isQuantity(42)).toBe(false);
  });
});
