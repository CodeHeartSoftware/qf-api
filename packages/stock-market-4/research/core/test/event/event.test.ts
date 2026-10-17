import { describe, expect, it } from 'vitest';
import { parseResearchEvent } from '../../src/event/event.js';

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-supplier-qualified',
    timestamp: '2026-06-01T00:00:00Z',
    type: 'SUPPLIER_QUALIFIED',
    entityIds: ['entity-walter-tosto'],
    payload: { component: 'vacuum vessel' },
    evidenceIds: ['evidence-1'],
    ...overrides,
  };
}

describe('ResearchEvent', () => {
  it('accepts a minimal valid event', () => {
    expect(parseResearchEvent(baseEvent()).ok).toBe(true);
  });

  it('requires a non-empty type and a valid timestamp', () => {
    expect(parseResearchEvent(baseEvent({ type: '' })).ok).toBe(false);
    expect(parseResearchEvent(baseEvent({ timestamp: 'not a timestamp' })).ok).toBe(false);
  });

  it('accepts an empty payload object', () => {
    expect(parseResearchEvent(baseEvent({ payload: {} })).ok).toBe(true);
  });

  it('requires payload, entityIds, and evidenceIds to be present', () => {
    expect(parseResearchEvent(baseEvent({ payload: undefined })).ok).toBe(false);
    expect(parseResearchEvent(baseEvent({ entityIds: undefined })).ok).toBe(false);
    expect(parseResearchEvent(baseEvent({ evidenceIds: undefined })).ok).toBe(false);
  });
});
