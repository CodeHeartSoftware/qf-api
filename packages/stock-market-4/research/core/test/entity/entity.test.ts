import { describe, expect, it } from 'vitest';
import { parseResearchEntity } from '../../src/entity/entity.js';

function baseEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entity-arc',
    type: 'reactor',
    name: 'ARC',
    recordedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchEntity', () => {
  it('accepts a minimal valid entity', () => {
    const result = parseResearchEntity(baseEntity());
    expect(result.ok).toBe(true);
  });

  it('accepts an entity with description, validity window, and metadata', () => {
    const raw = baseEntity({
      description: 'Compact fusion reactor concept.',
      validFrom: '2021-01-01T00:00:00Z',
      validTo: '2035-01-01T00:00:00Z',
      metadata: { program: 'CFS' },
    });
    expect(parseResearchEntity(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty id, type, and name', () => {
    expect(parseResearchEntity(baseEntity({ id: '' })).ok).toBe(false);
    expect(parseResearchEntity(baseEntity({ type: '' })).ok).toBe(false);
    expect(parseResearchEntity(baseEntity({ name: '' })).ok).toBe(false);
  });

  it('requires recordedAt — an entity cannot be constructed without an epistemic timestamp', () => {
    const withoutRecordedAt = { id: 'entity-arc', type: 'reactor', name: 'ARC' };
    expect(parseResearchEntity(withoutRecordedAt).ok).toBe(false);
  });

  it('rejects a malformed recordedAt', () => {
    expect(parseResearchEntity(baseEntity({ recordedAt: 'not a timestamp' })).ok).toBe(false);
  });

  it('rejects validFrom after validTo', () => {
    const result = parseResearchEntity(
      baseEntity({ validFrom: '2030-01-01T00:00:00Z', validTo: '2020-01-01T00:00:00Z' }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts validFrom equal to validTo (an instantaneous validity window)', () => {
    const result = parseResearchEntity(
      baseEntity({ validFrom: '2030-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects unknown extra fields', () => {
    expect(parseResearchEntity(baseEntity({ unexpected: 'field' })).ok).toBe(false);
  });
});
