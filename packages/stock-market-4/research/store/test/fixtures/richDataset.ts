import type { ResearchDataset } from '@quant-fusion/research-core';

/**
 * Adapted from `@quant-fusion/research-core`'s own
 * `test/serialization/dataset-roundtrip.test.ts` fixture — deliberately exercises variety that
 * could plausibly trip up a naive store: nested objects (relationship states, hypothesis
 * assessments, model calculations), a `Quantity` with an attached `Uncertainty`, optional fields
 * present AND absent, a scenario's `variableOverrides` record, and a dataset-level metadata
 * record.
 */
export function richDataset(id = 'dataset-roundtrip-fixture', version = '1.0.0'): ResearchDataset {
  return {
    id,
    name: 'Round-trip fixture',
    version,
    domain: 'fusion',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2020-01-01T00:00:00Z' },
      {
        id: 'entity-walter-tosto',
        type: 'company',
        name: 'Walter Tosto',
        description: 'Italian pressure-vessel fabricator.',
        validFrom: '2020-01-01T00:00:00Z',
        recordedAt: '2020-01-01T00:00:00Z',
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
        observedAt: '2024-06-01T00:00:00Z',
        publishedAt: '2024-05-15T00:00:00Z',
        availableAt: '2024-05-15T00:00:00Z',
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
