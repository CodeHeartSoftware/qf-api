import { describe, expect, it } from 'vitest';
import type { ActionCollector } from '@quant-fusion/engine';
import {
  AuditingActionCollector,
  equityCentsFor,
  RationaleCollector,
  roundDateAndFills,
} from '../src/lib/roundAudit.js';

describe('RationaleCollector', () => {
  it('reassembles lines split across chunks and groups decisions by date', () => {
    const c = new RationaleCollector();
    c.push('bot', 'noise\nQUANT_DECISION_JSON:{"date":"2026-01-05","sec');
    c.push('bot', 'urity":"A"}\nQUANT_DECISION_JSON:{"date":"2026-01-05","security":"B"}\n');
    c.push(
      'bot',
      'QUANT_DECISION_JSON:{"date":"2026-01-06","security":"A"}\nQUANT_DECISION_JSON:{broken\n',
    );
    expect(c.entries()).toEqual([
      {
        participantId: 'bot',
        date: '2026-01-05',
        rationale: [
          { date: '2026-01-05', security: 'A' },
          { date: '2026-01-05', security: 'B' },
        ],
      },
      {
        participantId: 'bot',
        date: '2026-01-06',
        rationale: [{ date: '2026-01-06', security: 'A' }],
      },
    ]);
  });
});

describe('AuditingActionCollector', () => {
  it('records each participant’s action, observation hash, and date per round', async () => {
    const inner: ActionCollector = {
      requestAction: (args) =>
        Promise.resolve(
          args.participantId === 'a'
            ? { ok: true, action: { orders: [] } }
            : { ok: false, reason: 'timeout' },
        ),
    };
    const collector = new AuditingActionCollector(inner);
    const base = { roundId: 3, observation: { date: '2026-01-05' }, deadlineMs: 1, required: true };
    await collector.requestAction({ ...base, participantId: 'a' });
    await collector.requestAction({ ...base, participantId: 'b' });
    const round = collector.take(3);
    expect(round.get('a')).toMatchObject({
      collection: 'ok',
      action: { orders: [] },
      date: '2026-01-05',
    });
    expect(round.get('a')?.observationSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(round.get('b')).toMatchObject({ collection: 'timeout' });
    expect(collector.take(3).size).toBe(0);
  });
});

describe('stock-market-4 duck-typing helpers', () => {
  it('reads the round date, a participant’s fills, and its equity', () => {
    const events = [
      { type: 'round-result', data: { date: '2026-01-05', fills: { a: [{ q: 1 }] } } },
    ];
    expect(roundDateAndFills(events, 'a')).toEqual({ date: '2026-01-05', fills: [{ q: 1 }] });
    expect(roundDateAndFills(events, 'b')).toEqual({ date: '2026-01-05', fills: [] });
    expect(equityCentsFor({ standings: [{ participantId: 'a', equityCents: 42 }] }, 'a')).toBe(42);
    expect(equityCentsFor(undefined, 'a')).toBeUndefined();
  });
});
