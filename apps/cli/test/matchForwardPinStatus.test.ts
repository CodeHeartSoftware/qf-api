import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveForwardMatchRecord, type ForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeBotSourceSha256 } from '../src/lib/botSourcePin.js';
import { computeMatchPinStatus } from '../src/commands/matchForwardPinStatus.js';

// Against the REAL registry (like `matchForward.test.ts`) — hashing a real bot's source is cheap
// and touches no Docker.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BOT_ID = 'quant-v0';

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'quant-fusion-pin-status-test-'));
  dbPath = join(root, 'db.sqlite');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function record(pins: ForwardMatchRecord['pins']): ForwardMatchRecord {
  return {
    matchId: 'm1',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: { gameType: 'FORWARD_SHADOW' },
    participantIds: [BOT_ID],
    matchSeed: 'deadbeef',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    status: 'active',
    roundsPlayed: 0,
    snapshot: { round: 0 },
    ...(pins !== undefined ? { pins } : {}),
  };
}

describe('computeMatchPinStatus', () => {
  it('reports pinned / drifted / unpinned per bot', async () => {
    const current = await computeBotSourceSha256(join(repoRoot, 'bots', 'stock-market-4', BOT_ID));
    const cases: [ForwardMatchRecord['pins'], string][] = [
      [
        { pinnedAt: 'x', configSha256: 'c', bots: { [BOT_ID]: { sourceSha256: current } } },
        'pinned',
      ],
      [
        { pinnedAt: 'x', configSha256: 'c', bots: { [BOT_ID]: { sourceSha256: 'stale' } } },
        'drifted',
      ],
      [undefined, 'unpinned'],
    ];
    for (const [pins, expected] of cases) {
      const saved = await saveForwardMatchRecord(dbPath, record(pins));
      if (!saved.ok) throw new Error(saved.reason);
      const result = await computeMatchPinStatus(repoRoot, dbPath, 'm1');
      expect(result.ok && result.value.bots[0]?.state).toBe(expected);
    }
  });

  it('fails clearly for an unknown match', async () => {
    const result = await computeMatchPinStatus(repoRoot, dbPath, 'nope');
    expect(result).toEqual({ ok: false, message: 'No forward match "nope".' });
  });
});
