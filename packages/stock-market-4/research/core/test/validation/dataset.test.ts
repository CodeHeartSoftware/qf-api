import { describe, expect, it } from 'vitest';
import {
  findDuplicateIds,
  findMissingReferences,
  findTemporalIntegrityViolations,
  validateResearchDataset,
} from '../../src/validation/dataset.js';
import type { ResearchDataset } from '../../src/dataset/dataset.js';

/** After every timestamp in `validDataset()` — used to mutate a target's own timestamp so a
 * reference to it becomes a forward reference (cited before it was knowable). */
const FUTURE = '2027-01-01T00:00:00Z';

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one item in this fixture array');
  return item;
}

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined)
    throw new Error(`expected an item at index ${String(index)} in this fixture array`);
  return item;
}

/**
 * A small, internally-consistent dataset exercising every reference kind
 * `findMissingReferences` checks, so each test below can mutate exactly one reference to prove
 * it gets caught.
 */
function validDataset(): ResearchDataset {
  return {
    id: 'dataset-fixture',
    name: 'Cross-reference fixture',
    version: '1.0.0',
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
      {
        id: 'entity-walter-tosto',
        type: 'company',
        name: 'Walter Tosto',
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    relationships: [
      {
        id: 'rel-walter-tosto-arc',
        type: 'supplies',
        fromEntityId: 'entity-walter-tosto',
        toEntityId: 'entity-arc',
        states: [
          {
            status: 'qualified',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: ['evidence-1'],
          },
        ],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'press release' },
        description: 'Walter Tosto reported vacuum-vessel qualification work.',
        entityIds: ['entity-walter-tosto', 'entity-arc'],
      },
    ],
    assertions: [
      {
        id: 'assertion-1',
        statement: 'Supplier qualification does not imply commercial procurement.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        evidenceIds: ['evidence-1'],
        entityIds: ['entity-walter-tosto'],
        relationshipIds: ['rel-walter-tosto-arc'],
      },
    ],
    hypotheses: [
      {
        id: 'hypothesis-h032',
        name: 'H032',
        statement: 'Vacuum-vessel fabrication is a major commercial bottleneck.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            confidence: { value: 0.9 },
            supportingEvidenceIds: ['evidence-1'],
            contradictingEvidenceIds: [],
          },
        ],
        falsifiers: [{ description: 'A second supplier qualifies.', evidenceIds: ['evidence-1'] }],
      },
    ],
    assumptions: [
      {
        id: 'assumption-1',
        name: 'Tritium price',
        description: 'Assumed constant tritium price.',
        value: 30000,
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    variables: [
      {
        id: 'variable-revenue',
        name: 'Revenue',
        value: 100,
        origin: 'derived',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'variable-reactors',
        name: 'Reactors',
        value: 1,
        origin: 'observed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    models: [
      {
        id: 'model-revenue',
        name: 'Revenue model',
        variableIds: ['variable-reactors', 'variable-revenue'],
        assumptionIds: ['assumption-1'],
        calculations: [
          {
            id: 'calc-revenue',
            name: 'Revenue calc',
            formula: 'Revenue = Reactors × Price',
            inputVariableIds: ['variable-reactors'],
            outputVariableId: 'variable-revenue',
            assumptionIds: ['assumption-1'],
          },
        ],
        outputVariableIds: ['variable-revenue'],
        createdAt: '2026-01-01T00:00:00Z',
        evidenceIds: ['evidence-1'],
      },
    ],
    scenarios: [
      {
        id: 'scenario-base-case',
        name: 'Base case',
        assumptionIds: ['assumption-1'],
        variableOverrides: {},
        eventIds: [],
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'scenario-high-demand',
        name: 'High demand',
        parentScenarioId: 'scenario-base-case',
        assumptionIds: ['assumption-1'],
        variableOverrides: { 'variable-revenue': 200 },
        eventIds: ['event-qualified'],
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    events: [
      {
        id: 'event-qualified',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'SUPPLIER_QUALIFIED',
        entityIds: ['entity-walter-tosto'],
        payload: {},
        evidenceIds: ['evidence-1'],
      },
    ],
    questions: [
      {
        id: 'question-1',
        question: 'What is the tungsten content of the SPARC vacuum vessel?',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        relatedEntityIds: ['entity-walter-tosto'],
        relatedHypothesisIds: ['hypothesis-h032'],
      },
    ],
  };
}

describe('validateResearchDataset', () => {
  it('accepts a fully valid, internally-consistent dataset', () => {
    const result = validateResearchDataset(validDataset());
    expect(result.ok).toBe(true);
  });

  it('returns structural issues (not a crash) for malformed input, without attempting cross-reference checks', () => {
    const result = validateResearchDataset({ not: 'a dataset' });
    expect(result.ok).toBe(false);
  });
});

describe('findDuplicateIds', () => {
  it('finds no duplicates in a valid dataset', () => {
    expect(findDuplicateIds(validDataset())).toEqual([]);
  });

  it('flags an id reused across two different collections', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), id: 'entity-arc' }];
    const issues = findDuplicateIds(dataset);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('duplicate-id');
  });

  it('flags an id reused within the same collection', () => {
    const dataset = validDataset();
    dataset.entities = [first(dataset.entities), { ...first(dataset.entities) }];
    const issues = findDuplicateIds(dataset);
    expect(issues).toHaveLength(1);
  });
});

