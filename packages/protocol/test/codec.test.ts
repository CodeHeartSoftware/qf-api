import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from '../src/codec.js';
import type { InitMessage } from '../src/messages.js';

const validInit: InitMessage = {
  protocolVersion: '1.0',
  type: 'init',
  matchId: 'match-001',
  seq: 0,
  sentAt: '2026-01-01T00:00:00.000Z',
  payload: {
    gameId: 'rock-paper-scissors',
    gameVersion: '1.0.0',
    participantId: 'p1',
    roster: ['p1', 'p2'],
    rngSeed: 'deadbeef',
    config: {},
  },
};

describe('encodeMessage / decodeMessage round-trip', () => {
  it('round-trips a valid message', () => {
    const line = encodeMessage(validInit);
    expect(line.endsWith('\n')).toBe(true);
    const result = decodeMessage(line.slice(0, -1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(validInit);
    }
  });
});

describe('decodeMessage failure modes', () => {
  it('reports malformed JSON without throwing', () => {
    const result = decodeMessage('{not valid json');
    expect(result).toEqual({ ok: false, reason: 'line is not valid JSON' });
  });

  it('reports a schema violation with a human-readable reason', () => {
    const result = decodeMessage(JSON.stringify({ ...validInit, seq: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('seq');
    }
  });

  it('reports an unknown message type', () => {
    const result = decodeMessage(JSON.stringify({ ...validInit, type: 'bogus' }));
    expect(result.ok).toBe(false);
  });
});
