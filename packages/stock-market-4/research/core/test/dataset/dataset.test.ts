import { describe, expect, it } from 'vitest';
import { parseResearchDataset } from '../../src/dataset/dataset.js';

function emptyDataset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dataset-fusion-v1',
    name: 'Fusion Research (fixture)',
    version: '1.0.0',
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
    ...overrides,
  };
}

describe('ResearchDataset', () => {
  it('accepts a dataset with every collection empty', () => {
    expect(parseResearchDataset(emptyDataset()).ok).toBe(true);
  });

  it('requires a non-empty name, version, and domain', () => {
    expect(parseResearchDataset(emptyDataset({ name: '' })).ok).toBe(false);
    expect(parseResearchDataset(emptyDataset({ version: '' })).ok).toBe(false);
    expect(parseResearchDataset(emptyDataset({ domain: '' })).ok).toBe(false);
  });

  it('accepts a dataset containing valid nested objects', () => {
    const raw = emptyDataset({
      entities: [
        { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    expect(parseResearchDataset(raw)).toEqual({ ok: true, value: raw });
  });

  it('rejects a dataset containing a structurally invalid nested object', () => {
    const raw = emptyDataset({
      entities: [{ id: 'entity-arc', type: 'reactor', name: 'ARC' }], // missing recordedAt
    });
    expect(parseResearchDataset(raw).ok).toBe(false);
  });

  it('rejects unknown extra top-level fields', () => {
    expect(parseResearchDataset(emptyDataset({ unexpected: 'field' })).ok).toBe(false);
  });
});
