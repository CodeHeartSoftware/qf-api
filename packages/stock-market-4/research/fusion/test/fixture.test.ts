import { validateResearchDataset } from '@quant-fusion/research-core';
import { describe, expect, it } from 'vitest';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '../src/index.js';

describe('createFusionFixtureDataset', () => {
  it('validates cleanly against validateResearchDataset', () => {
    const result = validateResearchDataset(createFusionFixtureDataset());
    if (!result.ok) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
  });

  it('is deterministic: two independently-built fixtures are structurally identical', () => {
    expect(createFusionFixtureDataset()).toEqual(createFusionFixtureDataset());
  });

  it('round-trips through JSON with semantic equality', () => {
    const dataset = createFusionFixtureDataset();
    const roundTripped: unknown = JSON.parse(JSON.stringify(dataset));
    expect(validateResearchDataset(roundTripped)).toEqual({ ok: true, value: dataset });
  });

  it('includes every entity named in the spec (§37)', () => {
    const dataset = createFusionFixtureDataset();
    const names = dataset.entities.map((entity) => entity.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'ARC',
        'SPARC',
        'Commonwealth Fusion Systems',
        'ELMT',
        'Fujikura',
        'Walter Tosto',
        'Tungsten',
        'HTS',
        'Vacuum Vessel',
      ]),
    );
  });

  it("gives H032/H033/H034 a confidence history culminating at this package's stated baselines (spec §40)", () => {
    const dataset = createFusionFixtureDataset();
    const byId = new Map(dataset.hypotheses.map((h) => [h.id, h]));

    const h032 = byId.get(FUSION_FIXTURE_IDS.hypotheses.h032);
    const h033 = byId.get(FUSION_FIXTURE_IDS.hypotheses.h033);
    const h034 = byId.get(FUSION_FIXTURE_IDS.hypotheses.h034);

    expect(h032?.assessments.at(-1)?.confidence.value).toBe(0.94);
    expect(h033?.assessments.at(-1)?.confidence.value).toBe(0.92);
    expect(h034?.assessments.at(-1)?.confidence.value).toBe(0.75);

    expect((h032?.assessments.length ?? 0) > 1).toBe(true);
    expect((h033?.assessments.length ?? 0) > 1).toBe(true);
    expect((h034?.assessments.length ?? 0) > 1).toBe(true);
  });

  it('marks the ARC tungsten-mass estimate as derived/approximate/proxy, not an official BOM', () => {
    const dataset = createFusionFixtureDataset();
    const tungstenMass = dataset.variables.find(
      (v) => v.id === FUSION_FIXTURE_IDS.variables.tungstenMass,
    );
    expect(tungstenMass?.origin).toBe('derived');
    expect(
      typeof tungstenMass?.value === 'object' &&
        tungstenMass.value !== null &&
        'uncertainty' in tungstenMass.value,
    ).toBe(true);
  });

  it("leaves the revenue model's output uncomputed rather than executing the formula", () => {
    const dataset = createFusionFixtureDataset();
    const revenue = dataset.variables.find(
      (v) => v.id === FUSION_FIXTURE_IDS.variables.fusionRevenue,
    );
    expect(revenue?.value).toBeNull();
  });

  it('gives the high-demand/constrained-tritium scenario no probability', () => {
    const dataset = createFusionFixtureDataset();
    const scenario = dataset.scenarios.find(
      (s) => s.id === FUSION_FIXTURE_IDS.scenarios.highDemandConstrainedTritium,
    );
    expect(scenario?.probability).toBeUndefined();
  });

  it('evolves the Walter Tosto/SPARC relationship through tested -> qualified', () => {
    const dataset = createFusionFixtureDataset();
    const relationship = dataset.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.walterTostoSparc,
    );
    expect(relationship?.states.map((s) => s.status)).toEqual(['tested', 'qualified']);
  });

  it('includes the full T-/H-series hypothesis register from the September 2026 research dump', () => {
    const dataset = createFusionFixtureDataset();
    const names = dataset.hypotheses.map((h) => h.name).sort();
    expect(names).toEqual(
      [
        'H016',
        'H018',
        'H019',
        'H020',
        'H021',
        'H022',
        'H023',
        'H024',
        'H026',
        'H032',
        'H033',
        'H034',
        'H-ELMT-001',
        'H-ELMT-002',
        'H-ELMT-003',
        'H-ELMT-004',
        'H-ELMT-005',
        'H-ELMT-006',
        'H-ELMT-007',
        'H-ELMT-008',
        'T-001',
        'T-002',
        'T-003',
        'T-008',
        'T-009',
      ].sort(),
    );
  });

  it('includes the eight named scenarios from the research dump alongside the original one', () => {
    const dataset = createFusionFixtureDataset();
    const names = dataset.scenarios.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Fusion Bull',
        'Fusion Delay',
        'Materials Bottleneck',
        'HTS Breakthrough',
        'Tritium Bottleneck',
        'Fusion False Dawn',
        'Supplier Winner',
        'Commodity Trap',
      ]),
    );
    expect(dataset.scenarios.every((s) => s.probability === undefined)).toBe(true);
  });

  it('does not promote a plausible relationship into an established one: ELMT manufactures tungsten and ARC requires tungsten, but no ELMT-supplies-ARC relationship exists', () => {
    const dataset = createFusionFixtureDataset();
    const elmtArcRelationship = dataset.relationships.find(
      (r) =>
        (r.fromEntityId === FUSION_FIXTURE_IDS.entities.elmt &&
          r.toEntityId === FUSION_FIXTURE_IDS.entities.arc) ||
        (r.fromEntityId === FUSION_FIXTURE_IDS.entities.arc &&
          r.toEntityId === FUSION_FIXTURE_IDS.entities.elmt),
    );
    expect(elmtArcRelationship).toBeUndefined();
  });

  it('records point-in-time market/financial snapshots with a note that they must not be reused outside their observation date', () => {
    const dataset = createFusionFixtureDataset();
    const marketCap = dataset.variables.find(
      (v) => v.id === FUSION_FIXTURE_IDS.variables.elmtMarketCapSnapshot,
    );
    expect(marketCap?.metadata?.note).toContain('must not be reused');
  });
});
