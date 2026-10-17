import { describe, expect, it } from 'vitest';
import { parseProvenance } from '../../src/common/provenance.js';

describe('Provenance', () => {
  it('accepts an empty object — every field is optional', () => {
    expect(parseProvenance({}).ok).toBe(true);
  });

  it('accepts a fully populated provenance', () => {
    const raw = {
      source: 'ELMT press release',
      uri: 'https://example.com/elmt-cfs',
      publisher: 'ELMT',
      observedAt: '2026-03-01T00:00:00Z',
      publishedAt: '2026-02-15T00:00:00Z',
      availableAt: '2026-02-15T00:00:00Z',
      retrievedAt: '2026-03-02T00:00:00Z',
      metadata: { confidence_note: 'primary source' },
    };
    expect(parseProvenance(raw)).toEqual({ ok: true, value: raw });
  });

  it('rejects a malformed timestamp field', () => {
    expect(parseProvenance({ observedAt: 'not a timestamp' }).ok).toBe(false);
  });

  it('rejects a non-JSON metadata value', () => {
    expect(parseProvenance({ metadata: { fn: () => 1 } }).ok).toBe(false);
  });
});
