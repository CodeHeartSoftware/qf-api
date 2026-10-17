import { describe, expect, it } from 'vitest';
import type { ExposureMap, ResearchState } from '@quant-fusion/quant-sdk-js';
import { applyRelationshipTypeCategories, findMatchingEntity } from '../src/lib/quantAnalysis.js';
import type { RelationshipTypeCategory } from '../src/lib/researchStore.js';

interface FakeEntity {
  id: string;
  name: string;
}

const ENTITIES: FakeEntity[] = [
  { id: 'entity-almonty', name: 'Almonty' },
  { id: 'entity-fujikura', name: 'Fujikura' },
  { id: 'entity-sumitomo', name: 'Sumitomo' },
  { id: 'entity-amsc', name: 'AMSC' },
  { id: 'entity-elmt', name: 'ELMT' },
];

describe('findMatchingEntity', () => {
  it('matches an exact name (case/whitespace-insensitive)', () => {
    expect(findMatchingEntity(ENTITIES, '  elmt  ', 'ELMT')?.id).toBe('entity-elmt');
  });

  it('matches when the entity name is a leading-word prefix of the company name (real ALM/FUJIKURA/SUMITOMO gap)', () => {
    expect(findMatchingEntity(ENTITIES, 'Almonty Industries', 'ALM')?.id).toBe('entity-almonty');
    expect(findMatchingEntity(ENTITIES, 'Fujikura Ltd.', 'FUJIKURA')?.id).toBe('entity-fujikura');
    expect(findMatchingEntity(ENTITIES, 'Sumitomo Electric', 'SUMITOMO')?.id).toBe(
      'entity-sumitomo',
    );
  });

  it('matches when the company name is a leading-word prefix of the (longer) entity name', () => {
    const entities: FakeEntity[] = [{ id: 'entity-foo', name: 'Foo Bar Corp' }];
    expect(findMatchingEntity(entities, 'Foo', 'FOO')?.id).toBe('entity-foo');
  });

  it('falls back to the ticker symbol when the company name shares no text with the entity name (real AMSC gap)', () => {
    expect(findMatchingEntity(ENTITIES, 'American Superconductor', 'AMSC')?.id).toBe('entity-amsc');
  });

  it('returns undefined when nothing matches', () => {
    expect(findMatchingEntity(ENTITIES, 'Totally Unrelated Co', 'ZZZZ')).toBeUndefined();
  });

  it('never matches on an empty entity name', () => {
    const entities: FakeEntity[] = [{ id: 'entity-blank', name: '' }];
    expect(findMatchingEntity(entities, 'Something', 'SOMETHING')).toBeUndefined();
  });

  it('matches a "/"-joined merged entity name via either half (real Sumitomo/A.L.M.T. gap)', () => {
    const entities: FakeEntity[] = [{ id: 'entity-sumitomo', name: 'Sumitomo/A.L.M.T' }];
    // The prefix rule via the "Sumitomo" half — this is the exact scenario that broke once
    // entity-almt was merged into entity-sumitomo's name (see research-store's own
    // 0062_delete_entities_entity-almt migration): before the merge this ticker matched fine via
    // "Sumitomo" being a leading-word prefix of "Sumitomo Electric".
    expect(findMatchingEntity(entities, 'Sumitomo Electric', 'SUMITOMO')?.id).toBe(
      'entity-sumitomo',
    );
    // An exact match via the "A.L.M.T" half, not just a prefix.
    expect(findMatchingEntity(entities, 'A.L.M.T', 'ALMT')?.id).toBe('entity-sumitomo');
    // The whole, unsplit name still matches too.
    expect(findMatchingEntity(entities, 'Sumitomo/A.L.M.T', 'SUMITOMO')?.id).toBe(
      'entity-sumitomo',
    );
  });
});

function fakeState(overrides: Partial<ResearchState>): ResearchState {
  return {
    timestamp: '2026-09-20T00:00:00Z',
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
    ...overrides,
  };
}

function fakeExposure(overrides: Partial<ExposureMap>): ExposureMap {
  return {
    targetEntityId: 'entity-a',
    architecture: [],
    material: [],
    component: [],
    manufacturing: [],
    bottleneck: [],
    qualification: [],
    contract: [],
    program: [],
    ...overrides,
  };
}

function relationshipFrom(
  toEntityId: string,
  type: string,
  confidence?: number,
): ResearchState['relationships'][number] {
  return {
    id: `rel-entity-a-${toEntityId}`,
    type,
    fromEntityId: 'entity-a',
    toEntityId,
    states: [
      {
        status: 'active',
        recordedAt: '2026-01-01T00:00:00Z',
        effectiveFrom: '2026-01-01T00:00:00Z',
        evidenceIds: [],
        ...(confidence !== undefined ? { confidence: { value: confidence } } : {}),
      },
    ],
  };
}

