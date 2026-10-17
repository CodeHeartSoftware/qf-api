import { describe, expect, it } from 'vitest';
import { computeResearchStateAt, createResearchStateProvider } from '../../src/state/provider.js';
import type { ResearchDataset } from '../../src/dataset/dataset.js';

const EARLY = '2026-01-01T00:00:00Z';
const LATE = '2029-06-01T00:00:00Z';
const BETWEEN_EARLY_AND_LATE = '2027-06-01T00:00:00Z';

/**
 * A dataset with exactly one "early" (knowable by EARLY) and one "late" (not knowable until
 * LATE) member of every collection, plus the two special cases (a relationship needing its
 * states trimmed rather than dropped wholesale, and a hypothesis needing its assessments
 * trimmed while the hypothesis itself stays visible).
 */
function buildFixtureDataset(): ResearchDataset {
  return {
    id: 'dataset-fixture',
    name: 'Provider fixture',
    version: '1.0.0',
    domain: 'test',
    createdAt: EARLY,
    entities: [
      { id: 'entity-early', type: 'company', name: 'Early Co', recordedAt: EARLY },
      { id: 'entity-late', type: 'company', name: 'Late Co', recordedAt: LATE },
    ],
    relationships: [
      {
        id: 'rel-trimmed',
        type: 'supplies',
        fromEntityId: 'entity-early',
        toEntityId: 'entity-early',
        states: [
          { status: 'tested', recordedAt: EARLY, effectiveFrom: EARLY, evidenceIds: [] },
          { status: 'qualified', recordedAt: LATE, effectiveFrom: LATE, evidenceIds: [] },
        ],
      },
      {
        id: 'rel-fully-future',
        type: 'supplies',
        fromEntityId: 'entity-early',
        toEntityId: 'entity-early',
        states: [{ status: 'qualified', recordedAt: LATE, effectiveFrom: LATE, evidenceIds: [] }],
      },
    ],
    evidence: [
      {
        id: 'evidence-early',
        observedAt: EARLY,
        source: { name: 'x' },
        description: 'early evidence',
        entityIds: [],
      },
      {
        id: 'evidence-late',
        observedAt: LATE,
        source: { name: 'x' },
        description: 'late evidence',
        entityIds: [],
      },
    ],
    assertions: [
      {
        id: 'assertion-early',
        statement: 'early',
        status: 'active',
        createdAt: EARLY,
        evidenceIds: [],
      },
      {
        id: 'assertion-late',
        statement: 'late',
        status: 'active',
        createdAt: LATE,
        evidenceIds: [],
      },
    ],
    hypotheses: [
      {
        id: 'hypothesis-h032',
        name: 'H032',
        statement: 'Vacuum-vessel fabrication is a major commercial bottleneck.',
        status: 'active',
        createdAt: EARLY,
        assessments: [
          {
            timestamp: '2026-12-31T23:59:59Z',
            confidence: { value: 0.94 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
          },
          {
            timestamp: '2028-12-31T23:59:59Z',
            confidence: { value: 0.81 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
          },
          {
            timestamp: '2029-12-31T23:59:59Z',
            confidence: { value: 0.42 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: 'hypothesis-late',
        name: 'Late hypothesis',
        statement: 'Not proposed until LATE.',
        status: 'proposed',
        createdAt: LATE,
        assessments: [],
      },
      {
        id: 'hypothesis-status-change',
        name: 'Status timeline hypothesis',
        statement: 'A hypothesis whose status changes over time.',
        status: 'falsified',
        createdAt: EARLY,
        assessments: [
          {
            timestamp: BETWEEN_EARLY_AND_LATE,
            confidence: { value: 0.5 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
            status: 'active',
          },
          {
            timestamp: LATE,
            confidence: { value: 0.1 },
            supportingEvidenceIds: [],
            contradictingEvidenceIds: [],
            status: 'falsified',
          },
        ],
      },
    ],
    assumptions: [
      { id: 'assumption-early', name: 'a', description: 'a', value: 1, recordedAt: EARLY },
      { id: 'assumption-late', name: 'a', description: 'a', value: 1, recordedAt: LATE },
    ],
    variables: [
      { id: 'variable-early', name: 'v', value: 1, origin: 'observed', recordedAt: EARLY },
      { id: 'variable-late', name: 'v', value: 1, origin: 'observed', recordedAt: LATE },
    ],
    models: [
      {
        id: 'model-early',
        name: 'm',
        variableIds: [],
        assumptionIds: [],
        calculations: [],
        outputVariableIds: [],
        createdAt: EARLY,
      },
      {
        id: 'model-late',
        name: 'm',
        variableIds: [],
        assumptionIds: [],
        calculations: [],
        outputVariableIds: [],
        createdAt: LATE,
      },
    ],
    scenarios: [
      {
        id: 'scenario-early',
        name: 's',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: EARLY,
      },
      {
        id: 'scenario-late',
        name: 's',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: LATE,
      },
    ],
    events: [
      {
        id: 'event-early',
        timestamp: EARLY,
        type: 'EARLY_EVENT',
        entityIds: [],
        payload: {},
        evidenceIds: [],
      },
      {
        id: 'event-supplier-won-contract',
        timestamp: LATE,
        type: 'SUPPLIER_WON_CONTRACT',
        entityIds: [],
        payload: {},
        evidenceIds: [],
      },
    ],
    questions: [
      { id: 'question-early', question: 'early question', status: 'open', createdAt: EARLY },
      { id: 'question-late', question: 'late question', status: 'open', createdAt: LATE },
    ],
  };
}

describe('computeResearchStateAt: per-collection visibility', () => {
  it('includes only entities recordedAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.entities.map((e) => e.id)).toEqual(['entity-early']);
  });

  it('includes only evidence observedAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.evidence.map((e) => e.id)).toEqual(['evidence-early']);
  });

  it('includes only assertions createdAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.assertions.map((a) => a.id)).toEqual(['assertion-early']);
  });

  it('includes only assumptions/variables/scenarios recordedAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.assumptions.map((a) => a.id)).toEqual(['assumption-early']);
    expect(state.variables.map((v) => v.id)).toEqual(['variable-early']);
    expect(state.scenarios.map((s) => s.id)).toEqual(['scenario-early']);
  });

  it('includes only models createdAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.models.map((m) => m.id)).toEqual(['model-early']);
  });

  it('includes only events timestamp <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.events.map((e) => e.id)).toEqual(['event-early']);
  });

  it('includes only questions createdAt <= T', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.questions.map((q) => q.id)).toEqual(['question-early']);
  });

  it('at a time after everything, includes every collection member', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2030-01-01T00:00:00Z');
    expect(state.entities.map((e) => e.id)).toEqual(['entity-early', 'entity-late']);
    expect(state.evidence.map((e) => e.id)).toEqual(['evidence-early', 'evidence-late']);
    expect(state.events.map((e) => e.id)).toEqual(['event-early', 'event-supplier-won-contract']);
    expect(state.questions.map((q) => q.id)).toEqual(['question-early', 'question-late']);
  });

  it('at a time before everything, includes nothing', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2020-01-01T00:00:00Z');
    expect(state.entities).toEqual([]);
    expect(state.evidence).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.questions).toEqual([]);
    expect(state.assertions).toEqual([]);
    expect(state.assumptions).toEqual([]);
    expect(state.variables).toEqual([]);
    expect(state.models).toEqual([]);
    expect(state.scenarios).toEqual([]);
    expect(state.relationships).toEqual([]);
    expect(state.hypotheses).toEqual([]);
  });
});

