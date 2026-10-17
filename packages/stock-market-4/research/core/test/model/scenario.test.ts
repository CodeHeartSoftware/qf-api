import { describe, expect, it } from 'vitest';
import { parseResearchScenario } from '../../src/model/scenario.js';

function baseScenario(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scenario-high-demand-constrained-tritium',
    name: 'High-demand / constrained tritium',
    assumptionIds: ['assumption-tritium-price'],
    variableOverrides: {},
    eventIds: [],
    recordedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchScenario', () => {
  it('accepts a minimal valid scenario with no probability', () => {
    expect(parseResearchScenario(baseScenario()).ok).toBe(true);
  });

  it('does not require a probability', () => {
    const result = parseResearchScenario(baseScenario());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.probability).toBeUndefined();
  });

  it('accepts a probability in [0, 1]', () => {
    expect(parseResearchScenario(baseScenario({ probability: 0.3 })).ok).toBe(true);
  });

  it('rejects a probability outside [0, 1]', () => {
    expect(parseResearchScenario(baseScenario({ probability: 1.5 })).ok).toBe(false);
    expect(parseResearchScenario(baseScenario({ probability: -0.1 })).ok).toBe(false);
  });

  describe('variableOverrides', () => {
    it('accepts a bare ResearchValue override', () => {
      const raw = baseScenario({ variableOverrides: { 'variable-tritium-price': 45000 } });
      expect(parseResearchScenario(raw).ok).toBe(true);
    });

    it('accepts a Quantity override', () => {
      const raw = baseScenario({
        variableOverrides: { 'variable-tritium-price': { value: 45000, unit: 'USD/kg' } },
      });
      expect(parseResearchScenario(raw).ok).toBe(true);
    });

    it('rejects an override keyed by an empty id', () => {
      const raw = baseScenario({ variableOverrides: { '': 45000 } });
      expect(parseResearchScenario(raw).ok).toBe(false);
    });
  });

  describe('parent scenarios', () => {
    it('accepts a parentScenarioId', () => {
      const raw = baseScenario({ parentScenarioId: 'scenario-base-case' });
      expect(parseResearchScenario(raw)).toEqual({ ok: true, value: raw });
    });

    it('rejects a scenario naming itself as its own parent', () => {
      const raw = baseScenario({ parentScenarioId: 'scenario-high-demand-constrained-tritium' });
      expect(parseResearchScenario(raw).ok).toBe(false);
    });
  });

  it('requires recordedAt', () => {
    expect(parseResearchScenario(baseScenario({ recordedAt: undefined })).ok).toBe(false);
  });
});
