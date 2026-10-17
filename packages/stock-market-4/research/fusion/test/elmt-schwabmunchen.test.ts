import { describe, expect, it } from 'vitest';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '../src/index.js';

/**
 * Acceptance-criteria checks for the ELMT / Schwabmünchen research-graph addition (a separate
 * task from the original fusion fixture ingestion). See test/fixture.test.ts,
 * test/temporal.test.ts, and test/information-leak.test.ts for the broader fixture's own
 * coverage — this file targets only what's specific to this addition.
 */
describe('ELMT / Schwabmünchen: entities', () => {
  const dataset = createFusionFixtureDataset();
  const entityById = new Map(dataset.entities.map((e) => [e.id, e]));

  it('represents ELMT, Schwabmünchen, and the acquisition as distinct entities', () => {
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.elmt)?.type).toBe('company');
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.schwabmunchenMetalOperations)?.type).toBe(
      'manufacturing_facility',
    );
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.elmtSchwabmunchenAcquisition)?.type).toBe(
      'acquisition',
    );
  });

  it('represents the materials lab, workforce, and customer base as distinct entities', () => {
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.schwabmunchenMaterialsLab)?.type).toBe(
      'materials_laboratory',
    );
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.schwabmunchenWorkforce)?.type).toBe(
      'workforce',
    );
    expect(entityById.get(FUSION_FIXTURE_IDS.entities.schwabmunchenCustomerBase)?.type).toBe(
      'customer_base',
    );
  });

  it('represents the acquisition dates and transaction structure, with purchase consideration formula-defined and UNKNOWN', () => {
    const acquisition = entityById.get(FUSION_FIXTURE_IDS.entities.elmtSchwabmunchenAcquisition);
    expect(acquisition?.metadata?.agreementDate).toBe('2026-09-03');
    expect(acquisition?.metadata?.announcementDate).toBe('2026-09-08');
    expect(acquisition?.metadata?.expectedClose).toBe('Q1 2027');
    expect(acquisition?.metadata?.transactionType).toBe('asset purchase');
    expect(acquisition?.metadata?.purchaseConsideration).toEqual({
      status: 'formula_defined',
      finalConsideration: 'UNKNOWN',
    });
  });

  it('represents the ~157-employee figure as historical/transaction-specific, not current', () => {
    const workforce = entityById.get(FUSION_FIXTURE_IDS.entities.schwabmunchenWorkforce);
    expect(workforce?.metadata?.employeeCountAtTransaction).toBe(157);
    expect(workforce?.description).toContain('not the current or permanent workforce');
  });

  it('represents all ten manufacturing capabilities as individual entities', () => {
    const capabilityKeys = [
      'capPowderFormation',
      'capPressing',
      'capSintering',
      'capSwaging',
      'capWireDrawing',
      'capFinishing',
      'capMachining',
      'capPowderInjectionMolding',
      'capChemicalMaterialAnalysis',
      'capPhysicalMaterialAnalysis',
    ] as const;
    for (const key of capabilityKeys) {
      expect(entityById.has(FUSION_FIXTURE_IDS.entities[key])).toBe(true);
    }
  });

  it('represents tungsten and molybdenum product categories, including pure/K-doped tungsten compositions', () => {
    const productKeys = [
      'tungstenPowder',
      'tungstenRod',
      'tungstenPin',
      'tungstenHeavyWire',
      'tungstenFineWire',
      'tungstenElectrode',
      'tungstenMachinedComponent',
      'tungstenPimComponent',
      'pureTungsten',
      'kDopedTungsten',
      'molybdenumPowder',
      'molybdenumRod',
      'molybdenumWire',
      'molybdenumComponent',
    ] as const;
    for (const key of productKeys) {
      expect(entityById.has(FUSION_FIXTURE_IDS.entities[key])).toBe(true);
    }
  });

  it('represents TZM and tungsten heavy alloy as entities distinct from current products', () => {
    expect(entityById.has(FUSION_FIXTURE_IDS.entities.tzm)).toBe(true);
    expect(entityById.has(FUSION_FIXTURE_IDS.entities.tungstenHeavyAlloy)).toBe(true);
  });
});

