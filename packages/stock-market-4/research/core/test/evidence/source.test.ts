import { describe, expect, it } from 'vitest';
import { parseEvidenceSource } from '../../src/evidence/source.js';

describe('EvidenceSource', () => {
  it('accepts a minimal source with just a name', () => {
    expect(parseEvidenceSource({ name: 'ELMT press release' }).ok).toBe(true);
  });

  it('accepts a fully populated source', () => {
    const raw = {
      name: 'ELMT press release',
      uri: 'https://example.com/elmt-cfs',
      publisher: 'ELMT',
      retrievedAt: '2026-03-02T00:00:00Z',
      metadata: { section: 'partnerships' },
    };
    expect(parseEvidenceSource(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty name', () => {
    expect(parseEvidenceSource({ name: '' }).ok).toBe(false);
    expect(parseEvidenceSource({}).ok).toBe(false);
  });

  it('rejects a malformed retrievedAt', () => {
    expect(parseEvidenceSource({ name: 'x', retrievedAt: 'not a timestamp' }).ok).toBe(false);
  });
});
