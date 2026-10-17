import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachRoundRationale,
  deleteForwardMatchRecords,
  listRoundAudit,
  recordRoundAudit,
  saveForwardMatchRecord,
  type RoundAuditEntry,
} from '../src/index.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fms-audit-'));
  dbPath = join(dir, 'db.sqlite');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(roundIndex: number, overrides: Partial<RoundAuditEntry> = {}): RoundAuditEntry {
  return {
    matchId: 'm1',
    roundIndex,
    participantId: 'bot-a',
    date: `2026-01-0${String(roundIndex + 5)}`,
    recordedAt: '2026-01-10T00:00:00.000Z',
    collection: 'ok',
    action: { orders: [{ ticker: 'AAA', side: 'BUY', quantity: 10 }] },
    fills: [],
    equityCents: 100_000,
    ...overrides,
  };
}

describe('round audit', () => {
  it('records, lists newest-first, and attaches late rationale by date', () => {
    expect(
      recordRoundAudit(dbPath, [entry(0), entry(1), entry(1, { participantId: 'bot-b' })]).ok,
    ).toBe(true);
    const attached = attachRoundRationale(dbPath, 'm1', 'bot-a', '2026-01-06', [
      { security: 'AAA' },
    ]);
    expect(attached).toEqual({ ok: true, value: 1 });

    const listed = listRoundAudit(dbPath, 'm1', { participantId: 'bot-a' });
    if (!listed.ok) throw new Error(listed.reason);
    expect(listed.value.map((e) => e.roundIndex)).toEqual([1, 0]);
    expect(listed.value[0]).toMatchObject({ date: '2026-01-06', rationale: [{ security: 'AAA' }] });
    expect(listed.value[1]?.rationale).toBeUndefined();
  });

  it('keeps existing rationale when a round is re-recorded without one', () => {
    recordRoundAudit(dbPath, [entry(0, { rationale: [{ why: 1 }] })]);
    recordRoundAudit(dbPath, [entry(0, { equityCents: 5 })]);
    const listed = listRoundAudit(dbPath, 'm1');
    expect(listed.ok && listed.value[0]).toMatchObject({ equityCents: 5, rationale: [{ why: 1 }] });
  });

  it('is removed along with its match', async () => {
    await saveForwardMatchRecord(dbPath, {
      matchId: 'm1',
      gameId: 'g',
      gameVersion: '1',
      config: {},
      participantIds: ['bot-a'],
      matchSeed: 'ab',
      createdAt: 'x',
      updatedAt: 'x',
      status: 'active',
      roundsPlayed: 0,
      snapshot: {},
    });
    recordRoundAudit(dbPath, [entry(0)]);
    await deleteForwardMatchRecords(dbPath, 'm1');
    const listed = listRoundAudit(dbPath, 'm1');
    expect(listed.ok && listed.value).toEqual([]);
  });
});