describe('ELMT / Schwabmünchen: planned vs. current capability (spec §7/Rule 5)', () => {
  const dataset = createFusionFixtureDataset();

  it('represents TZM and tungsten heavy alloy expansion as planned, not a current manufacturing relationship', () => {
    const tzmRelationship = dataset.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.schwabmunchenPlansToProduceTzm,
    );
    const alloyRelationship = dataset.relationships.find(
      (r) =>
        r.id === FUSION_FIXTURE_IDS.relationships.schwabmunchenPlansToProduceTungstenHeavyAlloy,
    );
    for (const relationship of [tzmRelationship, alloyRelationship]) {
      expect(relationship?.states[0]?.status).toBe('planned');
      expect(relationship?.states[0]?.metadata?.notCurrentCapability).toBe(true);
    }
  });

  it('does not create a "manufactures" relationship from Schwabmünchen to TZM or tungsten heavy alloy', () => {
    const manufacturesTzmOrAlloy = dataset.relationships.find(
      (r) =>
        r.type === 'manufactures' &&
        r.fromEntityId === FUSION_FIXTURE_IDS.entities.schwabmunchenMetalOperations &&
        (r.toEntityId === FUSION_FIXTURE_IDS.entities.tzm ||
          r.toEntityId === FUSION_FIXTURE_IDS.entities.tungstenHeavyAlloy),
    );
    expect(manufacturesTzmOrAlloy).toBeUndefined();
  });
});

describe('ELMT / Schwabmünchen: capability ≠ qualification (spec §11/Rule 2)', () => {
  const dataset = createFusionFixtureDataset();
  const FUSION_PROGRAMS = [
    'iter',
    'demo',
    'eurofusion',
    'dtt',
    'step',
    'sparc',
    'arc',
    'cfs',
    'other',
  ];

  it('initializes fusion customer relationships as UNKNOWN/confidence 0 for every tracked program', () => {
    for (const suffix of FUSION_PROGRAMS) {
      const relationship = dataset.relationships.find(
        (r) => r.id === `rel-schwabmunchen-potential-fusion-customer-${suffix}`,
      );
      expect(relationship, `missing customer relationship for ${suffix}`).toBeDefined();
      expect(relationship?.states).toHaveLength(1);
      expect(relationship?.states[0]?.status).toBe('UNKNOWN');
      expect(relationship?.states[0]?.confidence?.value).toBe(0);
      expect(relationship?.states[0]?.evidenceIds).toEqual([]);
    }
  });

  it('initializes fusion qualification independently from customer relationships, also UNKNOWN/confidence 0', () => {
    for (const suffix of FUSION_PROGRAMS) {
      const relationship = dataset.relationships.find(
        (r) => r.id === `rel-schwabmunchen-fusion-qualification-${suffix}`,
      );
      expect(relationship, `missing qualification relationship for ${suffix}`).toBeDefined();
      expect(relationship?.type).toBe('fusion_qualification');
      expect(relationship?.states[0]?.status).toBe('UNKNOWN');
      expect(relationship?.states[0]?.confidence?.value).toBe(0);
    }
  });

  it('does not infer a fusion supplier relationship merely because ELMT manufactures tungsten', () => {
    const elmtManufacturesTungsten = dataset.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.elmtManufacturesTungsten,
    );
    expect(elmtManufacturesTungsten).toBeDefined();
    // Manufacturing tungsten and having fusion customer relationships are tracked as entirely
    // separate relationship types — the former existing does not upgrade the latter's status.
    const anyFusionCustomerRelationshipNotUnknown = dataset.relationships.some(
      (r) => r.type === 'potential_fusion_customer' && r.states[0]?.status !== 'UNKNOWN',
    );
    expect(anyFusionCustomerRelationshipNotUnknown).toBe(false);
  });

  it('keeps the historical fusion-research-experience relationship distinct from qualification/commercial-supply status', () => {
    const relationship = dataset.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.schwabmunchenHasHistoricalFusionExperience,
    );
    expect(relationship?.states[0]?.status).toBe('documented');
    expect(relationship?.states[0]?.metadata?.commercialSupplyStatus).toBe('unknown');
    expect(relationship?.states[0]?.metadata?.qualificationStatus).toBe('unknown');
  });
});