describe('computeResearchStateAt: relationships (trim states, drop if none visible)', () => {
  it('trims a relationship down to only its visible states, keeping the relationship', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    const relationship = state.relationships.find((r) => r.id === 'rel-trimmed');
    expect(relationship).toBeDefined();
    expect(relationship?.states.map((s) => s.status)).toEqual(['tested']);
  });

  it('drops a relationship entirely when none of its states are visible yet', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.relationships.some((r) => r.id === 'rel-fully-future')).toBe(false);
  });

  it('includes both states once both are visible', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2030-01-01T00:00:00Z');
    const relationship = state.relationships.find((r) => r.id === 'rel-trimmed');
    expect(relationship?.states.map((s) => s.status)).toEqual(['tested', 'qualified']);
  });
});

describe('computeResearchStateAt: hypotheses (trim assessments, keep hypothesis if createdAt <= T)', () => {
  it('keeps a hypothesis with zero visible assessments once its own createdAt has passed', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2026-06-01T00:00:00Z');
    const h032 = state.hypotheses.find((h) => h.id === 'hypothesis-h032');
    expect(h032).toBeDefined();
    expect(h032?.assessments).toEqual([]);
  });

  it('drops a hypothesis entirely before its own createdAt', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    expect(state.hypotheses.some((h) => h.id === 'hypothesis-late')).toBe(false);
  });
});

