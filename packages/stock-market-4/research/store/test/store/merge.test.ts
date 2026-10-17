import type { ResearchDataset } from '@quant-fusion/research-core';
import { describe, expect, it } from 'vitest';
import {
  bumpDatasetVersion,
  mergeResearchUpdate,
  type ResearchUpdate,
} from '../../src/store/merge.js';

/** A minimal, hand-built valid `ResearchDataset` — deliberately NOT a real fixture, so these unit
 * tests stay fast and their expectations are easy to read against a small, known baseline. */
function minimalDataset(): ResearchDataset {
  return {
    id: 'dataset-test',
    name: 'Test dataset',
    version: '1.0',
    domain: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-a', type: 'company', name: 'A Corp', recordedAt: '2026-01-01T00:00:00Z' },
      { id: 'entity-b', type: 'company', name: 'B Corp', recordedAt: '2026-01-01T00:00:00Z' },
    ],
    relationships: [
      {
        id: 'rel-a-b',
        type: 'supplies',
        fromEntityId: 'entity-a',
        toEntityId: 'entity-b',
        states: [
          {
            status: 'qualification track',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
    ],
    evidence: [],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };
}

describe('bumpDatasetVersion', () => {
  it('appends +update.1 to a base version with no update suffix yet', () => {
    expect(bumpDatasetVersion('2026.09')).toBe('2026.09+update.1');
  });

  it('increments an existing +update.N suffix', () => {
    expect(bumpDatasetVersion('2026.09+update.1')).toBe('2026.09+update.2');
    expect(bumpDatasetVersion('2026.09+update.9')).toBe('2026.09+update.10');
  });
});

describe('mergeResearchUpdate', () => {
  it('appends a brand-new entity and a brand-new relationship', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      entities: [
        { id: 'entity-c', type: 'company', name: 'C Corp', recordedAt: '2026-02-01T00:00:00Z' },
      ],
      relationships: [
        {
          id: 'rel-b-c',
          type: 'supplies',
          fromEntityId: 'entity-b',
          toEntityId: 'entity-c',
          states: [
            {
              status: 'qualification track',
              recordedAt: '2026-02-01T00:00:00Z',
              effectiveFrom: '2026-02-01T00:00:00Z',
              evidenceIds: [],
            },
          ],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataset.entities).toHaveLength(3);
    expect(result.dataset.relationships).toHaveLength(2);
    expect(result.summary.addedCounts).toEqual({ entities: 1, relationships: 1 });
    expect(result.summary.appendedRelationshipStates).toEqual({});
  });

  it('appends a new state to an EXISTING relationship id instead of adding a duplicate relationship', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      relationships: [
        {
          id: 'rel-a-b',
          type: 'supplies',
          fromEntityId: 'entity-a',
          toEntityId: 'entity-b',
          states: [
            {
              status: 'production contract',
              recordedAt: '2026-03-01T00:00:00Z',
              effectiveFrom: '2026-03-01T00:00:00Z',
              evidenceIds: [],
            },
          ],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataset.relationships).toHaveLength(1); // still one relationship, not two
    expect(result.dataset.relationships[0]?.states).toHaveLength(2); // now two states
    expect(result.dataset.relationships[0]?.states[1]?.status).toBe('production contract');
    // The previously-open first state gets auto-closed at the new state's effectiveFrom — see
    // closeOutIntermediateStates's own doc comment for why this is filled in, not hand-supplied.
    expect(result.dataset.relationships[0]?.states[0]?.effectiveTo).toBe('2026-03-01T00:00:00Z');
    expect(result.dataset.relationships[0]?.states[1]?.effectiveTo).toBeUndefined();
    expect(result.summary.addedCounts.relationships).toBeUndefined();
    expect(result.summary.appendedRelationshipStates).toEqual({ 'rel-a-b': 1 });
  });

  it('treats an EXISTING entity id as a deliberate edit, not a duplicate', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      entities: [
        // recordedAt is deliberately different here to confirm it's ignored — see merge.ts's own
        // comment on why that field is never client-editable.
        { id: 'entity-a', type: 'company', name: 'Renamed A', recordedAt: '2026-02-01T00:00:00Z' },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataset.entities).toHaveLength(2); // still two entities, not three
    expect(result.dataset.entities[0]?.name).toBe('Renamed A');
    expect(result.dataset.entities[0]?.recordedAt).toBe('2026-01-01T00:00:00Z'); // unchanged
    expect(result.summary.addedCounts.entities).toBeUndefined();
    expect(result.summary.updatedEntityIds).toEqual(['entity-a']);
  });

  it('refuses a no-op update that reuses an existing entity id but changes nothing', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      entities: [
        { id: 'entity-a', type: 'company', name: 'A Corp', recordedAt: '2099-01-01T00:00:00Z' },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/entity-a.*changes nothing/);
  });

  it('refuses an update reusing an EXISTING evidence id', () => {
    const current: ResearchDataset = {
      ...minimalDataset(),
      evidence: [
        {
          id: 'evidence-x',
          observedAt: '2026-01-01T00:00:00Z',
          source: { name: 'Some Source' },
          description: 'original',
          entityIds: ['entity-a'],
        },
      ],
    };
    const update: ResearchUpdate = {
      evidence: [
        {
          id: 'evidence-x',
          observedAt: '2026-02-01T00:00:00Z',
          source: { name: 'Some Source' },
          description: 'a different fact reusing the same id',
          entityIds: ['entity-a'],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/evidence-x.*already exists/);
  });

  it('refuses appending a state to an existing relationship when type/fromEntityId/toEntityId disagree', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      relationships: [
        {
          id: 'rel-a-b',
          type: 'acquires', // disagrees with the existing "supplies"
          fromEntityId: 'entity-a',
          toEntityId: 'entity-b',
          states: [
            {
              status: 'production contract',
              recordedAt: '2026-03-01T00:00:00Z',
              effectiveFrom: '2026-03-01T00:00:00Z',
              evidenceIds: [],
            },
          ],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/different type\/fromEntityId\/toEntityId/);
  });

  it('refuses a no-op update that reuses an existing relationship id but supplies no new states', () => {
    const current = minimalDataset();
    const update: ResearchUpdate = {
      relationships: [
        {
          id: 'rel-a-b',
          type: 'supplies',
          fromEntityId: 'entity-a',
          toEntityId: 'entity-b',
          states: [],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no new states/);
  });

  it('appends a new assessment to an EXISTING hypothesis id instead of adding a duplicate hypothesis', () => {
    const current: ResearchDataset = {
      ...minimalDataset(),
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1',
          statement: 'A becomes B’s primary supplier.',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [
            {
              timestamp: '2026-01-01T00:00:00Z',
              confidence: { value: 0.5 },
              supportingEvidenceIds: [],
              contradictingEvidenceIds: [],
            },
          ],
        },
      ],
    };
    const update: ResearchUpdate = {
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1',
          statement: 'A becomes B’s primary supplier.',
          status: 'falsified',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [
            {
              timestamp: '2026-04-01T00:00:00Z',
              confidence: { value: 0.1 },
              supportingEvidenceIds: [],
              contradictingEvidenceIds: [],
              status: 'falsified',
            },
          ],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataset.hypotheses).toHaveLength(1); // still one hypothesis, not two
    expect(result.dataset.hypotheses[0]?.assessments).toHaveLength(2); // now two assessments
    expect(result.dataset.hypotheses[0]?.status).toBe('falsified');
    expect(result.summary.addedCounts.hypotheses).toBeUndefined();
    expect(result.summary.appendedHypothesisAssessments).toEqual({ 'hypothesis-h1': 1 });
  });

  it("allows a deliberate edit to an existing hypothesis's name/statement, with or without a new assessment", () => {
    const current: ResearchDataset = {
      ...minimalDataset(),
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1',
          statement: 'Original statement.',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [],
        },
      ],
    };
    const update: ResearchUpdate = {
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1 (revised)',
          statement: 'A different statement entirely.',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataset.hypotheses).toHaveLength(1); // still one hypothesis, not two
    expect(result.dataset.hypotheses[0]?.name).toBe('H1 (revised)');
    expect(result.dataset.hypotheses[0]?.statement).toBe('A different statement entirely.');
    expect(result.summary.addedCounts.hypotheses).toBeUndefined();
    expect(result.summary.appendedHypothesisAssessments).toEqual({});
    // Populated even with zero new assessments — see sqlGen.ts's own use of this field for why
    // an assessment-less edit still needs to be flagged as "this row must be rewritten."
    expect(result.summary.updatedHypothesisIds).toEqual(['hypothesis-h1']);
  });

  it('refuses a no-op update that reuses an existing hypothesis id but supplies no new assessments', () => {
    const current: ResearchDataset = {
      ...minimalDataset(),
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1',
          statement: 'Some statement.',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [],
        },
      ],
    };
    const update: ResearchUpdate = {
      hypotheses: [
        {
          id: 'hypothesis-h1',
          name: 'H1',
          statement: 'Some statement.',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          assessments: [],
        },
      ],
    };

    const result = mergeResearchUpdate(current, update);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no new assessments/);
  });
});