describe('ELMT / Schwabmünchen: research questions (spec §17)', () => {
  const dataset = createFusionFixtureDataset();
  const elmtQuestions = dataset.questions.filter((q) => q.code?.startsWith('RQ-ELMT-'));

  it('adds all 36 research questions, each open with a unique code', () => {
    expect(elmtQuestions).toHaveLength(36);
    const codes = new Set(elmtQuestions.map((q) => q.code));
    expect(codes.size).toBe(36);
    expect(elmtQuestions.every((q) => q.status === 'open')).toBe(true);
  });

  it('includes the specific questions named in the source task, each with a related entity', () => {
    const byCode = new Map(elmtQuestions.map((q) => [q.code, q]));
    expect(byCode.get('RQ-ELMT-001')?.question).toContain('historical revenue');
    expect(byCode.get('RQ-ELMT-027')?.question).toContain('final economic purchase consideration');
    expect(byCode.get('RQ-ELMT-011')?.relatedEntityIds).toContain(FUSION_FIXTURE_IDS.entities.iter);
    for (const question of elmtQuestions) {
      expect(question.relatedEntityIds?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('ELMT / Schwabmünchen: hypotheses (spec §18)', () => {
  const dataset = createFusionFixtureDataset();
  const byName = new Map(dataset.hypotheses.map((h) => [h.name, h]));

  it('records each H-ELMT hypothesis at its specified initial confidence, with supporting evidence', () => {
    const expected: [string, number][] = [
      ['H-ELMT-001', 0.8],
      ['H-ELMT-002', 0.85],
      ['H-ELMT-003', 0.9],
      ['H-ELMT-004', 0.75],
      ['H-ELMT-005', 0.6],
      ['H-ELMT-006', 0.4],
      ['H-ELMT-007', 0.7],
      ['H-ELMT-008', 0.3],
    ];
    for (const [name, confidence] of expected) {
      const hypothesis = byName.get(name);
      expect(hypothesis, `missing hypothesis ${name}`).toBeDefined();
      expect(hypothesis?.assessments[0]?.confidence.value).toBe(confidence);
      expect(hypothesis?.assessments[0]?.supportingEvidenceIds.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('explicitly labels H-ELMT-005 as an inference and H-ELMT-006/008 as conservative/speculative', () => {
    expect(byName.get('H-ELMT-005')?.assessments[0]?.rationale).toContain('inference');
    expect(byName.get('H-ELMT-006')?.assessments[0]?.rationale).toContain('conservative');
    expect(byName.get('H-ELMT-008')?.assessments[0]?.rationale).toContain('speculative');
  });
});

describe('ELMT / Schwabmünchen: evidence (spec §19)', () => {
  const dataset = createFusionFixtureDataset();
  const evidenceById = new Map(dataset.evidence.map((e) => [e.id, e]));

  it('attaches the asset purchase agreement evidence with the purchase-price-formula caveat', () => {
    const apa = evidenceById.get(FUSION_FIXTURE_IDS.evidence.elmtSchwabmunchenApa);
    expect(apa?.description).toContain('negative EUR 18M');
    expect(apa?.description).toContain('UNKNOWN until closing');
  });

  it("attaches the fusion-research-publication evidence with the 'does not establish commercial supply' caveat", () => {
    const publication = evidenceById.get(
      FUSION_FIXTURE_IDS.evidence.schwabmunchenFusionResearchPublication,
    );
    expect(publication?.description).toContain('does NOT establish commercial fusion supply');
  });

  it('does not attribute Schwabmünchen financial results to ELMT (Rule 4)', () => {
    const elmtFinancials = evidenceById.get(FUSION_FIXTURE_IDS.evidence.elmtFinancials);
    // The financials evidence predates the acquisition announcement's own scope and only ever
    // cites ELMT itself, never the newly-added Schwabmünchen entity.
    expect(elmtFinancials?.entityIds).not.toContain(
      FUSION_FIXTURE_IDS.entities.schwabmunchenMetalOperations,
    );
  });
});
