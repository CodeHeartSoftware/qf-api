import { describe, expect, it } from 'vitest';
import { parseResearchAssumption } from '../../src/model/assumption.js';

function baseAssumption(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assumption-tritium-price',
    name: 'Tritium market price',
    description: 'Assumed constant tritium price for the base-case revenue model.',
    value: 30000,
    recordedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchAssumption', () => {
  it('accepts a minimal valid assumption', () => {
    expect(parseResearchAssumption(baseAssumption()).ok).toBe(true);
  });

  it('accepts a Quantity value', () => {
    const raw = baseAssumption({ value: { value: 30000, unit: 'USD/kg' } });
    expect(parseResearchAssumption(raw).ok).toBe(true);
  });

  it('requires a non-empty name and description', () => {
    expect(parseResearchAssumption(baseAssumption({ name: '' })).ok).toBe(false);
    expect(parseResearchAssumption(baseAssumption({ description: '' })).ok).toBe(false);
  });

  it('requires recordedAt', () => {
    expect(parseResearchAssumption(baseAssumption({ recordedAt: undefined })).ok).toBe(false);
  });

  it('rejects validFrom after validTo', () => {
    const raw = baseAssumption({
      validFrom: '2030-01-01T00:00:00Z',
      validTo: '2020-01-01T00:00:00Z',
    });
    expect(parseResearchAssumption(raw).ok).toBe(false);
  });

  it("rejects a top-level unit that conflicts with a Quantity value's unit", () => {
    const raw = baseAssumption({ value: { value: 30000, unit: 'USD/kg' }, unit: 'USD/tonne' });
    expect(parseResearchAssumption(raw).ok).toBe(false);
  });
});
