import { describe, expect, it } from 'vitest';
import { parseResearchAssertion } from '../../src/assertion/assertion.js';

function baseAssertion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assertion-qualification-not-procurement',
    statement: 'Supplier qualification does not imply commercial procurement.',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    evidenceIds: [],
    ...overrides,
  };
}

describe('ResearchAssertion', () => {
  it('accepts a minimal valid assertion with no cited evidence', () => {
    expect(parseResearchAssertion(baseAssertion()).ok).toBe(true);
  });

  it('accepts an assertion citing evidence, entities, and relationships', () => {
    const raw = baseAssertion({
      evidenceIds: ['evidence-1'],
      entityIds: ['entity-walter-tosto'],
      relationshipIds: ['rel-walter-tosto-sparc'],
      confidence: { value: 0.7 },
    });
    expect(parseResearchAssertion(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty statement and a valid status', () => {
    expect(parseResearchAssertion(baseAssertion({ statement: '' })).ok).toBe(false);
    expect(parseResearchAssertion(baseAssertion({ status: 'not-a-status' })).ok).toBe(false);
  });

  it('accepts every documented status value', () => {
    const statuses = ['proposed', 'active', 'supported', 'contested', 'rejected', 'retired'];
    for (const status of statuses) {
      expect(parseResearchAssertion(baseAssertion({ status })).ok).toBe(true);
    }
  });

  it('requires createdAt', () => {
    expect(parseResearchAssertion(baseAssertion({ createdAt: undefined })).ok).toBe(false);
  });

  it('rejects validFrom after validTo', () => {
    const raw = baseAssertion({
      validFrom: '2030-01-01T00:00:00Z',
      validTo: '2020-01-01T00:00:00Z',
    });
    expect(parseResearchAssertion(raw).ok).toBe(false);
  });

  it('rejects unknown extra fields', () => {
    expect(parseResearchAssertion(baseAssertion({ unexpected: 'field' })).ok).toBe(false);
  });
});
