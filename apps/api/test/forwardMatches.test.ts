import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { recordRoundAudit, saveForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { createMarketDataStore, publishDatasetVersion } from '@quant-fusion/market-data';
import { game, serializeForwardState } from '@quant-fusion/game-stock-market-4';
import { createRng } from '@quant-fusion/rng';
import { createApp } from '../src/app.js';
import { defaultForwardMatchStoreDbPath } from '../src/lib/paths.js';

const PARTICIPANT_ID = 'quant-v0';
const DATASET_ID = 'sm4-api-test-dataset';
const DATASET_VERSION = '1';

function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

const DATES = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
const FAST_BARS = DATES.map((date, i) => flatBar(date, 10 + i));
const SLOW_BARS = DATES.map((date, i) => flatBar(date, 20 + i));

let rootDir: string;
let marketDataDbPath: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'sm4-api-forward-matches-'));
  marketDataDbPath = join(rootDir, 'market-data.sqlite');

  const store = createMarketDataStore(marketDataDbPath);
  const published = publishDatasetVersion(
    store,
    { id: DATASET_ID, version: DATASET_VERSION },
    { bars: { FAST: FAST_BARS, SLOW: SLOW_BARS } },
  );
  if (!published.ok) throw new Error(published.reason);

  const configResult = game.parseConfig({
    startDate: DATES[0],
    endDate: DATES[DATES.length - 1],
    marketDataUniverse: ['FAST', 'SLOW'],
    historicalContextDays: 10,
    gameType: 'FORWARD_SHADOW',
    marketDataset: { id: DATASET_ID, version: DATASET_VERSION, dbPath: marketDataDbPath },
  });
  if (!configResult.ok) throw new Error(configResult.reason);

  const state = game.initialize({
    config: configResult.value,
    participantIds: [PARTICIPANT_ID],
    rng: createRng(Buffer.alloc(16, 7)),
  });

  const record: ForwardMatchRecord = {
    matchId: 'test-match-1',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: configResult.value,
    participantIds: [PARTICIPANT_ID],
    matchSeed: '01'.repeat(16),
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    status: 'active',
    roundsPlayed: 0,
    snapshot: serializeForwardState(state),
  };
  const saved = await saveForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), record);
  if (!saved.ok) throw new Error(saved.reason);

  const app = createApp(rootDir);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => {
      resolve(s);
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  rmSync(rootDir, { recursive: true, force: true });
});

describe('GET /api/forward-matches', () => {
  it('lists the recorded match', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: { matchId: string; status: string }[] };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ matchId: 'test-match-1', status: 'active' });
  });
});

describe('GET /api/forward-matches/:matchId', () => {
  it('resumes the match (no Docker) and returns real standings', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/test-match-1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matchId: string;
      marketDataUniverse: string[];
      equityHistoryByParticipant: Record<string, { date: string; equityCents: number }[]>;
      standings: { standings: { participantId: string; equityCents: number; cashCents: number }[] };
    };
    expect(body.matchId).toBe('test-match-1');
    // The bot's full tracked universe, not just what it currently holds a position in — this
    // fixture's config trades FAST/SLOW, but never places an order (see below), so both should
    // still be reported here even though neither ever becomes a real position.
    expect(body.marketDataUniverse).toEqual(['FAST', 'SLOW']);
    expect(body.standings.standings).toHaveLength(1);
    const [standing] = body.standings.standings;
    expect(standing?.participantId).toBe(PARTICIPANT_ID);
    // No orders were ever placed, so equity should still equal the untouched starting cash.
    expect(standing?.equityCents).toBe(standing?.cashCents);
    expect(standing?.equityCents).toBeGreaterThan(0);
    // The per-round equity curve — just the match-start point here (no rounds resolved yet), but
    // present and matching the current (untouched) equity.
    const history = body.equityHistoryByParticipant[PARTICIPANT_ID];
    expect(history).toHaveLength(1);
    expect(history?.[0]?.equityCents).toBe(standing?.equityCents);
  });
});

