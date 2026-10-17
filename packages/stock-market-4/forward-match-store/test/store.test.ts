import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteForwardMatchRecords,
  listForwardMatchRecords,
  loadForwardMatchRecord,
  saveForwardMatchRecord,
} from '../src/store.js';
import type { ForwardMatchRecord } from '../src/types.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for why `node:sqlite` is loaded this way.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'quant-fusion-forward-match-store-test-'));
  dbPath = path.join(root, 'nested', 'db.sqlite');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sampleRecord(overrides: Partial<ForwardMatchRecord> = {}): ForwardMatchRecord {
  return {
    matchId: 'fusion-fundamental-v0-live',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: { gameType: 'FORWARD_SHADOW' },
    participantIds: ['fusion-fundamental-v0'],
    matchSeed: 'deadbeef',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    status: 'active',
    roundsPlayed: 0,
    snapshot: { round: 0 },
    ...overrides,
  };
}

describe('saveForwardMatchRecord + loadForwardMatchRecord', () => {
  it('round-trips a record exactly', async () => {
    const record = sampleRecord();
    const saved = await saveForwardMatchRecord(dbPath, record);
    expect(saved.ok).toBe(true);

    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome).toEqual({ status: 'found', record });
  });

  it('round-trips pins, and loads a record saved without them with no pins at all', async () => {
    const pins = {
      pinnedAt: '2026-09-24T00:00:00.000Z',
      configSha256: 'c0ffee',
      bots: { 'quant-v0': { sourceSha256: 'abc123', imageId: 'sha256:204c8a' } },
    };
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'pinned', pins }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'unpinned' }));
    const pinned = await loadForwardMatchRecord(dbPath, 'pinned');
    const unpinned = await loadForwardMatchRecord(dbPath, 'unpinned');
    expect(pinned.status === 'found' && pinned.record.pins).toEqual(pins);
    expect(unpinned.status === 'found' && 'pins' in unpinned.record).toBe(false);
  });

  it('deletes one record by id, or every non-active record', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'live', status: 'active' }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'done', status: 'completed' }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'stopped', status: 'ended' }));
    const inactive = await deleteForwardMatchRecords(dbPath);
    expect(inactive.ok && [...inactive.value].sort()).toEqual(['done', 'stopped']);
    expect((await loadForwardMatchRecord(dbPath, 'live')).status).toBe('found');
    const one = await deleteForwardMatchRecords(dbPath, 'live');
    expect(one.ok && one.value).toEqual(['live']);
    expect((await loadForwardMatchRecord(dbPath, 'live')).status).toBe('not-found');
    const missing = await deleteForwardMatchRecords(dbPath, 'nope');
    expect(missing.ok && missing.value).toEqual([]);
  });

  it('creates the db file (and its parent directory) on first save if it does not exist yet', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(dbPath, record); // dbPath's directory doesn't exist before this call
    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome.status).toBe('found');
  });

  it('overwrites progress on a resave — roundsPlayed/snapshot/updatedAt advance', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(dbPath, record);

    const updated: ForwardMatchRecord = {
      ...record,
      roundsPlayed: 1,
      snapshot: { round: 1 },
      updatedAt: '2026-09-11T00:00:00.000Z',
    };
    await saveForwardMatchRecord(dbPath, updated);

    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome).toEqual({ status: 'found', record: updated });
  });

  it('reports "not-found" for a matchId with no saved record', async () => {
    const outcome = await loadForwardMatchRecord(dbPath, 'never-saved');
    expect(outcome).toEqual({ status: 'not-found' });
  });

  it('reports "corrupt" (never "not-found") for a row with unparseable JSON columns', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'broken' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'broken',
    );
    db.close();

    const outcome = await loadForwardMatchRecord(dbPath, 'broken');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('unparseable JSON');
  });

  it('reports "corrupt" for a row whose JSON does not match the schema', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'wrong-shape' }));
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE forward_matches SET rounds_played = ? WHERE match_id = ?').run(
      -1,
      'wrong-shape',
    );
    db.close();

    const outcome = await loadForwardMatchRecord(dbPath, 'wrong-shape');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('corrupt');
  });

  it('round-trips an "ended" record — the widened status CHECK constraint from migration 0002', async () => {
    const record = sampleRecord({ status: 'ended' });
    const saved = await saveForwardMatchRecord(dbPath, record);
    expect(saved.ok).toBe(true);

    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome).toEqual({ status: 'found', record });
  });
});

describe('listForwardMatchRecords', () => {
  it('returns an empty list with no issues when the db does not exist yet', async () => {
    const result = await listForwardMatchRecords(dbPath);
    expect(result).toEqual({ summaries: [], issues: [] });
  });

  it('summarizes every valid record, most-recently-updated first', async () => {
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'older', updatedAt: '2026-09-01T00:00:00.000Z' }),
    );
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'newer', updatedAt: '2026-09-10T00:00:00.000Z' }),
    );

    const result = await listForwardMatchRecords(dbPath);
    expect(result.issues).toEqual([]);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['newer', 'older']);
    expect(result.summaries[0]).toEqual({
      matchId: 'newer',
      gameId: 'stock-market-4',
      status: 'active',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      roundsPlayed: 0,
      participantIds: ['fusion-fundamental-v0'],
    });
  });

  it('collects an issue for a corrupt record without hiding the valid ones', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'valid' }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'corrupt' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'corrupt',
    );
    db.close();

    const result = await listForwardMatchRecords(dbPath);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['valid']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toContain('corrupt');
  });
});
