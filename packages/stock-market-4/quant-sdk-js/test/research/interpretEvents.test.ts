import { describe, expect, it } from 'vitest';
import { computeResearchDelta } from '../../src/research/delta.js';
import { interpretResearchDelta } from '../../src/research/interpretEvents.js';
import type { ResearchState } from '../../src/research/types.js';

const TARGET = 'entity-target';
const ACQUIRED = 'entity-acquired';
const ARC = 'entity-arc';
const TRACKED = new Set([TARGET, ACQUIRED]);

function baseState(timestamp: string): ResearchState {
  return {
    timestamp,
    entities: [
      { id: TARGET, type: 'company', name: 'Target Co', recordedAt: timestamp },
      { id: ACQUIRED, type: 'company', name: 'Acquired Co', recordedAt: timestamp },
      { id: ARC, type: 'reactor', name: 'ARC', recordedAt: timestamp },
    ],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

describe('interpretResearchDelta — acquisition handling', () => {
  it('produces a positive manufacturing_capability effect for a new acquires relationship', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-acquires',
          type: 'acquires',
          fromEntityId: TARGET,
          toEntityId: ACQUIRED,
          states: [
            {
              status: 'agreement_signed',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 0.9 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    const capability = effects.find((e) => e.factor === 'manufacturing_capability');
    expect(capability).toBeDefined();
    expect(capability?.direction).toBe('positive');
    expect(capability?.magnitude).toBeCloseTo(0.9);
    expect(capability?.confidence).toBeCloseTo(0.9);
  });

  it('NEVER upgrades an UNKNOWN supplier/qualification/customer relationship into a positive effect just because capability increased (spec §5/§19)', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-acquires',
          type: 'acquires',
          fromEntityId: TARGET,
          toEntityId: ACQUIRED,
          states: [
            { status: 'agreement_signed', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] },
          ],
        },
        // The acquired entity ALSO manufactures the exact material ARC requires, AND ARC requires
        // it — but the supplier/qualification relationship itself is explicitly UNKNOWN. This is
        // the adversarial case: capability + demand must never be conflated into "supplies."
        {
          id: 'rel-manufactures',
          type: 'manufactures',
          fromEntityId: ACQUIRED,
          toEntityId: 'entity-tungsten',
          states: [{ status: 'active', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        {
          id: 'rel-arc-requires',
          type: 'requires',
          fromEntityId: ARC,
          toEntityId: 'entity-tungsten',
          states: [{ status: 'active', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        {
          id: 'rel-potential-customer',
          type: 'potential_fusion_customer',
          fromEntityId: ACQUIRED,
          toEntityId: ARC,
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
        {
          id: 'rel-qualification',
          type: 'fusion_qualification',
          fromEntityId: ACQUIRED,
          toEntityId: ARC,
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
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    const customerEffect = effects.find(
      (e) => e.factor === `relationship:potential_fusion_customer:${ARC}`,
    );
    const qualificationEffect = effects.find(
      (e) => e.factor === `relationship:fusion_qualification:${ARC}`,
    );

    expect(customerEffect?.direction).toBe('neutral');
    expect(customerEffect?.magnitude).toBe(0);
    expect(qualificationEffect?.direction).toBe('neutral');
    expect(qualificationEffect?.magnitude).toBe(0);

    // No effect anywhere claims the supplier relationship itself became positive.
    expect(
      effects.some(
        (e) => e.factor.includes('potential_fusion_customer') && e.direction === 'positive',
      ),
    ).toBe(false);
    expect(
      effects.some((e) => e.factor.includes('fusion_qualification') && e.direction === 'positive'),
    ).toBe(false);
  });

  it('produces no effects when the delta is empty', () => {
    const state = baseState('t1');
    const delta = computeResearchDelta(state, state);
    const effects = interpretResearchDelta(delta, state, TARGET, TRACKED);
    expect(effects).toEqual([]);
  });

  it('produces a positive hypothesis effect only for hypotheses that relate to the target entity via evidence', () => {
    const previous: ResearchState = {
      ...baseState('t1'),
      evidence: [
        {
          id: 'ev1',
          observedAt: 't1',
          source: { name: 's' },
          description: 'about target',
          entityIds: [TARGET],
        },
        {
          id: 'ev2',
          observedAt: 't1',
          source: { name: 's' },
          description: 'about arc',
          entityIds: [ARC],
        },
      ],
      hypotheses: [
        {
          id: 'h-target',
          name: 'Target hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't0',
              confidence: { value: 0.2 },
              supportingEvidenceIds: ['ev1'],
              contradictingEvidenceIds: [],
            },
          ],
        },
        {
          id: 'h-unrelated',
          name: 'Unrelated hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't0',
              confidence: { value: 0.2 },
              supportingEvidenceIds: ['ev2'],
              contradictingEvidenceIds: [],
            },
          ],
        },
      ],
    };
    const current: ResearchState = {
      ...previous,
      timestamp: 't2',
      hypotheses: previous.hypotheses.map((h) => ({
        ...h,
        assessments: [
          ...h.assessments,
          {
            timestamp: 't2',
            confidence: { value: 0.7 },
            supportingEvidenceIds: h.assessments[0]?.supportingEvidenceIds ?? [],
            contradictingEvidenceIds: [],
          },
        ],
      })),
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    expect(effects.some((e) => e.factor === 'hypothesis:Target hypothesis')).toBe(true);
    expect(effects.some((e) => e.factor === 'hypothesis:Unrelated hypothesis')).toBe(false);
  });
});

describe('interpretResearchDelta — ecosystem vs. portfolio scope', () => {
  const TRACKED_TARGET = 'entity-tracked-target';
  const TRACKED_COUNTERPARTY = 'entity-tracked-counterparty';
  const ECOSYSTEM_COUNTERPARTY = 'entity-ecosystem-counterparty'; // NOT in trackedEntityIds
  const TRACKED_SET = new Set([TRACKED_TARGET, TRACKED_COUNTERPARTY]);

  it('scopes a supplier_capture effect as "ecosystem" when the counterparty is not tracked', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-supply',
          type: 'supplies',
          fromEntityId: TRACKED_TARGET,
          toEntityId: ECOSYSTEM_COUNTERPARTY,
          states: [
            {
              status: 'production contract',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 0.9 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TRACKED_TARGET, TRACKED_SET);

    expect(effects.find((e) => e.factor === 'supplier_capture')?.scope).toBe('ecosystem');
  });

  it('scopes a supplier_capture effect as "portfolio" when the counterparty is ALSO tracked', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-supply-2',
          type: 'supplies',
          fromEntityId: TRACKED_TARGET,
          toEntityId: TRACKED_COUNTERPARTY,
          states: [
            {
              status: 'production contract',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 0.9 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TRACKED_TARGET, TRACKED_SET);

    expect(effects.find((e) => e.factor === 'supplier_capture')?.scope).toBe('portfolio');
  });

  it("scopes a hypothesis effect by its supporting evidence's entities, not just the target", () => {
    const previous: ResearchState = {
      ...baseState('t1'),
      evidence: [
        {
          id: 'ev-ecosystem',
          observedAt: 't1',
          source: { name: 's' },
          description: 'about target and an untracked counterparty',
          entityIds: [TRACKED_TARGET, ECOSYSTEM_COUNTERPARTY],
        },
        {
          id: 'ev-portfolio',
          observedAt: 't1',
          source: { name: 's' },
          description: 'about two tracked companies only',
          entityIds: [TRACKED_TARGET, TRACKED_COUNTERPARTY],
        },
      ],
      hypotheses: [
        {
          id: 'h-ecosystem',
          name: 'Ecosystem-grounded hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't0',
              confidence: { value: 0.2 },
              supportingEvidenceIds: ['ev-ecosystem'],
              contradictingEvidenceIds: [],
            },
          ],
        },
        {
          id: 'h-portfolio',
          name: 'Portfolio-only hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            {
              timestamp: 't0',
              confidence: { value: 0.2 },
              supportingEvidenceIds: ['ev-portfolio'],
              contradictingEvidenceIds: [],
            },
          ],
        },
      ],
    };
    const current: ResearchState = {
      ...previous,
      timestamp: 't2',
      hypotheses: previous.hypotheses.map((h) => ({
        ...h,
        assessments: [
          ...h.assessments,
          {
            timestamp: 't2',
            confidence: { value: 0.7 },
            supportingEvidenceIds: h.assessments[0]?.supportingEvidenceIds ?? [],
            contradictingEvidenceIds: [],
          },
        ],
      })),
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TRACKED_TARGET, TRACKED_SET);

    expect(
      effects.find((e) => e.factor === 'hypothesis:Ecosystem-grounded hypothesis')?.scope,
    ).toBe('ecosystem');
    expect(effects.find((e) => e.factor === 'hypothesis:Portfolio-only hypothesis')?.scope).toBe(
      'portfolio',
    );
  });
});

describe('interpretResearchDelta — supplier-capture handling', () => {
  it('produces a positive supplier_capture effect for a NEW qualification relationship FROM the target', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-qual',
          type: 'fusion_qualification',
          fromEntityId: TARGET,
          toEntityId: ARC,
          states: [
            {
              status: 'qualified',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 0.8 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    const captureEffect = effects.find((e) => e.factor === 'supplier_capture');
    expect(captureEffect).toBeDefined();
    expect(captureEffect?.direction).toBe('positive');
    expect(captureEffect?.magnitude).toBeCloseTo(0.8);
  });

  it('produces a supplier_capture effect for a STATUS TRANSITION (qualification track -> production contract)', () => {
    const previousRelationship = {
      id: 'rel-supply',
      type: 'supplies',
      fromEntityId: TARGET,
      toEntityId: ARC,
      states: [
        { status: 'qualification track', recordedAt: 't1', effectiveFrom: 't1', evidenceIds: [] },
      ],
    };
    const previous: ResearchState = { ...baseState('t1'), relationships: [previousRelationship] };
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          ...previousRelationship,
          states: [
            ...previousRelationship.states,
            {
              status: 'production contract',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 1 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    const captureEffect = effects.find((e) => e.factor === 'supplier_capture');
    expect(captureEffect).toBeDefined();
    expect(captureEffect?.rationale).toContain('qualification track');
    expect(captureEffect?.rationale).toContain('production contract');
  });

  it('does NOT produce a supplier_capture effect for a relationship FROM another entity, or an acquisition (already its own factor)', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-other',
          type: 'supplies',
          fromEntityId: ACQUIRED, // not TARGET
          toEntityId: ARC,
          states: [{ status: 'qualified', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        {
          id: 'rel-acq',
          type: 'acquires',
          fromEntityId: TARGET,
          toEntityId: ACQUIRED,
          states: [
            { status: 'agreement_signed', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET, TRACKED);

    expect(effects.some((e) => e.factor === 'supplier_capture')).toBe(false);
    expect(effects.some((e) => e.factor === 'manufacturing_capability')).toBe(true);
  });
});