describe('applyRelationshipTypeCategories', () => {
  it('returns the same object, untouched, when there are no category overrides', () => {
    const exposure = fakeExposure({ program: [{ id: 'entity-b', name: 'B', weight: 1 }] });
    const state = fakeState({});
    const result = applyRelationshipTypeCategories(exposure, state, 'entity-a', new Map());
    expect(result).toBe(exposure);
  });

  it('adds a relationship type with no natural classification to its overridden category', () => {
    const exposure = fakeExposure({});
    const state = fakeState({
      entities: [
        { id: 'entity-b', type: 'company', name: 'B', recordedAt: '2026-01-01T00:00:00Z' },
      ],
      relationships: [relationshipFrom('entity-b', 'customer_contract', 0.9)],
    });
    const categoryByType = new Map<string, RelationshipTypeCategory>([
      ['customer_contract', 'contract'],
    ]);

    const result = applyRelationshipTypeCategories(exposure, state, 'entity-a', categoryByType);
    expect(result.contract).toEqual([{ id: 'entity-b', name: 'B', weight: 0.9 }]);
    expect(result.program).toEqual([]);
  });

  it('moves an entry OUT of wherever it was naturally classified when overridden elsewhere', () => {
    // Simulates computeExposureMap having already bucketed this relationship into "program"
    // (its status text didn't say "contract") before the override is applied.
    const exposure = fakeExposure({ program: [{ id: 'entity-b', name: 'B', weight: 0.9 }] });
    const state = fakeState({
      entities: [
        { id: 'entity-b', type: 'company', name: 'B', recordedAt: '2026-01-01T00:00:00Z' },
      ],
      relationships: [relationshipFrom('entity-b', 'customer_contract', 0.9)],
    });
    const categoryByType = new Map<string, RelationshipTypeCategory>([
      ['customer_contract', 'contract'],
    ]);

    const result = applyRelationshipTypeCategories(exposure, state, 'entity-a', categoryByType);
    expect(result.contract).toEqual([{ id: 'entity-b', name: 'B', weight: 0.9 }]);
    expect(result.program).toEqual([]);
  });

  it('leaves relationship types with no override exactly where they already were', () => {
    const exposure = fakeExposure({ manufacturing: [{ id: 'entity-c', name: 'C', weight: 1 }] });
    const state = fakeState({
      relationships: [relationshipFrom('entity-c', 'manufactures', 1)],
    });
    const result = applyRelationshipTypeCategories(
      exposure,
      state,
      'entity-a',
      new Map([['some-other-type', 'contract']]),
    );
    expect(result.manufacturing).toEqual([{ id: 'entity-c', name: 'C', weight: 1 }]);
  });

  it('ignores a relationship whose type is overridden but points TO the target, not FROM it', () => {
    const exposure = fakeExposure({});
    const state = fakeState({
      relationships: [
        {
          id: 'rel-b-a',
          type: 'customer_contract',
          fromEntityId: 'entity-b',
          toEntityId: 'entity-a',
          states: [
            {
              status: 'active',
              recordedAt: '2026-01-01T00:00:00Z',
              effectiveFrom: '2026-01-01T00:00:00Z',
              evidenceIds: [],
              confidence: { value: 0.9 },
            },
          ],
        },
      ],
    });
    const result = applyRelationshipTypeCategories(
      exposure,
      state,
      'entity-a',
      new Map([['customer_contract', 'contract']]),
    );
    expect(result.contract).toEqual([]);
  });

  it('defaults weight to 1 when a state has no confidence recorded', () => {
    const exposure = fakeExposure({});
    const state = fakeState({
      relationships: [relationshipFrom('entity-b', 'customer_contract')],
    });
    const result = applyRelationshipTypeCategories(
      exposure,
      state,
      'entity-a',
      new Map([['customer_contract', 'contract']]),
    );
    expect(result.contract).toEqual([{ id: 'entity-b', name: 'entity-b', weight: 1 }]);
  });

  it('never mutates the original exposure object', () => {
    const exposure = fakeExposure({ program: [{ id: 'entity-b', name: 'B', weight: 0.9 }] });
    const state = fakeState({
      relationships: [relationshipFrom('entity-b', 'customer_contract', 0.9)],
    });
    applyRelationshipTypeCategories(
      exposure,
      state,
      'entity-a',
      new Map([['customer_contract', 'contract']]),
    );
    expect(exposure.program).toEqual([{ id: 'entity-b', name: 'B', weight: 0.9 }]);
    expect(exposure.contract).toEqual([]);
  });
});
