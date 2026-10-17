import { describe, expect, it } from 'vitest';
import { parseRelationshipState } from '../../src/relationship/relationship-state.js';

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'qualified',
    recordedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2025-06-01T00:00:00Z',
    evidenceIds: ['evidence-1'],
    ...overrides,
  };
}

describe('RelationshipState', () => {
  it('accepts a minimal valid state', () => {
    expect(parseRelationshipState(baseState()).ok).toBe(true);
  });

  it('accepts a closed state with confidence and metadata', () => {
    const raw = baseState({
      effectiveTo: '2026-06-01T00:00:00Z',
      confidence: { value: 0.8 },
      metadata: { note: 'superseded by production contract' },
    });
    expect(parseRelationshipState(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty status', () => {
    expect(parseRelationshipState(baseState({ status: '' })).ok).toBe(false);
  });

  it('requires recordedAt and effectiveFrom', () => {
    const withoutRecordedAt = {
      status: 'qualified',
      effectiveFrom: '2025-06-01T00:00:00Z',
      evidenceIds: [],
    };
    expect(parseRelationshipState(withoutRecordedAt).ok).toBe(false);
    const withoutEffectiveFrom = {
      status: 'qualified',
      recordedAt: '2026-01-01T00:00:00Z',
      evidenceIds: [],
    };
    expect(parseRelationshipState(withoutEffectiveFrom).ok).toBe(false);
  });

  it('requires evidenceIds to be an array of non-empty ids', () => {
    expect(parseRelationshipState(baseState({ evidenceIds: ['', 'evidence-2'] })).ok).toBe(false);
  });

  it('accepts an empty evidenceIds array — structurally valid, even if unusual', () => {
    expect(parseRelationshipState(baseState({ evidenceIds: [] })).ok).toBe(true);
  });

  it('rejects effectiveFrom after effectiveTo', () => {
    const result = parseRelationshipState(
      baseState({ effectiveFrom: '2027-01-01T00:00:00Z', effectiveTo: '2026-01-01T00:00:00Z' }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts effectiveFrom equal to effectiveTo', () => {
    const result = parseRelationshipState(
      baseState({ effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-01-01T00:00:00Z' }),
    );
    expect(result.ok).toBe(true);
  });
});
