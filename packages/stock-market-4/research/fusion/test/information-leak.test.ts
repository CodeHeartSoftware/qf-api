import { createResearchSnapshot } from '@quant-fusion/research-core';
import { describe, expect, it } from 'vitest';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '../src/index.js';

/**
 * A second, independent point-in-time case from the September 2026 research dump: ELMT's
 * ams OSRAM acquisition was announced (SEC Exhibit 99.1) on 2026-09-08. A decision made even one
 * day earlier must not see it.
 */
describe('point-in-time test: the ELMT / ams OSRAM acquisition (announced 2026-09-08)', () => {
  const dataset = createFusionFixtureDataset();

  it('is absent from a snapshot taken the day before the announcement', () => {
    // Note: "ams OSRAM" the company name alone is NOT a safe substring here — the entity
    // legitimately exists as known background (recordedAt 2023, like every other company in
    // this fixture) well before the acquisition itself was ever announced. This checks the
    // acquisition-specific evidence/event instead.
    const snapshot = createResearchSnapshot(dataset, '2026-09-07T23:59:59Z');
    // By event id, not event type: other, genuinely earlier ACQUISITION_ANNOUNCED /
    // AEROSPACE_CONTRACT_AWARDED events exist (the Jan-Jun 2026 backfill — e.g. General Fusion's
    // Jan 22 business combination), so a type-level check would flag real history as a leak.
    expect(
      snapshot.state.events.some(
        (e) => e.id === FUSION_FIXTURE_IDS.events.elmtAmsOsramAcquisitionAnnounced,
      ),
    ).toBe(false);
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.elmtAmsOsramAcquisition,
      ),
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Schwabm');
    expect(JSON.stringify(snapshot)).not.toContain('definitive agreement');
  });

  it('is present from the moment of the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-09-08T00:00:00Z');
    expect(
      snapshot.state.events.some(
        (e) => e.id === FUSION_FIXTURE_IDS.events.elmtAmsOsramAcquisitionAnnounced,
      ),
    ).toBe(true);
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.elmtAmsOsramAcquisition,
      ),
    ).toBe(true);
  });

  it('never mutates the source dataset while producing snapshots', () => {
    const before = JSON.stringify(dataset);
    createResearchSnapshot(dataset, '2026-09-07T23:59:59Z');
    createResearchSnapshot(dataset, '2026-09-08T00:00:00Z');
    expect(JSON.stringify(dataset)).toBe(before);
  });
});

/**
 * A third point-in-time case: Vitzro Nextech's Hanwha Aerospace contract, announced 2026-08-06 —
 * explicitly NOT a fusion contract, but still subject to the same point-in-time discipline.
 */
describe('point-in-time test: the Vitzro Nextech / Hanwha Aerospace contract (announced 2026-08-06)', () => {
  const dataset = createFusionFixtureDataset();

  it('is absent from a snapshot taken the day before the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-08-05T23:59:59Z');
    expect(
      snapshot.state.events.some(
        (e) => e.id === FUSION_FIXTURE_IDS.events.vitzroNextechHanwhaContractAwarded,
      ),
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Hanwha');
  });

  it('is present from the moment of the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-08-06T00:00:00Z');
    expect(
      snapshot.state.events.some(
        (e) => e.id === FUSION_FIXTURE_IDS.events.vitzroNextechHanwhaContractAwarded,
      ),
    ).toBe(true);
  });
});

/**
 * A fourth point-in-time case, from the Sept 9, 2026 research update: Freemelt's order from
 * Fusion for Energy (F4E) to supply tungsten-based components for JT-60SA.
 */
describe('point-in-time test: the Freemelt / F4E JT-60SA order (announced 2026-09-09)', () => {
  const dataset = createFusionFixtureDataset();

  it('is absent from a snapshot taken the day before the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-09-08T23:59:59Z');
    expect(snapshot.state.events.some((e) => e.type === 'FUSION_COMPONENT_ORDER_AWARDED')).toBe(
      false,
    );
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.freemeltJt60saOrder2026,
      ),
    ).toBe(false);
    const relationship = snapshot.state.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.freemeltJt60sa,
    );
    expect(relationship).toBeUndefined();
    // NOT a blanket `.not.toContain('Freemelt')`/`.not.toContain('JT-60SA')` — the portfolio
    // research update (Sept 2026) added genuinely earlier Freemelt evidence (an Aug 11 Saab
    // Dynamics order), so the entity is legitimately knowable well before this specific order; and
    // "JT-60SA" is independently, legitimately mentioned in Walter Tosto's own (much earlier)
    // supply-history evidence, unrelated to Freemelt. A fact this specific to THIS order is the
    // right leak check instead: its own order quantity/value shouldn't appear this early.
    expect(JSON.stringify(snapshot)).not.toContain('33,000 tungsten-based components');
  });

  it('is present from the moment of the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-09-09T00:00:00Z');
    expect(snapshot.state.events.some((e) => e.type === 'FUSION_COMPONENT_ORDER_AWARDED')).toBe(
      true,
    );
    const relationship = snapshot.state.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.freemeltJt60sa,
    );
    expect(relationship?.states.some((s) => s.status === 'production contract')).toBe(true);
  });
});
