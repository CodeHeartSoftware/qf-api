import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let rootDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'sm4-api-app-'));
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

describe('createApp', () => {
  it('answers /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers /api/bots with an empty registry for a rootDir with no bots/ directory', async () => {
    const res = await fetch(`${baseUrl}/api/bots`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bots: [] });
  });

  it('answers /api/forward-matches with an empty list when nothing has been recorded yet', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [], issues: [] });
  });

  it('answers /api/forward-matches/:matchId with 404 for an unknown match', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('answers /api/research with every registered research domain', async () => {
    const res = await fetch(`${baseUrl}/api/research`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domains: { domain: string; entityCount: number; priority: number }[];
    };
    const fusion = body.domains.find((d) => d.domain === 'fusion');
    expect(fusion?.entityCount).toBeGreaterThan(0);
    expect(body.domains.some((d) => d.domain === 'quantum')).toBe(true);
  });

  it('answers /api/research with fusion sorted ahead of quantum by priority', async () => {
    const res = await fetch(`${baseUrl}/api/research`);
    const body = (await res.json()) as { domains: { domain: string; priority: number }[] };
    const fusionIndex = body.domains.findIndex((d) => d.domain === 'fusion');
    const quantumIndex = body.domains.findIndex((d) => d.domain === 'quantum');
    expect(fusionIndex).toBeLessThan(quantumIndex);
    expect(body.domains[fusionIndex]?.priority).toBeGreaterThan(
      body.domains[quantumIndex]?.priority ?? 0,
    );
  });

  it("answers /api/research/:domain with that domain's real dataset", async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataset: { domain: string; entities: unknown[] } };
    expect(body.dataset.domain).toBe('fusion');
    expect(body.dataset.entities.length).toBeGreaterThan(0);
  });

  it('answers /api/research/:domain with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/research/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('answers POST /api/research/fusion/apply-update with 400 for a non-object body', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/apply-update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['not', 'an', 'object']),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/research/domains with 400 when "name" is missing', async () => {
    const res = await fetch(`${baseUrl}/api/research/domains`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/research/domains with 400 for a non-object body', async () => {
    const res = await fetch(`${baseUrl}/api/research/domains`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('not an object'),
    });
    expect(res.status).toBe(400);
  });

  it("answers /api/research/:domain/tickers with that domain's real news watchlist", async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/tickers`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickers: { ticker: string; companyName: string }[] };
    expect(body.tickers.some((t) => t.ticker === 'ELMT')).toBe(true);
  });

  it('answers /api/research/:domain/tickers with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/research/does-not-exist/tickers`);
    expect(res.status).toBe(404);
  });

  it('answers /api/research/quantum/tickers with an empty watchlist (no tickers tracked)', async () => {
    const res = await fetch(`${baseUrl}/api/research/quantum/tickers`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tickers: [] });
  });

  it('answers POST /api/research/:domain/tickers with 400 for a missing ticker/companyName', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/tickers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticker: 'NVDA' }),
    });
    expect(res.status).toBe(400);
  });

  it("answers /api/research/:domain/event-types with that domain's registered event types", async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/event-types`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      eventTypes: { type: string; addedAt: string; eventCount: number }[];
    };
    expect(body.eventTypes.length).toBeGreaterThan(0);
    expect(body.eventTypes.every((t) => t.eventCount >= 1)).toBe(true);
  });

  it('answers /api/research/:domain/event-types with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/research/does-not-exist/event-types`);
    expect(res.status).toBe(404);
  });

  it('answers /api/research/quantum/event-types with an empty list (no events)', async () => {
    const res = await fetch(`${baseUrl}/api/research/quantum/event-types`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ eventTypes: [] });
  });

  it('answers POST /api/research/:domain/event-types with 400 for a missing "type"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/event-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers PATCH /api/research/:domain/event-types/:type with 400 for a missing "newType"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/event-types/ORDER_ANNOUNCED`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("answers /api/research/:domain/entity-types with that domain's registered entity types", async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/entity-types`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entityTypes: { type: string; addedAt: string; entityCount: number }[];
    };
    expect(body.entityTypes.length).toBeGreaterThan(0);
    expect(body.entityTypes.every((t) => t.entityCount >= 1)).toBe(true);
  });

  it('answers /api/research/:domain/entity-types with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/research/does-not-exist/entity-types`);
    expect(res.status).toBe(404);
  });

  it('answers POST /api/research/:domain/entity-types with 400 for a missing "type"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/entity-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers PATCH /api/research/:domain/entity-types/:type with 400 for a missing "newType"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/entity-types/company`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("answers /api/research/:domain/relationship-types with that domain's registered relationship types", async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/relationship-types`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      relationshipTypes: { type: string; addedAt: string; relationshipCount: number }[];
    };
    expect(body.relationshipTypes.length).toBeGreaterThan(0);
    // A registered type can be unused (e.g. "equity stake acquisition" after 0093 removed its only
    // relationship), but the seed's types are — and every count is a real non-negative tally.
    expect(
      body.relationshipTypes.every(
        (t) => Number.isInteger(t.relationshipCount) && t.relationshipCount >= 0,
      ),
    ).toBe(true);
    expect(body.relationshipTypes.some((t) => t.relationshipCount >= 1)).toBe(true);
  });

  it('answers /api/research/:domain/relationship-types with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/research/does-not-exist/relationship-types`);
    expect(res.status).toBe(404);
  });

  it('answers POST /api/research/:domain/relationship-types with 400 for a missing "type"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/relationship-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers PATCH /api/research/:domain/relationship-types/:type with 400 for a missing "newType"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/relationship-types/supplies`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers PATCH /api/research/:domain/relationship-types/:type/category with 400 for a missing "category"', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/relationship-types/supplies/category`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers PATCH /api/research/:domain/relationship-types/:type/category with 400 for a category outside the fixed enum', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/relationship-types/supplies/category`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'supply chain' }),
    });
    expect(res.status).toBe(400);
  });

  it('answers /api/research/:domain/exposure/:entityId with the real exposure map (no extra fields)', async () => {
    const res = await fetch(`${baseUrl}/api/research/fusion/exposure/entity-arc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exposure: { targetEntityId: string } };
    expect(body.exposure.targetEntityId).toBe('entity-arc');
  });

  it('answers /api/news/:domain with a feed scoped to that domain (fusion has tracked tickers)', async () => {
    const res = await fetch(`${baseUrl}/api/news/fusion`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feeds: { ticker: string }[] };
    expect(body.feeds.length).toBe(11);
  });

  it('answers /api/news/:domain with an empty feed list for a domain with no tracked tickers', async () => {
    const res = await fetch(`${baseUrl}/api/news/quantum`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ feeds: [] });
  });

  it('answers /api/news/:domain with 404 for an unknown domain', async () => {
    const res = await fetch(`${baseUrl}/api/news/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('answers /api/market-data/status with no datasets when no matches are recorded', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { datasets: unknown[]; research: { datasetId: string } };
    expect(body.datasets).toEqual([]);
    expect(body.research.datasetId).toContain('dataset-fusion');
  });

  it('refuses a bulk DELETE /api/forward-matches without ?inactive=true', async () => {
    const res = await fetch(`${baseUrl}/api/forward-matches`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/matches/forward with 400 for a non-object body', async () => {
    const res = await fetch(`${baseUrl}/api/matches/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/matches/forward with 400 for an empty "participantIds"', async () => {
    const res = await fetch(`${baseUrl}/api/matches/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantIds: [],
        universeId: 'fusion',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/matches/forward with 400 when endDate is not after startDate', async () => {
    const res = await fetch(`${baseUrl}/api/matches/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantIds: ['quant-v0'],
        universeId: 'fusion',
        startDate: '2026-02-01',
        endDate: '2026-01-01',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/matches/forward with 400 for an unknown universeId', async () => {
    const res = await fetch(`${baseUrl}/api/matches/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantIds: ['quant-v0'],
        universeId: 'does-not-exist',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/matches/forward with 400 for an unknown "execution"', async () => {
    const res = await fetch(`${baseUrl}/api/matches/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantIds: ['quant-v0'],
        universeId: 'fusion',
        startDate: '2026-01-02',
        endDate: '2026-12-31',
        execution: 'instant',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/"execution"/);
  });

  it('answers POST /api/matches/historical with the same validation as /forward', async () => {
    const res = await fetch(`${baseUrl}/api/matches/historical`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('answers a CORS preflight for a Phase B POST action with the headers the browser requires', async () => {
    // Regression test: a bare `Access-Control-Allow-Origin` (no Allow-Methods/Allow-Headers, no
    // explicit OPTIONS handling) passes a plain GET but silently fails every POST action's
    // preflight in a real browser — `fetch` with a JSON body isn't CORS-simple. `curl`/`fetch`
    // from Node (used everywhere else in this suite) never sends a preflight at all, so this is
    // the one test in the file that actually exercises it.
    const res = await fetch(`${baseUrl}/api/forward-matches/some-match/run`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5420',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'content-type',
    );
  });

  it('answers a CORS preflight for a DELETE action (tracked-ticker removal) with DELETE allowed', async () => {
    // Regression test: DELETE was added alongside `research.ts`'s tracked-ticker removal route
    // but missed in this middleware's own Allow-Methods list — see `app.ts`'s own comment.
    const res = await fetch(`${baseUrl}/api/research/fusion/tickers/ELMT`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5420',
        'Access-Control-Request-Method': 'DELETE',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
  });

  it('answers a CORS preflight for a PATCH action (event-type rename) with PATCH allowed', async () => {
    // Regression test: PATCH was added alongside `research.ts`'s event-type rename route but
    // missed in this middleware's own Allow-Methods list — see `app.ts`'s own comment.
    const res = await fetch(`${baseUrl}/api/research/fusion/event-types/ORDER_ANNOUNCED`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5420',
        'Access-Control-Request-Method': 'PATCH',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  it('answers /api/market-data/universes with the real fusion universe', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/universes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      universes: { id: string; game: string; jobId: string; tickers: string[] }[];
    };
    const fusion = body.universes.find((u) => u.id === 'fusion');
    expect(fusion?.game).toBe('stock-market-4');
    expect(fusion?.jobId).toBe('market-data-fetch:fusion');
    expect(fusion?.tickers).toContain('ELMT');
  });

  it('answers POST /api/market-data/universes with 400 for a non-object body', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/market-data/universes with 400 for an unknown baseUniverseId', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'my-universe',
        label: 'My Universe',
        baseUniverseId: 'does-not-exist',
        tickers: ['ELMT'],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/market-data/universes with 400 for a ticker not in the base universe', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'my-universe',
        label: 'My Universe',
        baseUniverseId: 'fusion',
        tickers: ['NOT_A_REAL_TICKER'],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('creates a custom universe as a ticker subset of an existing one, and it shows up in GET /universes', async () => {
    const createRes = await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'my-universe',
        label: 'My Universe',
        baseUniverseId: 'fusion',
        tickers: ['ELMT', 'AMSC'],
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { universe: { id: string; datasetId: string } };
    expect(created.universe.id).toBe('my-universe');
    expect(created.universe.datasetId).toBe('fusion-fundamental-v0');

    const listRes = await fetch(`${baseUrl}/api/market-data/universes`);
    const body = (await listRes.json()) as { universes: { id: string; tickers: string[] }[] };
    const mine = body.universes.find((u) => u.id === 'my-universe');
    expect(mine?.tickers).toEqual(['ELMT', 'AMSC']);
  });

  it('answers POST /api/market-data/universes with 409 for an id that already exists', async () => {
    await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'dup-universe',
        label: 'Dup',
        baseUniverseId: 'fusion',
        tickers: ['ELMT'],
      }),
    });
    const res = await fetch(`${baseUrl}/api/market-data/universes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'dup-universe',
        label: 'Dup Again',
        baseUniverseId: 'fusion',
        tickers: ['AMSC'],
      }),
    });
    expect(res.status).toBe(409);
  });

  it('answers POST /api/market-data/fetch/:universeId with 404 for an unknown universe', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/fetch/does-not-exist`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('answers GET /api/market-data/tickers with 400 when datasetId/datasetVersion query params are missing', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/tickers`);
    expect(res.status).toBe(400);
  });

  it('answers GET /api/market-data/tickers with an empty list for a rootDir with no published data', async () => {
    const res = await fetch(
      `${baseUrl}/api/market-data/tickers?datasetId=fusion-fundamental-v0&datasetVersion=3`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tickers: [] });
  });

  it('answers POST /api/market-data/tickers with 400 for a non-object body', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/tickers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/market-data/tickers with 400 for a missing "ticker" field', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/tickers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ datasetId: 'fusion-fundamental-v0', datasetVersion: '3' }),
    });
    expect(res.status).toBe(400);
  });

  it('answers POST /api/market-data/tickers with 400 for a non-positive "usdRate"', async () => {
    const res = await fetch(`${baseUrl}/api/market-data/tickers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'fusion-fundamental-v0',
        datasetVersion: '3',
        ticker: 'NVDA',
        usdRate: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('answers /api/jobs/:jobId/runs with an empty list for a job that has never run', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/never-run-anywhere/runs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  it('answers /api/jobs/:jobId/runs with 400 for a non-numeric limit', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/some-job/runs?limit=abc`);
    expect(res.status).toBe(400);
  });
});
