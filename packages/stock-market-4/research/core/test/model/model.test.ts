import { describe, expect, it } from 'vitest';
import { parseResearchModel } from '../../src/model/model.js';

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-fusion-revenue',
    name: 'Fusion Revenue Model',
    variableIds: [
      'variable-reactors',
      'variable-content',
      'variable-share',
      'variable-replacements',
      'variable-revenue',
    ],
    assumptionIds: ['assumption-tritium-price'],
    calculations: [
      {
        id: 'calc-fusion-revenue',
        name: 'Fusion Revenue',
        formula: 'Revenue = Reactors × Content × Share × Replacements',
        inputVariableIds: [
          'variable-reactors',
          'variable-content',
          'variable-share',
          'variable-replacements',
        ],
        outputVariableId: 'variable-revenue',
      },
    ],
    outputVariableIds: ['variable-revenue'],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchModel', () => {
  it('accepts a minimal valid model', () => {
    expect(parseResearchModel(baseModel()).ok).toBe(true);
  });

  it('accepts a model with no calculations yet', () => {
    expect(
      parseResearchModel(
        baseModel({ calculations: [], variableIds: [], assumptionIds: [], outputVariableIds: [] }),
      ).ok,
    ).toBe(true);
  });

  it('requires a non-empty name and createdAt', () => {
    expect(parseResearchModel(baseModel({ name: '' })).ok).toBe(false);
    expect(parseResearchModel(baseModel({ createdAt: undefined })).ok).toBe(false);
  });

  it('rejects an invalid nested calculation', () => {
    const raw = baseModel({
      calculations: [
        {
          id: 'calc-bad',
          name: 'Bad',
          formula: 'x',
          inputVariableIds: ['variable-a'],
          outputVariableId: 'variable-a',
        },
      ],
    });
    expect(parseResearchModel(raw).ok).toBe(false);
  });

  it('rejects validFrom after validTo', () => {
    const raw = baseModel({ validFrom: '2030-01-01T00:00:00Z', validTo: '2020-01-01T00:00:00Z' });
    expect(parseResearchModel(raw).ok).toBe(false);
  });
});
