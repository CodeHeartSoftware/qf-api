import { describe, expect, it } from 'vitest';
import { computeResearchDelta } from '../../src/research/delta.js';
import type { ResearchState } from '../../src/research/types.js';

function emptyState(timestamp: string): ResearchState {
  return {
    timestamp,
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

describe('computeResearchDelta', () => {
  it('reports everything as new when there is no previous snapshot', () => {
    const current: ResearchState = {
      ...emptyState('t2'),
      evidence: [
        { id: 'e1', observedAt: 't1', source: { name: 's' }, description: 'd', entityIds: [] },
      ],
    };
    const delta = computeResearchDelta(undefined, current);
    expect(delta.isEmpty).toBe(false);
    expect(delta.newEvidence.map((e) => e.id)).toEqual(['e1']);
  });

  it('is empty when nothing changed between two identical snapshots', () => {
    const state: ResearchState = {
      ...emptyState('t1'),
      evidence: [
        { id: 'e1', observedAt: 't1', source: { name: 's' }, description: 'd', entityIds: [] },
      ],
      hypotheses: [
        {
          id: 'h1',
          name: 'H1',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't0',
              confidence: { value: 0.5 },
              supportingEvidenceIds: [],
              contradictingEvidenceIds: [],
            },
          ],
        },
      ],
      relationships: [
        {
          id: 'r1',
          type: 'manufactures',
          fromEntityId: 'a',
          toEntityId: 'b',
          states: [{ status: 'active', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [] }],
        },
      ],
    };
    const delta = computeResearchDelta(state, state);
    expect(delta.isEmpty).toBe(true);
    expect(delta.newEvidence).toEqual([]);
    expect(delta.changedHypotheses).toEqual([]);
    expect(delta.changedRelationships).toEqual([]);
    expect(delta.newEvents).toEqual([]);
  });

  it('detects a new evidence item added since the previous snapshot', () => {
    const previous = emptyState('t1');
    const current: ResearchState = {
      ...emptyState('t2'),
      evidence: [
        { id: 'e1', observedAt: 't2', source: { name: 's' }, description: 'new', entityIds: [] },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    expect(delta.isEmpty).toBe(false);
    expect(delta.newEvidence).toHaveLength(1);
    expect(delta.newEvidence[0]?.description).toBe('new');
  });

  it('detects a hypothesis confidence change, not just presence', () => {
    const makeState = (confidence: number): ResearchState => ({
      ...emptyState('t'),
      hypotheses: [
        {
          id: 'h1',
          name: 'H1',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't',
              confidence: { value: confidence },
              supportingEvidenceIds: [],
              contradictingEvidenceIds: [],
            },
          ],
        },
      ],
    });
    const delta = computeResearchDelta(makeState(0.3), makeState(0.3));
    expect(delta.isEmpty).toBe(true);

    const changed = computeResearchDelta(makeState(0.3), makeState(0.6));
    expect(changed.isEmpty).toBe(false);
    expect(changed.changedHypotheses).toEqual([
      {
        hypothesisId: 'h1',
        name: 'H1',
        previousConfidence: 0.3,
        currentConfidence: 0.6,
        rationale: undefined,
      },
    ]);
  });

  it('reports a relationship going from absent to UNKNOWN as a real, reportable change', () => {
    const previous = emptyState('t1');
    const current: ResearchState = {
      ...emptyState('t2'),
      relationships: [
        {
          id: 'r1',
          type: 'potential_fusion_customer',
          fromEntityId: 'a',
          toEntityId: 'b',
          states: [
            {
              status: 'UNKNOWN',
              confidence: { value: 0 },
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    expect(delta.isEmpty).toBe(false);
    expect(delta.changedRelationships).toEqual([
      {
        relationshipId: 'r1',
        type: 'potential_fusion_customer',
        fromEntityId: 'a',
        toEntityId: 'b',
        previousStatus: null,
        currentStatus: 'UNKNOWN',
      },
    ]);
  });

  it('does not report a relationship whose status is unchanged, even with new evidenceIds recorded', () => {
    const previous: ResearchState = {
      ...emptyState('t1'),
      relationships: [
        {
          id: 'r1',
          type: 'manufactures',
          fromEntityId: 'a',
          toEntityId: 'b',
          states: [
            { status: 'active', recordedAt: 't1', effectiveFrom: 't1', evidenceIds: ['e1'] },
          ],
        },
      ],
    };
    const current: ResearchState = {
      ...emptyState('t2'),
      relationships: [
        {
          id: 'r1',
          type: 'manufactures',
          fromEntityId: 'a',
          toEntityId: 'b',
          states: [
            { status: 'active', recordedAt: 't1', effectiveFrom: 't1', evidenceIds: ['e1'] },
            { status: 'active', recordedAt: 't2', effectiveFrom: 't1', evidenceIds: ['e1', 'e2'] },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    expect(delta.isEmpty).toBe(true);
  });

  it('detects new events by id', () => {
    const previous = emptyState('t1');
    const current: ResearchState = {
      ...emptyState('t2'),
      events: [
        {
          id: 'ev1',
          timestamp: 't2',
          type: 'ACQUISITION_ANNOUNCED',
          entityIds: [],
          payload: {},
          evidenceIds: [],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    expect(delta.newEvents.map((e) => e.id)).toEqual(['ev1']);
  });
});