describe('findMissingReferences', () => {
  it('finds nothing wrong in a valid dataset', () => {
    expect(findMissingReferences(validDataset())).toEqual([]);
  });

  it('flags a relationship whose fromEntityId does not exist', () => {
    const dataset = validDataset();
    dataset.relationships = [{ ...first(dataset.relationships), fromEntityId: 'entity-missing' }];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'relationships.0.fromEntityId')).toBe(true);
  });

  it('flags a relationship state citing missing evidence', () => {
    const dataset = validDataset();
    const relationship = first(dataset.relationships);
    dataset.relationships = [
      {
        ...relationship,
        states: [{ ...first(relationship.states), evidenceIds: ['evidence-missing'] }],
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'relationships.0.states.0.evidenceIds.0')).toBe(true);
  });

  it('flags evidence citing a missing entity', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), entityIds: ['entity-missing'] }];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'evidence.0.entityIds.0')).toBe(true);
  });

  it('flags an assertion citing missing evidence, entity, or relationship', () => {
    const dataset = validDataset();
    dataset.assertions = [
      {
        ...first(dataset.assertions),
        evidenceIds: ['missing'],
        entityIds: ['missing'],
        relationshipIds: ['missing'],
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'assertions.0.evidenceIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'assertions.0.entityIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'assertions.0.relationshipIds.0')).toBe(true);
  });

  it('flags a hypothesis assessment/falsifier citing missing evidence', () => {
    const dataset = validDataset();
    const hypothesis = first(dataset.hypotheses);
    dataset.hypotheses = [
      {
        ...hypothesis,
        assessments: [{ ...first(hypothesis.assessments), supportingEvidenceIds: ['missing'] }],
        falsifiers: [{ description: 'x', evidenceIds: ['missing'] }],
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(
      issues.some((i) => i.path === 'hypotheses.0.assessments.0.supportingEvidenceIds.0'),
    ).toBe(true);
    expect(issues.some((i) => i.path === 'hypotheses.0.falsifiers.0.evidenceIds.0')).toBe(true);
  });

  it('flags a model/calculation citing missing variables, assumptions, or evidence', () => {
    const dataset = validDataset();
    const model = first(dataset.models);
    dataset.models = [
      {
        ...model,
        variableIds: ['missing'],
        assumptionIds: ['missing'],
        outputVariableIds: ['missing'],
        evidenceIds: ['missing'],
        calculations: [
          {
            ...first(model.calculations),
            inputVariableIds: ['missing'],
            outputVariableId: 'also-missing',
            assumptionIds: ['missing'],
          },
        ],
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'models.0.variableIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.assumptionIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.outputVariableIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.evidenceIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.calculations.0.inputVariableIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.calculations.0.outputVariableId')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.calculations.0.assumptionIds.0')).toBe(true);
  });

  it('flags a scenario citing missing assumptions, events, an override variable, or a parent scenario', () => {
    const dataset = validDataset();
    dataset.scenarios = [
      {
        ...nth(dataset.scenarios, 1),
        assumptionIds: ['missing'],
        variableOverrides: { 'variable-missing': 1 },
        eventIds: ['missing'],
        parentScenarioId: 'scenario-missing',
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'scenarios.0.assumptionIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'scenarios.0.eventIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'scenarios.0.parentScenarioId')).toBe(true);
    expect(issues.some((i) => i.path === 'scenarios.0.variableOverrides.variable-missing')).toBe(
      true,
    );
  });

  it('flags an event citing missing entities or evidence', () => {
    const dataset = validDataset();
    dataset.events = [
      { ...first(dataset.events), entityIds: ['missing'], evidenceIds: ['missing'] },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'events.0.entityIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'events.0.evidenceIds.0')).toBe(true);
  });

  it('flags a question citing missing entities or hypotheses', () => {
    const dataset = validDataset();
    dataset.questions = [
      {
        ...first(dataset.questions),
        relatedEntityIds: ['missing'],
        relatedHypothesisIds: ['missing'],
      },
    ];
    const issues = findMissingReferences(dataset);
    expect(issues.some((i) => i.path === 'questions.0.relatedEntityIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'questions.0.relatedHypothesisIds.0')).toBe(true);
  });
});

describe('findTemporalIntegrityViolations', () => {
  it('finds nothing wrong in a valid dataset', () => {
    expect(findTemporalIntegrityViolations(validDataset())).toEqual([]);
  });

  it("flags a relationship whose endpoint entity wasn't recorded until after the relationship's earliest state", () => {
    // fromEntityId is 'entity-walter-tosto', the second entity in validDataset() — mutate it
    // specifically, preserving the first, rather than replacing the whole entities array.
    const dataset = validDataset();
    dataset.entities = [
      first(dataset.entities),
      { ...nth(dataset.entities, 1), recordedAt: FUTURE },
    ];
    const issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'relationships.0.fromEntityId')).toBe(true);
  });

  it('flags a relationship state citing evidence not observed until after the state was recorded', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), observedAt: FUTURE }];
    const issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'relationships.0.states.0.evidenceIds.0')).toBe(true);
  });

  it('flags evidence citing an entity not recorded until after the evidence was observed', () => {
    // evidence.entityIds is ['entity-walter-tosto', 'entity-arc'] — mutating the entities array's
    // second entry ('entity-walter-tosto') lands on entityIds index 0.
    const dataset = validDataset();
    dataset.entities = [
      first(dataset.entities),
      { ...nth(dataset.entities, 1), recordedAt: FUTURE },
    ];
    const issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'evidence.0.entityIds.0')).toBe(true);
  });

  it('flags an assertion citing evidence, an entity, or a relationship not yet knowable when it was created', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), observedAt: FUTURE }];
    const issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'assertions.0.evidenceIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'assertions.0.entityIds.0')).toBe(false);
    // entityIds/relationshipIds share the same evidence-citing entity, so mutate independently:
    const datasetForEntity = validDataset();
    datasetForEntity.entities = [
      first(datasetForEntity.entities),
      { ...nth(datasetForEntity.entities, 1), recordedAt: FUTURE },
    ];
    const entityIssues = findTemporalIntegrityViolations(datasetForEntity);
    expect(entityIssues.some((i) => i.path === 'assertions.0.entityIds.0')).toBe(true);

    const datasetForRelationship = validDataset();
    const relationship = first(datasetForRelationship.relationships);
    datasetForRelationship.relationships = [
      { ...relationship, states: [{ ...first(relationship.states), recordedAt: FUTURE }] },
    ];
    const relationshipIssues = findTemporalIntegrityViolations(datasetForRelationship);
    expect(relationshipIssues.some((i) => i.path === 'assertions.0.relationshipIds.0')).toBe(true);
  });

  it('flags a hypothesis assessment/falsifier citing evidence not yet knowable', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), observedAt: FUTURE }];
    const issues = findTemporalIntegrityViolations(dataset);
    expect(
      issues.some((i) => i.path === 'hypotheses.0.assessments.0.supportingEvidenceIds.0'),
    ).toBe(true);
    expect(issues.some((i) => i.path === 'hypotheses.0.falsifiers.0.evidenceIds.0')).toBe(true);
  });

  it('flags a model/calculation citing variables, assumptions, or evidence not yet knowable when the model was created', () => {
    const dataset = validDataset();
    dataset.variables = dataset.variables.map((variable) =>
      variable.id === 'variable-revenue' ? { ...variable, recordedAt: FUTURE } : variable,
    );
    const issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'models.0.variableIds.1')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.outputVariableIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'models.0.calculations.0.outputVariableId')).toBe(true);

    const datasetForAssumption = validDataset();
    datasetForAssumption.assumptions = [
      { ...first(datasetForAssumption.assumptions), recordedAt: FUTURE },
    ];
    const assumptionIssues = findTemporalIntegrityViolations(datasetForAssumption);
    expect(assumptionIssues.some((i) => i.path === 'models.0.assumptionIds.0')).toBe(true);
    expect(assumptionIssues.some((i) => i.path === 'models.0.calculations.0.assumptionIds.0')).toBe(
      true,
    );

    const datasetForEvidence = validDataset();
    datasetForEvidence.evidence = [{ ...first(datasetForEvidence.evidence), observedAt: FUTURE }];
    const evidenceIssues = findTemporalIntegrityViolations(datasetForEvidence);
    expect(evidenceIssues.some((i) => i.path === 'models.0.evidenceIds.0')).toBe(true);
  });

  it('flags a scenario citing assumptions, events, an override variable, or a parent scenario not yet knowable', () => {
    const dataset = validDataset();
    dataset.assumptions = [{ ...first(dataset.assumptions), recordedAt: FUTURE }];
    let issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'scenarios.0.assumptionIds.0')).toBe(true);
    expect(issues.some((i) => i.path === 'scenarios.1.assumptionIds.0')).toBe(true);

    const datasetForEvent = validDataset();
    datasetForEvent.events = [{ ...first(datasetForEvent.events), timestamp: FUTURE }];
    issues = findTemporalIntegrityViolations(datasetForEvent);
    expect(issues.some((i) => i.path === 'scenarios.1.eventIds.0')).toBe(true);

    const datasetForVariable = validDataset();
    datasetForVariable.variables = datasetForVariable.variables.map((variable) =>
      variable.id === 'variable-revenue' ? { ...variable, recordedAt: FUTURE } : variable,
    );
    issues = findTemporalIntegrityViolations(datasetForVariable);
    expect(issues.some((i) => i.path === 'scenarios.1.variableOverrides.variable-revenue')).toBe(
      true,
    );

    const datasetForParent = validDataset();
    datasetForParent.scenarios = [
      { ...first(datasetForParent.scenarios), recordedAt: FUTURE },
      nth(datasetForParent.scenarios, 1),
    ];
    issues = findTemporalIntegrityViolations(datasetForParent);
    expect(issues.some((i) => i.path === 'scenarios.1.parentScenarioId')).toBe(true);
  });

  it('flags an event citing an entity or evidence not yet knowable', () => {
    // event.entityIds cites 'entity-walter-tosto', the second entity in validDataset() — mutate
    // it specifically, preserving the first.
    const dataset = validDataset();
    dataset.entities = [
      first(dataset.entities),
      { ...nth(dataset.entities, 1), recordedAt: FUTURE },
    ];
    let issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'events.0.entityIds.0')).toBe(true);

    const datasetForEvidence = validDataset();
    datasetForEvidence.evidence = [{ ...first(datasetForEvidence.evidence), observedAt: FUTURE }];
    issues = findTemporalIntegrityViolations(datasetForEvidence);
    expect(issues.some((i) => i.path === 'events.0.evidenceIds.0')).toBe(true);
  });

  it('flags a question citing an entity or hypothesis not yet knowable', () => {
    // question.relatedEntityIds cites 'entity-walter-tosto', the second entity in
    // validDataset() — mutate it specifically, preserving the first.
    const dataset = validDataset();
    dataset.entities = [
      first(dataset.entities),
      { ...nth(dataset.entities, 1), recordedAt: FUTURE },
    ];
    let issues = findTemporalIntegrityViolations(dataset);
    expect(issues.some((i) => i.path === 'questions.0.relatedEntityIds.0')).toBe(true);

    const datasetForHypothesis = validDataset();
    datasetForHypothesis.hypotheses = [
      { ...first(datasetForHypothesis.hypotheses), createdAt: FUTURE },
    ];
    issues = findTemporalIntegrityViolations(datasetForHypothesis);
    expect(issues.some((i) => i.path === 'questions.0.relatedHypothesisIds.0')).toBe(true);
  });

  it('does not flag a reference whose target has the exact same timestamp (boundary is inclusive)', () => {
    // validDataset() already exercises this throughout (everything shares 2026-01-01T00:00:00Z);
    // this test makes the boundary case explicit rather than incidental.
    const dataset = validDataset();
    expect(findTemporalIntegrityViolations(dataset)).toEqual([]);
  });

  it('is included in validateResearchDataset, so a structurally-valid-but-temporally-inconsistent dataset is rejected', () => {
    const dataset = validDataset();
    dataset.evidence = [{ ...first(dataset.evidence), observedAt: FUTURE }];
    const result = validateResearchDataset(dataset);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'temporal-integrity-violation')).toBe(true);
    }
  });
});
