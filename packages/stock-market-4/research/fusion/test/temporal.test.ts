import { computeResearchStateAt } from '@quant-fusion/research-core';
import { describe, expect, it } from 'vitest';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '../src/index.js';

/**
 * The most important test fixture per spec §44: research changing over time, reconstructed
 * correctly at several historical cutoffs, with neither cutoff able to see assessments made
 * after it.
 */
describe('H032 confidence history reconstruction (spec §44)', () => {
  const dataset = createFusionFixtureDataset();

  function h032ConfidenceAt(timestamp: string): number[] {
    const state = computeResearchStateAt(dataset, timestamp);
    const h032 = state.hypotheses.find((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h032);
    return h032?.assessments.map((a) => a.confidence.value) ?? [];
  }

  it('returns only the 2024 assessment at end-of-2024', () => {
    expect(h032ConfidenceAt('2024-12-31T23:59:59Z')).toEqual([0.75]);
  });

  it('returns the 2024 and 2025 assessments at end-of-2025, not 2026', () => {
    expect(h032ConfidenceAt('2025-12-31T23:59:59Z')).toEqual([0.75, 0.85]);
  });

  it('returns all three assessments at end-of-2026', () => {
    expect(h032ConfidenceAt('2026-12-31T23:59:59Z')).toEqual([0.75, 0.85, 0.94]);
  });

  it('a mid-2025 snapshot cannot see the 2025 year-end or 2026 assessments yet', () => {
    expect(h032ConfidenceAt('2025-06-01T00:00:00Z')).toEqual([0.75]);
  });

  it('a snapshot before the hypothesis was even proposed sees nothing', () => {
    const state = computeResearchStateAt(dataset, '2023-06-01T00:00:00Z');
    expect(state.hypotheses.some((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h032)).toBe(false);
  });
});

describe('H033/H034 confidence histories reconstruct independently of H032', () => {
  const dataset = createFusionFixtureDataset();

  it('H033 shows only its 2025 assessment before end-of-2026', () => {
    const state = computeResearchStateAt(dataset, '2026-06-01T00:00:00Z');
    const h033 = state.hypotheses.find((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h033);
    expect(h033?.assessments.map((a) => a.confidence.value)).toEqual([0.8]);
  });

  it('H034 shows only its 2025 assessment before end-of-2026', () => {
    const state = computeResearchStateAt(dataset, '2026-06-01T00:00:00Z');
    const h034 = state.hypotheses.find((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h034);
    expect(h034?.assessments.map((a) => a.confidence.value)).toEqual([0.6]);
  });

  it('both reach their stated baselines by end-of-2026', () => {
    const state = computeResearchStateAt(dataset, '2026-12-31T23:59:59Z');
    const h033 = state.hypotheses.find((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h033);
    const h034 = state.hypotheses.find((h) => h.id === FUSION_FIXTURE_IDS.hypotheses.h034);
    expect(h033?.assessments.map((a) => a.confidence.value)).toEqual([0.8, 0.92]);
    expect(h034?.assessments.map((a) => a.confidence.value)).toEqual([0.6, 0.75]);
  });
});

describe('Walter Tosto / SPARC relationship state reconstruction', () => {
  const dataset = createFusionFixtureDataset();

  function statusesAt(timestamp: string): string[] {
    const state = computeResearchStateAt(dataset, timestamp);
    const relationship = state.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.walterTostoSparc,
    );
    return relationship?.states.map((s) => s.status) ?? [];
  }

  it('shows only "tested" in early 2024', () => {
    expect(statusesAt('2024-06-01T00:00:00Z')).toEqual(['tested']);
  });

  it('shows "tested" and "qualified", unchanged, well after 2025', () => {
    expect(statusesAt('2028-06-01T00:00:00Z')).toEqual(['tested', 'qualified']);
  });
});
