import { describe, expect, it } from 'vitest';
import { parseResearchDataset, type ResearchDataset } from '../../src/dataset/dataset.js';

/**
 * Deliberately exercises variety that could plausibly trip up a naive serializer: nested
 * objects (relationship states, hypothesis assessments, model calculations), a `Quantity` with
 * an attached `Uncertainty`, optional fields present AND absent, a scenario's `variableOverrides`
 * record, and a metadata record.
 */
function richDataset(): ResearchDataset {
  return {
    id: 'dataset-roundtrip-fixture',
    name: 'Round-trip fixture',
    version: '1.0.0',
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
      {
        id: 'entity-walter-tosto',
        type: 'company',
        name: 'Walter Tosto',
        description: 'Italian pressure-vessel fabricator.',
        validFrom: '2020-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        metadata: { country: 'Italy', tags: ['fabrication', 'vacuum-vessel'] },
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
            status: 'tested',
            recordedAt: '2025-01-01T00:00:00Z',
            effectiveFrom: '2024-01-01T00:00:00Z',
            effectiveTo: '2025-01-01T00:00:00Z',
            evidenceIds: ['evidence-1'],
            confidence: { value: 0.7, basis: 'press release' },
          },
          {
            status: 'qualified',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2025-01-01T00:00:00Z',
            evidenceIds: ['evidence-1'],
          },
        ],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        observedAt: '2025-06-01T00:00:00Z',
        publishedAt: '2025-05-15T00:00:00Z',
        availableAt: '2025-05-15T00:00:00Z',
        source: { name: 'Walter Tosto press release', uri: 'https://example.com/wt' },
        description: 'Walter Tosto reported vacuum-vessel qualification work for SPARC.',
        entityIds: ['entity-walter-tosto', 'entity-arc'],
      },
    ],
    assertions: [
      {
        id: 'assertion-1',
        statement: 'Supplier qualification does not imply commercial procurement.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        confidence: { value: 0.85 },
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
            timestamp: '2026-12-31T23:59:59Z',
            confidence: { value: 0.94 },
            supportingEvidenceIds: ['evidence-1'],
            contradictingEvidenceIds: [],
            rationale: 'Only one qualified vessel supplier to date.',
          },
        ],
        falsifiers: [
          { description: 'A second supplier qualifies within 3 years.', evidenceIds: [] },
        ],
      },
    ],
    assumptions: [
      {
        id: 'assumption-tritium-price',
        name: 'Tritium market price',
        description: 'Assumed constant tritium price for the base-case revenue model.',
        value: { value: 30000, unit: 'USD/kg' },
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    variables: [
      {
        id: 'variable-tungsten-mass',
        name: 'ARC first-wall tungsten mass',
        value: {
          value: 24.7,
          unit: 'tonnes',
          uncertainty: {
            type: 'qualitative',
            description: 'derived, approximate, proxy — not an official BOM',
          },
        },
        origin: 'derived',
        confidence: { value: 0.5 },
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'variable-reactor-count',
        name: 'Reactors deployed',
        value: 1,
        origin: 'observed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    models: [
      {
        id: 'model-fusion-revenue',
        name: 'Fusion Revenue Model',
        description: 'Revenue = Reactors × Content × Share × Replacements',
        variableIds: ['variable-tungsten-mass', 'variable-reactor-count'],
        assumptionIds: ['assumption-tritium-price'],
        calculations: [
          {
            id: 'calc-fusion-revenue',
            name: 'Fusion Revenue',
            formula: 'Revenue = Reactors × Content × Share × Replacements',
            inputVariableIds: ['variable-reactor-count'],
            outputVariableId: 'variable-tungsten-mass',
            assumptionIds: ['assumption-tritium-price'],
          },
        ],
        outputVariableIds: ['variable-tungsten-mass'],
        createdAt: '2026-01-01T00:00:00Z',
        evidenceIds: ['evidence-1'],
      },
    ],
    scenarios: [
      {
        id: 'scenario-high-demand',
        name: 'High-demand / constrained tritium',
        assumptionIds: ['assumption-tritium-price'],
        variableOverrides: { 'variable-tungsten-mass': { value: 30, unit: 'tonnes' } },
        eventIds: [],
        probability: 0.2,
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],
    events: [
      {
        id: 'event-qualified',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'SUPPLIER_QUALIFIED',
        entityIds: ['entity-walter-tosto'],
        payload: { component: 'vacuum vessel' },
        evidenceIds: ['evidence-1'],
      },
    ],
    questions: [
      {
        id: 'question-1',
        code: 'RQ-001',
        question: 'What is the annual tungsten production capacity of the Walter Tosto facility?',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        relatedEntityIds: ['entity-walter-tosto'],
      },
    ],
    metadata: { curator: 'research-core fixture', tags: ['fusion', 'roundtrip'] },
  };
}

describe('ResearchDataset JSON round-trip', () => {
  it('preserves semantic equality through JSON.stringify -> JSON.parse -> parseResearchDataset', () => {
    const dataset = richDataset();
    const roundTripped: unknown = JSON.parse(JSON.stringify(dataset));
    const result = parseResearchDataset(roundTripped);
    expect(result).toEqual({ ok: true, value: dataset });
  });

  it('does not lose numeric precision (e.g. quantity values)', () => {
    const dataset = richDataset();
    const roundTripped = JSON.parse(JSON.stringify(dataset)) as ResearchDataset;
    expect(roundTripped.variables[0]?.value).toEqual({
      value: 24.7,
      unit: 'tonnes',
      uncertainty: {
        type: 'qualitative',
        description: 'derived, approximate, proxy — not an official BOM',
      },
    });
  });

  it('is deterministic: two independently-built, semantically-equal datasets serialize identically', () => {
    expect(JSON.stringify(richDataset())).toBe(JSON.stringify(richDataset()));
  });

  it('normalizes key order after parsing: the same fields given in a different order produce identical serialized output', () => {
    const original = richDataset();
    const reordered = {
      metadata: original.metadata,
      questions: original.questions,
      events: original.events,
      scenarios: original.scenarios,
      models: original.models,
      variables: original.variables,
      assumptions: original.assumptions,
      hypotheses: original.hypotheses,
      assertions: original.assertions,
      evidence: original.evidence,
      relationships: original.relationships,
      entities: original.entities,
      createdAt: original.createdAt,
      domain: original.domain,
      version: original.version,
      name: original.name,
      id: original.id,
    };

    const parsedOriginal = parseResearchDataset(original);
    const parsedReordered = parseResearchDataset(reordered);
    expect(parsedOriginal.ok).toBe(true);
    expect(parsedReordered.ok).toBe(true);
    expect(JSON.stringify(parsedOriginal)).toBe(JSON.stringify(parsedReordered));
  });

  it('preserves metadata key order as given, rather than sorting it (records are not shape-normalized)', () => {
    const dataset = richDataset();
    const roundTripped = JSON.parse(JSON.stringify(dataset)) as ResearchDataset;
    expect(Object.keys(roundTripped.metadata ?? {})).toEqual(Object.keys(dataset.metadata ?? {}));
  });
});
