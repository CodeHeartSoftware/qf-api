import { describe, expect, it } from 'vitest';
import { parseResearchCalculation } from '../../src/model/calculation.js';

function baseCalculation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'calc-fusion-revenue',
    name: 'Fusion Revenue',
    formula:
      'Fusion Revenue = Reactors Deployed × Component Content/Reactor × Supplier Market Share × Replacement Count',
    inputVariableIds: [
      'variable-reactors',
      'variable-content',
      'variable-share',
      'variable-replacements',
    ],
    outputVariableId: 'variable-revenue',
    ...overrides,
  };
}

describe('ResearchCalculation', () => {
  it('accepts a minimal valid calculation', () => {
    expect(parseResearchCalculation(baseCalculation()).ok).toBe(true);
  });

  it('accepts assumptionIds', () => {
    const raw = baseCalculation({ assumptionIds: ['assumption-tritium-price'] });
    expect(parseResearchCalculation(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty name and formula', () => {
    expect(parseResearchCalculation(baseCalculation({ name: '' })).ok).toBe(false);
    expect(parseResearchCalculation(baseCalculation({ formula: '' })).ok).toBe(false);
  });

  it('accepts an empty inputVariableIds array', () => {
    expect(parseResearchCalculation(baseCalculation({ inputVariableIds: [] })).ok).toBe(true);
  });

  it('rejects outputVariableId also appearing in inputVariableIds', () => {
    const raw = baseCalculation({
      inputVariableIds: ['variable-reactors', 'variable-revenue'],
      outputVariableId: 'variable-revenue',
    });
    expect(parseResearchCalculation(raw).ok).toBe(false);
  });
});
