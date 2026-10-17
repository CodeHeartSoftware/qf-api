import { describe, expect, it } from 'vitest';
import { parseEvidence } from '../../src/evidence/evidence.js';

function baseEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evidence-elmt-cfs',
    observedAt: '2026-03-02T00:00:00Z',
    source: { name: 'ELMT press release' },
    description:
      'ELMT reported development-stage work with CFS involving fusion-relevant materials.',
    entityIds: ['entity-elmt', 'entity-cfs'],
    ...overrides,
  };
}

describe('Evidence', () => {
  it('accepts a minimal valid evidence record', () => {
    expect(parseEvidence(baseEvidence()).ok).toBe(true);
  });

  it('requires observedAt, source, and a non-empty description', () => {
    expect(parseEvidence(baseEvidence({ observedAt: undefined })).ok).toBe(false);
    expect(parseEvidence(baseEvidence({ source: undefined })).ok).toBe(false);
    expect(parseEvidence(baseEvidence({ description: '' })).ok).toBe(false);
  });

  it('accepts an empty entityIds array — some evidence is not entity-specific', () => {
    expect(parseEvidence(baseEvidence({ entityIds: [] })).ok).toBe(true);
  });

  describe('publication/availability semantics', () => {
    it('accepts the typical ordering: published, then available, then observed', () => {
      const raw = baseEvidence({
        publishedAt: '2026-02-15T00:00:00Z',
        availableAt: '2026-02-15T00:00:00Z',
        observedAt: '2026-03-02T00:00:00Z',
      });
      expect(parseEvidence(raw).ok).toBe(true);
    });

    it('does not require publishedAt/availableAt to precede observedAt — a private or embargoed observation is legitimate', () => {
      const raw = baseEvidence({
        observedAt: '2026-01-01T00:00:00Z',
        publishedAt: '2026-02-15T00:00:00Z',
        availableAt: '2026-02-15T00:00:00Z',
      });
      expect(parseEvidence(raw).ok).toBe(true);
    });

    it('accepts publishedAt and availableAt independently, each validated as its own timestamp', () => {
      expect(parseEvidence(baseEvidence({ publishedAt: 'not a timestamp' })).ok).toBe(false);
      expect(parseEvidence(baseEvidence({ availableAt: 'not a timestamp' })).ok).toBe(false);
    });
  });

  it('rejects unknown extra fields', () => {
    expect(parseEvidence(baseEvidence({ unexpected: 'field' })).ok).toBe(false);
  });
});
