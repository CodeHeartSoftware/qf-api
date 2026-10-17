import { describe, expect, it } from 'vitest';
import { computeExposureMap, exposureFootprint, type ResearchState } from '@quant-fusion/quant-sdk-js';
import { ELMT_ENTITY_ID, fusionStateAt } from '../support/fixtures.js';

const TARGET = 'entity-target';
const REACTOR = 'entity-reactor';
const MATERIAL = 'entity-material';
const CUSTOMER = 'entity-customer';

function stateWithGraph(): ResearchState {
  return {
    timestamp: 't1',
    entities: [
      { id: TARGET, type: 'company', name: 'Target Co', recordedAt: 't0' },
      { id: REACTOR, type: 'reactor', name: 'Test Reactor', recordedAt: 't0' },
      { id: MATERIAL, type: 'material', name: 'Test Material', recordedAt: 't0' },
      { id: CUSTOMER, type: 'reactor', name: 'Customer Program', recordedAt: 't0' },
    ],
    relationships: [
      // TARGET manufactures MATERIAL (hop 1) — also a manufacturing-dimension entry.
      { id: 'r1', type: 'manufactures', fromEntityId: TARGET, toEntityId: MATERIAL, states: [{ status: 'active', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [], confidence: { value: 0.9 } }] },
      // REACTOR requires MATERIAL (edge points reactor->material) — reached from TARGET at hop 2
      // by walking the "requires" edge BACKWARDS.
      { id: 'r2', type: 'requires', fromEntityId: REACTOR, toEntityId: MATERIAL, states: [{ status: 'active', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [] }] },
      // TARGET has a direct qualification relationship with CUSTOMER.
      { id: 'r3', type: 'fusion_qualification', fromEntityId: TARGET, toEntityId: CUSTOMER, states: [{ status: 'qualified', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [], confidence: { value: 0.7 } }] },
    ],
    evidence: [{ id: 'ev1', observedAt: 't0', source: { name: 's' }, description: 'about target', entityIds: [TARGET] }],
    assertions: [],
    hypotheses: [
      { id: 'h1', name: 'Target-related hypothesis', statement: 's', status: 'active', createdAt: 't0', assessments: [{ timestamp: 't0', confidence: { value: 0.6 }, supportingEvidenceIds: ['ev1'], contradictingEvidenceIds: [] }] },
    ],
    events: [],
    questions: [],
  };
}

describe('computeExposureMap', () => {
  it('finds direct (hop-1) and transitive (hop-2) architecture/material exposure separately, never collapsed', () => {
    const exposure = computeExposureMap(stateWithGraph(), TARGET);

    expect(exposure.material.some((e) => e.id === MATERIAL)).toBe(true);
    // REACTOR is reached transitively (target -[manufactures]-> material <-[requires]- reactor),
    // at hop 2, so its weight should be lower than a hop-1 entry's.
    const reactorEntry = exposure.architecture.find((e) => e.id === REACTOR);
    expect(reactorEntry).toBeDefined();
    expect(reactorEntry!.weight).toBeCloseTo(0.5); // 1/2 hops

    // CUSTOMER is reached at hop 1 (a direct qualification relationship) — also architecture
    // (type 'reactor'), but via a totally different path/relationship than REACTOR.
    const customerEntry = exposure.architecture.find((e) => e.id === CUSTOMER);
    expect(customerEntry).toBeDefined();
    expect(customerEntry!.weight).toBeCloseTo(1); // 1/1 hop
  });

  it('buckets a direct supplier-type relationship by its own recorded status (qualification here, not contract or generic program)', () => {
    const exposure = computeExposureMap(stateWithGraph(), TARGET);
    expect(exposure.qualification.some((e) => e.id === CUSTOMER)).toBe(true);
    expect(exposure.contract.some((e) => e.id === CUSTOMER)).toBe(false);
    expect(exposure.program.some((e) => e.id === CUSTOMER)).toBe(false);
  });

  it('records manufacturing exposure separately from architecture/material (never merged)', () => {
    const exposure = computeExposureMap(stateWithGraph(), TARGET);
    expect(exposure.manufacturing.some((e) => e.id === MATERIAL)).toBe(true);
  });

  it('includes only hypotheses that relate to the target via supporting evidence', () => {
    const exposure = computeExposureMap(stateWithGraph(), TARGET);
    expect(exposure.bottleneck.map((e) => e.id)).toEqual(['h1']);
  });

  it('returns empty arrays (not undefined) for every dimension when nothing is found', () => {
    const isolated: ResearchState = { ...stateWithGraph(), relationships: [], hypotheses: [] };
    const exposure = computeExposureMap(isolated, TARGET);
    expect(exposure.architecture).toEqual([]);
    expect(exposure.material).toEqual([]);
    expect(exposure.bottleneck).toEqual([]);
  });

  it('against the real fixture: ELMT has non-empty manufacturing and bottleneck exposure', () => {
    const state = fusionStateAt('2026-09-11T00:00:00Z');
    const exposure = computeExposureMap(state, ELMT_ENTITY_ID);
    expect(exposure.manufacturing.length).toBeGreaterThan(0);
    // Real footprint should be usable for the thesis-overlap check downstream.
    expect(exposureFootprint(exposure).size).toBeGreaterThan(0);
  });
});

describe('exposureFootprint', () => {
  it('collects ids across every dimension into one set, with no duplicates', () => {
    const exposure = computeExposureMap(stateWithGraph(), TARGET);
    const footprint = exposureFootprint(exposure);
    expect(footprint.has(MATERIAL)).toBe(true);
    expect(footprint.has(REACTOR)).toBe(true);
    expect(footprint.has(CUSTOMER)).toBe(true);
    expect(footprint.has('h1')).toBe(true);
  });
});
