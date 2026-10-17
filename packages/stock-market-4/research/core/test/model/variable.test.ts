import { describe, expect, it } from 'vitest';
import { parseResearchVariable } from '../../src/model/variable.js';

function baseVariable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variable-tungsten-mass',
    name: 'ARC first-wall tungsten mass',
    value: { value: 24.7, unit: 'tonnes' },
    origin: 'derived',
    recordedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchVariable', () => {
  it('accepts a Quantity value', () => {
    expect(parseResearchVariable(baseVariable()).ok).toBe(true);
  });

  it('accepts a bare ResearchValue (a plain number, string, or object)', () => {
    expect(parseResearchVariable(baseVariable({ value: 42 })).ok).toBe(true);
    expect(parseResearchVariable(baseVariable({ value: 'qualitative-only' })).ok).toBe(true);
    expect(parseResearchVariable(baseVariable({ value: { some: 'json' } })).ok).toBe(true);
  });

  it('requires a valid origin', () => {
    expect(parseResearchVariable(baseVariable({ origin: 'guessed' })).ok).toBe(false);
  });

  it('accepts every documented origin value', () => {
    for (const origin of ['observed', 'derived', 'assumed', 'estimated', 'scenario']) {
      expect(parseResearchVariable(baseVariable({ origin })).ok).toBe(true);
    }
  });

  it('accepts every documented status value', () => {
    for (const status of ['provisional', 'current', 'superseded', 'rejected']) {
      expect(parseResearchVariable(baseVariable({ status })).ok).toBe(true);
    }
  });

  it('requires recordedAt', () => {
    expect(parseResearchVariable(baseVariable({ recordedAt: undefined })).ok).toBe(false);
  });

  it('rejects effectiveFrom after effectiveTo', () => {
    const raw = baseVariable({
      effectiveFrom: '2030-01-01T00:00:00Z',
      effectiveTo: '2020-01-01T00:00:00Z',
    });
    expect(parseResearchVariable(raw).ok).toBe(false);
  });

  it("accepts a top-level unit that agrees with a Quantity value's unit", () => {
    const raw = baseVariable({ value: { value: 24.7, unit: 'tonnes' }, unit: 'tonnes' });
    expect(parseResearchVariable(raw).ok).toBe(true);
  });

  it("rejects a top-level unit that conflicts with a Quantity value's unit", () => {
    const raw = baseVariable({ value: { value: 24.7, unit: 'tonnes' }, unit: 'kilograms' });
    expect(parseResearchVariable(raw).ok).toBe(false);
  });

  it('accepts a top-level unit alongside a bare (non-Quantity) value', () => {
    expect(parseResearchVariable(baseVariable({ value: 24.7, unit: 'tonnes' })).ok).toBe(true);
  });
});
