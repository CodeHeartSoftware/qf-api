import { describe, expect, it } from 'vitest';
import {
  createResearchSnapshot,
  parseResearchSnapshot,
  type ResearchSnapshot,
} from '../../src/snapshot/snapshot.js';
import type { ResearchDataset } from '../../src/dataset/dataset.js';

function fixtureDataset(): ResearchDataset {
  return {
    id: 'dataset-snapshot-fixture',
    name: 'Snapshot round-trip fixture',
    version: '1.0.0',
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
    ],
    relationships: [
      {
        id: 'rel-1',
        type: 'uses',
        fromEntityId: 'entity-arc',
        toEntityId: 'entity-arc',
        states: [
          {
            status: 'active',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'x' },
        description: 'some observation',
        entityIds: ['entity-arc'],
      },
    ],
    assertions: [],
    hypotheses: [
      {
        id: 'hypothesis-1',
        name: 'H1',
        statement: 'x',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2026-06-01T00:00:00Z',
            confidence: { value: 0.6 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
          },
        ],
      },
    ],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [
      {
        id: 'event-1',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'X',
        entityIds: [],
        payload: {},
        evidenceIds: [],
      },
    ],
    questions: [],
  };
}

describe('ResearchSnapshot JSON round-trip', () => {
  it('preserves semantic equality through JSON.stringify -> JSON.parse -> parseResearchSnapshot', () => {
    const dataset = fixtureDataset();
    const snapshot = createResearchSnapshot(dataset, '2026-12-31T00:00:00Z');
    const roundTripped: unknown = JSON.parse(JSON.stringify(snapshot));
    const result = parseResearchSnapshot(roundTripped);
    expect(result).toEqual({ ok: true, value: snapshot });
  });

  it('is deterministic: the same dataset and timestamp always produce identical serialized snapshots', () => {
    const dataset = fixtureDataset();
    const first = JSON.stringify(createResearchSnapshot(dataset, '2026-12-31T00:00:00Z'));
    const second = JSON.stringify(createResearchSnapshot(dataset, '2026-12-31T00:00:00Z'));
    expect(first).toBe(second);
  });

  it('is deterministic across two independently-built, semantically-equal datasets', () => {
    const first = JSON.stringify(createResearchSnapshot(fixtureDataset(), '2026-12-31T00:00:00Z'));
    const second = JSON.stringify(createResearchSnapshot(fixtureDataset(), '2026-12-31T00:00:00Z'));
    expect(first).toBe(second);
  });

  it('two different snapshot timestamps of the same dataset serialize to different strings when the state actually differs', () => {
    const dataset = fixtureDataset();
    const early = JSON.stringify(createResearchSnapshot(dataset, '2026-03-01T00:00:00Z'));
    const late = JSON.stringify(createResearchSnapshot(dataset, '2026-12-31T00:00:00Z'));
    expect(early).not.toBe(late);
  });

  it('is a self-contained object: JSON.stringify does not throw and produces a plain JSON value (no functions, no undefined leaking through)', () => {
    const snapshot: ResearchSnapshot = createResearchSnapshot(
      fixtureDataset(),
      '2026-12-31T00:00:00Z',
    );
    const json = JSON.stringify(snapshot);
    expect(() => {
      JSON.parse(json);
    }).not.toThrow();
    expect(json).not.toContain('undefined');
  });
});
