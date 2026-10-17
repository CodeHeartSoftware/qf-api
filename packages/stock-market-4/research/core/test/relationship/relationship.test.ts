import { describe, expect, it } from 'vitest';
import {
  findOverlappingRelationshipStates,
  parseResearchRelationship,
} from '../../src/relationship/relationship.js';
import type { RelationshipState } from '../../src/relationship/relationship-state.js';

function state(
  overrides: Partial<RelationshipState> & Pick<RelationshipState, 'status' | 'effectiveFrom'>,
): RelationshipState {
  return {
    recordedAt: overrides.effectiveFrom,
    evidenceIds: [],
    ...overrides,
  };
}

function baseRelationship(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel-walter-tosto-sparc',
    type: 'supplies',
    fromEntityId: 'entity-walter-tosto',
    toEntityId: 'entity-sparc',
    states: [state({ status: 'qualified', effectiveFrom: '2025-01-01T00:00:00Z' })],
    ...overrides,
  };
}

describe('ResearchRelationship construction', () => {
  it('accepts a minimal valid relationship', () => {
    expect(parseResearchRelationship(baseRelationship()).ok).toBe(true);
  });

  it('requires a non-empty type, fromEntityId, and toEntityId', () => {
    expect(parseResearchRelationship(baseRelationship({ type: '' })).ok).toBe(false);
    expect(parseResearchRelationship(baseRelationship({ fromEntityId: '' })).ok).toBe(false);
    expect(parseResearchRelationship(baseRelationship({ toEntityId: '' })).ok).toBe(false);
  });

  it('accepts an empty states array — a relationship with no recorded status history yet', () => {
    expect(parseResearchRelationship(baseRelationship({ states: [] })).ok).toBe(true);
  });

  it('rejects a relationship whose states overlap', () => {
    const states = [
      state({
        status: 'tested',
        effectiveFrom: '2024-01-01T00:00:00Z',
        effectiveTo: '2025-06-01T00:00:00Z',
      }),
      state({ status: 'qualified', effectiveFrom: '2025-01-01T00:00:00Z' }),
    ];
    expect(parseResearchRelationship(baseRelationship({ states })).ok).toBe(false);
  });
});

describe('relationship state transitions over time', () => {
  it('accepts a sequential, non-overlapping chain of states', () => {
    const states = [
      state({
        status: 'tested',
        effectiveFrom: '2023-01-01T00:00:00Z',
        effectiveTo: '2024-01-01T00:00:00Z',
      }),
      state({
        status: 'qualified',
        effectiveFrom: '2024-01-01T00:00:00Z',
        effectiveTo: '2025-06-01T00:00:00Z',
      }),
      state({ status: 'production contract', effectiveFrom: '2025-06-01T00:00:00Z' }),
    ];
    expect(findOverlappingRelationshipStates(states)).toEqual([]);
    expect(parseResearchRelationship(baseRelationship({ states })).ok).toBe(true);
  });

  it('accepts states given out of chronological order in the array', () => {
    const states = [
      state({ status: 'qualified', effectiveFrom: '2024-01-01T00:00:00Z' }),
      state({
        status: 'tested',
        effectiveFrom: '2023-01-01T00:00:00Z',
        effectiveTo: '2024-01-01T00:00:00Z',
      }),
    ];
    expect(findOverlappingRelationshipStates(states)).toEqual([]);
  });

  it('flags an earlier state left open-ended when a later state supersedes it', () => {
    const states = [
      state({ status: 'tested', effectiveFrom: '2023-01-01T00:00:00Z' }),
      state({ status: 'qualified', effectiveFrom: '2024-01-01T00:00:00Z' }),
    ];
    const issues = findOverlappingRelationshipStates(states);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('open-ended-state-superseded');
  });

  it('flags two states with the same effectiveFrom as ambiguous', () => {
    const states = [
      state({ status: 'tested', effectiveFrom: '2024-01-01T00:00:00Z' }),
      state({ status: 'qualified', effectiveFrom: '2024-01-01T00:00:00Z' }),
    ];
    const issues = findOverlappingRelationshipStates(states);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('ambiguous-effective-from');
  });

  it('flags genuinely overlapping intervals', () => {
    const states = [
      state({
        status: 'tested',
        effectiveFrom: '2023-01-01T00:00:00Z',
        effectiveTo: '2024-06-01T00:00:00Z',
      }),
      state({ status: 'qualified', effectiveFrom: '2024-01-01T00:00:00Z' }),
    ];
    const issues = findOverlappingRelationshipStates(states);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('overlapping-relationship-states');
  });

  it('allows one state to end exactly when the next begins (touching, not overlapping)', () => {
    const states = [
      state({
        status: 'tested',
        effectiveFrom: '2023-01-01T00:00:00Z',
        effectiveTo: '2024-01-01T00:00:00Z',
      }),
      state({ status: 'qualified', effectiveFrom: '2024-01-01T00:00:00Z' }),
    ];
    expect(findOverlappingRelationshipStates(states)).toEqual([]);
  });
});
