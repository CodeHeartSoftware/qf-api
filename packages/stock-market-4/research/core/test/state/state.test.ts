import { describe, expect, it } from 'vitest';
import { parseResearchState } from '../../src/state/state.js';

describe('ResearchState', () => {
  it('accepts a state with every collection empty', () => {
    const raw = {
      timestamp: '2026-01-01T00:00:00Z',
      entities: [],
      relationships: [],
      evidence: [],
      assertions: [],
      hypotheses: [],
      assumptions: [],
      variables: [],
      models: [],
      scenarios: [],
      events: [],
      questions: [],
    };
    expect(parseResearchState(raw)).toEqual({ ok: true, value: raw });
  });

  it('rejects a state missing timestamp', () => {
    const raw = {
      entities: [],
      relationships: [],
      evidence: [],
      assertions: [],
      hypotheses: [],
      assumptions: [],
      variables: [],
      models: [],
      scenarios: [],
      events: [],
      questions: [],
    };
    expect(parseResearchState(raw).ok).toBe(false);
  });

  it('rejects unknown extra fields (no dataset-level id/name/version here)', () => {
    const raw = {
      timestamp: '2026-01-01T00:00:00Z',
      entities: [],
      relationships: [],
      evidence: [],
      assertions: [],
      hypotheses: [],
      assumptions: [],
      variables: [],
      models: [],
      scenarios: [],
      events: [],
      questions: [],
      id: 'not-allowed-here',
    };
    expect(parseResearchState(raw).ok).toBe(false);
  });
});