describe('hypothesis confidence history over time (spec §44)', () => {
  it('returns exactly the 2026 assessment at end-of-2026', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2026-12-31T23:59:59Z');
    const h032 = state.hypotheses.find((h) => h.id === 'hypothesis-h032');
    expect(h032?.assessments.map((a) => a.confidence.value)).toEqual([0.94]);
  });

  it('returns exactly the 2026 and 2028 assessments at end-of-2028, not 2029', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2028-12-31T23:59:59Z');
    const h032 = state.hypotheses.find((h) => h.id === 'hypothesis-h032');
    expect(h032?.assessments.map((a) => a.confidence.value)).toEqual([0.94, 0.81]);
  });

  it('returns all three assessments at end-of-2029', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), '2029-12-31T23:59:59Z');
    const h032 = state.hypotheses.find((h) => h.id === 'hypothesis-h032');
    expect(h032?.assessments.map((a) => a.confidence.value)).toEqual([0.94, 0.81, 0.42]);
  });

  it('a 2027 snapshot cannot see the 2028 or 2029 assessments', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    const h032 = state.hypotheses.find((h) => h.id === 'hypothesis-h032');
    expect(h032?.assessments.map((a) => a.confidence.value)).toEqual([0.94]);
  });
});

describe('hypothesis status history over time (point-in-time correctness)', () => {
  it("before any status-carrying assessment is visible, falls back to the hypothesis's own status field (documented gap — see provider.ts)", () => {
    // EARLY is exactly this hypothesis's createdAt, so it's visible but neither status-carrying
    // assessment yet is — the one known gap `provider.ts`'s own doc comment calls out: with no
    // prior status-carrying assessment to fall back on, this reflects the hypothesis's CURRENT
    // (here, final) status rather than an honest "not yet known."
    const state = computeResearchStateAt(buildFixtureDataset(), EARLY);
    const h = state.hypotheses.find((x) => x.id === 'hypothesis-status-change');
    expect(h?.status).toBe('falsified');
  });

  it('once the first status-carrying assessment is visible, reflects ITS status, not the final one', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), BETWEEN_EARLY_AND_LATE);
    const h = state.hypotheses.find((x) => x.id === 'hypothesis-status-change');
    expect(h?.status).toBe('active');
  });

  it('once the later status-carrying assessment is also visible, reflects the final status', () => {
    const state = computeResearchStateAt(buildFixtureDataset(), LATE);
    const h = state.hypotheses.find((x) => x.id === 'hypothesis-status-change');
    expect(h?.status).toBe('falsified');
  });
});

describe('critical information-leak test (spec §45)', () => {
  it('a 2028 snapshot does not contain the 2029 SUPPLIER_WON_CONTRACT event, even though it exists in the full dataset', () => {
    const dataset = buildFixtureDataset();
    const state2028 = computeResearchStateAt(dataset, '2028-12-31T23:59:59Z');
    expect(state2028.events.some((e) => e.type === 'SUPPLIER_WON_CONTRACT')).toBe(false);

    const serialized = JSON.stringify(state2028);
    expect(serialized).not.toContain('SUPPLIER_WON_CONTRACT');
  });

  it('the same dataset DOES contain the event once the snapshot is taken at or after it happened', () => {
    const dataset = buildFixtureDataset();
    const stateAfter = computeResearchStateAt(dataset, LATE);
    expect(stateAfter.events.some((e) => e.type === 'SUPPLIER_WON_CONTRACT')).toBe(true);
  });

  it('never mutates the source dataset while reconstructing state', () => {
    const dataset = buildFixtureDataset();
    const before = JSON.stringify(dataset);
    computeResearchStateAt(dataset, BETWEEN_EARLY_AND_LATE);
    expect(JSON.stringify(dataset)).toBe(before);
  });
});

describe('createResearchStateProvider', () => {
  it('getStateAt matches computeResearchStateAt for the same dataset and timestamp', () => {
    const dataset = buildFixtureDataset();
    const provider = createResearchStateProvider(dataset);
    expect(provider.getStateAt(BETWEEN_EARLY_AND_LATE)).toEqual(
      computeResearchStateAt(dataset, BETWEEN_EARLY_AND_LATE),
    );
  });

  it('is deterministic: repeated calls at the same timestamp return equal results', () => {
    const provider = createResearchStateProvider(buildFixtureDataset());
    expect(provider.getStateAt(BETWEEN_EARLY_AND_LATE)).toEqual(
      provider.getStateAt(BETWEEN_EARLY_AND_LATE),
    );
  });
});
