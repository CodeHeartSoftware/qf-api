import { describe, expect, it } from 'vitest';
import { ProtocolMessageSchema } from '../src/messages.js';

const base = {
  protocolVersion: '1.0',
  matchId: 'match-001',
  seq: 0,
  sentAt: '2026-01-01T00:00:00.000Z',
};

describe('ProtocolMessageSchema — one valid example per message type', () => {
  it('init', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'init',
      payload: {
        gameId: 'rock-paper-scissors',
        gameVersion: '1.0.0',
        participantId: 'p1',
        roster: ['p1', 'p2'],
        rngSeed: 'abc123',
        config: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it('ready', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'ready',
      payload: { protocolVersion: '1.0' },
    });
    expect(result.success).toBe(true);
  });

  it('observation', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'observation',
      roundId: 1,
      payload: { state: { round: 1 }, awaitingAction: true },
    });
    expect(result.success).toBe(true);
  });

  it('action', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'action',
      roundId: 1,
      payload: { action: { choice: 'rock' } },
    });
    expect(result.success).toBe(true);
  });

  it('result (round-scoped, with roundId)', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'result',
      roundId: 1,
      payload: { scope: 'round', outcome: { winner: 'p1' } },
    });
    expect(result.success).toBe(true);
  });

  it('result (match-scoped, without roundId)', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'result',
      payload: { scope: 'match', outcome: { winner: 'p1' } },
    });
    expect(result.success).toBe(true);
  });

  it('resign', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'resign',
      payload: { note: 'giving up' },
    });
    expect(result.success).toBe(true);
  });

  it('error (engine-reported forfeit)', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'error',
      payload: { reason: 'TURN_TIMEOUT', detail: 'no action within deadline' },
    });
    expect(result.success).toBe(true);
  });

  it('error (bot self-report, detail only)', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'error',
      payload: { detail: 'uncaught exception in strategy code' },
    });
    expect(result.success).toBe(true);
  });

  it('match-end', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'match-end',
      payload: { result: { winner: 'p1' }, reason: 'completed' },
    });
    expect(result.success).toBe(true);
  });

  it('match-end with reason "suspended" (roadmap Phase 3 — a forward match pausing, not ending)', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'match-end',
      payload: { result: null, reason: 'suspended' },
    });
    expect(result.success).toBe(true);
  });
});

describe('cross-field validation', () => {
  it('rejects a round-scoped result missing roundId', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'result',
      payload: { scope: 'round', outcome: {} },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a match-scoped result that includes roundId', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'result',
      roundId: 3,
      payload: { scope: 'match', outcome: {} },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an error payload with neither reason nor detail', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'error',
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('forward compatibility', () => {
  it('silently strips an unrecognized top-level field rather than rejecting the message', () => {
    const result = ProtocolMessageSchema.safeParse({
      ...base,
      type: 'ready',
      payload: { protocolVersion: '1.0' },
      somethingFromAFutureMinorVersion: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('somethingFromAFutureMinorVersion');
    }
  });
});

describe('basic envelope rejections', () => {
  it('rejects a missing type', () => {
    expect(ProtocolMessageSchema.safeParse({ ...base }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(ProtocolMessageSchema.safeParse({ ...base, type: 'bogus', payload: {} }).success).toBe(
      false,
    );
  });

  it('rejects a negative seq', () => {
    expect(
      ProtocolMessageSchema.safeParse({
        ...base,
        seq: -1,
        type: 'ready',
        payload: { protocolVersion: '1.0' },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty matchId', () => {
    expect(
      ProtocolMessageSchema.safeParse({
        ...base,
        matchId: '',
        type: 'ready',
        payload: { protocolVersion: '1.0' },
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed protocolVersion', () => {
    expect(
      ProtocolMessageSchema.safeParse({
        ...base,
        protocolVersion: '1',
        type: 'ready',
        payload: { protocolVersion: '1.0' },
      }).success,
    ).toBe(false);
  });
});