describe('POST /api/forward-matches/:matchId/run (validation paths, no Docker touched)', () => {
  it('404s for a match that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/no-such-match/run`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('409s for a match that is no longer active', async () => {
    const record: ForwardMatchRecord = {
      matchId: 'completed-match',
      gameId: 'stock-market-4',
      gameVersion: '0.1.0',
      config: { gameType: 'FORWARD_SHADOW' },
      participantIds: [PARTICIPANT_ID],
      matchSeed: '02'.repeat(16),
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
      status: 'completed',
      roundsPlayed: 5,
      snapshot: { round: 5 },
    };
    const saved = await saveForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), record);
    expect(saved.ok).toBe(true);

    const res = await fetch(`${baseUrl}/api/forward-matches/completed-match/run`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/forward-matches/:matchId/end', () => {
  it('404s for a match that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/no-such-match/end`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('409s for a match that is no longer active', async () => {
    const record: ForwardMatchRecord = {
      matchId: 'already-completed',
      gameId: 'stock-market-4',
      gameVersion: '0.1.0',
      config: { gameType: 'FORWARD_SHADOW' },
      participantIds: [PARTICIPANT_ID],
      matchSeed: '02'.repeat(16),
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
      status: 'completed',
      roundsPlayed: 5,
      snapshot: { round: 5 },
    };
    const saved = await saveForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), record);
    expect(saved.ok).toBe(true);

    const res = await fetch(`${baseUrl}/api/forward-matches/already-completed/end`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/forward-matches/:matchId/preview (validation paths, no Docker touched)', () => {
  it('404s for a match that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/no-such-match/preview`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it("422s for a match whose config isn't FORWARD_SHADOW-shaped", async () => {
    const record: ForwardMatchRecord = {
      matchId: 'not-forward-shadow',
      gameId: 'stock-market-4',
      gameVersion: '0.1.0',
      config: { gameType: 'HISTORICAL' },
      participantIds: [PARTICIPANT_ID],
      matchSeed: '03'.repeat(16),
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
      status: 'active',
      roundsPlayed: 0,
      snapshot: { round: 0 },
    };
    const saved = await saveForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), record);
    expect(saved.ok).toBe(true);

    const res = await fetch(`${baseUrl}/api/forward-matches/not-forward-shadow/preview`, {
      method: 'POST',
    });
    expect(res.status).toBe(422);
  });

  it('400s when participantId is given but not a string', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/test-match-1/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantId: 42 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/market-data/status', () => {
  it("reports freshness for the active match's tracked tickers", async () => {
    const res = await fetch(`${baseUrl}/api/market-data/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      datasets: { id: string; version: string; tickers: { ticker: string; status: string }[] }[];
    };
    expect(body.datasets).toHaveLength(1);
    expect(body.datasets[0]).toMatchObject({ id: DATASET_ID, version: DATASET_VERSION });
    const tickers = body.datasets[0]?.tickers.map((t) => t.ticker).sort();
    expect(tickers).toEqual(['FAST', 'SLOW']);
    expect(body.datasets[0]?.tickers.every((t) => t.status === 'current')).toBe(true);
  });
});

describe('GET /api/forward-matches/:matchId/audit', () => {
  it('returns recorded audit entries, filterable by participant', async () => {
    const recorded = recordRoundAudit(defaultForwardMatchStoreDbPath(rootDir), [
      {
        matchId: 'test-match-1',
        roundIndex: 0,
        participantId: PARTICIPANT_ID,
        date: '2026-01-05',
        recordedAt: 'x',
        collection: 'ok',
        action: { orders: [] },
      },
      {
        matchId: 'test-match-1',
        roundIndex: 0,
        participantId: 'other',
        recordedAt: 'x',
        collection: 'timeout',
      },
    ]);
    expect(recorded.ok).toBe(true);
    const all = (await (
      await fetch(`${baseUrl}/api/forward-matches/test-match-1/audit`)
    ).json()) as { entries: unknown[] };
    expect(all.entries).toHaveLength(2);
    const one = (await (
      await fetch(
        `${baseUrl}/api/forward-matches/test-match-1/audit?participantId=${PARTICIPANT_ID}`,
      )
    ).json()) as { entries: { participantId: string; action: unknown }[] };
    expect(one.entries).toEqual([
      expect.objectContaining({ participantId: PARTICIPANT_ID, action: { orders: [] } }),
    ]);
  });
});
