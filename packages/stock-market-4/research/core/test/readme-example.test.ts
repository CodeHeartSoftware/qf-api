import { describe, expect, it } from 'vitest';
import { createResearchSnapshot, validateResearchDataset } from '../src/index.js';
import type { ResearchDataset } from '../src/index.js';

/**
 * Mirrors the worked example in README.md exactly, so a change to the public API that would
 * silently break the README's own example fails here first.
 */
describe('README example', () => {
  const dataset: ResearchDataset = {
    id: 'dataset-fusion-v1',
    name: 'Fusion Research',
    version: '1.0.0',
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      {
        id: 'entity-walter-tosto',
        type: 'company',
        name: 'Walter Tosto',
        recordedAt: '2025-12-01T00:00:00Z',
      },
      { id: 'entity-sparc', type: 'reactor', name: 'SPARC', recordedAt: '2025-12-01T00:00:00Z' },
    ],
    relationships: [
      {
        id: 'rel-walter-tosto-sparc',
        type: 'supplies',
        fromEntityId: 'entity-walter-tosto',
        toEntityId: 'entity-sparc',
        states: [
          {
            status: 'qualified',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2025-06-01T00:00:00Z',
            evidenceIds: ['evidence-1'],
          },
        ],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        observedAt: '2025-12-01T00:00:00Z',
        source: { name: 'Walter Tosto press release' },
        description: 'Walter Tosto reported vacuum-vessel qualification work for SPARC.',
        entityIds: ['entity-walter-tosto', 'entity-sparc'],
      },
    ],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };

  it('validates cleanly', () => {
    expect(validateResearchDataset(dataset).ok).toBe(true);
  });

  it('shows zero relationships before the qualification was recorded', () => {
    const early = createResearchSnapshot(dataset, '2025-07-01T00:00:00Z');
    expect(early.state.relationships).toHaveLength(0);
  });

  it('shows the qualified relationship once it has been recorded', () => {
    const later = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
    expect(later.state.relationships[0]?.states[0]?.status).toBe('qualified');
  });
});
