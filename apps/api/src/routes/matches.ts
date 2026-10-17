import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { resolveMarketUniverse } from '../lib/customUniverses.js';
import { emitFreshForwardConfig, type MatchExecutionMode } from '../lib/emitForwardConfig.js';
import { defaultForwardMatchStoreDbPath } from '../lib/paths.js';
import { parseQuantDecisions } from '../lib/parseQuantDecisions.js';
import { runAsLiveJob } from '../lib/jobRunner.js';
import { isLocked, runCli, withLock } from '../lib/subprocess.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CreateMatchBody {
  participantIds: string[];
  universeId: string;
  startDate: string;
  endDate: string;
  execution: MatchExecutionMode;
}

function parseCreateMatchBody(
  body: unknown,
): { ok: true; value: CreateMatchBody } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const { participantIds, universeId, startDate, endDate, execution } = body as Record<
    string,
    unknown
  >;
  if (
    !Array.isArray(participantIds) ||
    participantIds.length === 0 ||
    !participantIds.every((id): id is string => typeof id === 'string' && id.trim() !== '')
  ) {
    return {
      ok: false,
      error: 'Request body must include a non-empty "participantIds" array of strings.',
    };
  }
  if (typeof universeId !== 'string' || universeId.trim() === '') {
    return { ok: false, error: 'Request body must include a non-empty "universeId" string.' };
  }
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || startDate >= endDate) {
    return {
      ok: false,
      error: '"startDate" and "endDate" must be strings with startDate before endDate.',
    };
  }
  if (execution !== undefined && execution !== 'realistic' && execution !== 'legacy') {
    return { ok: false, error: '"execution" must be "realistic" or "legacy" when given.' };
  }
  return {
    ok: true,
    value: { participantIds, universeId, startDate, endDate, execution: execution ?? 'realistic' },
  };
}

/** Both routes below build a fresh `stock-market-4` config against the CURRENT research fixture
 * (`emitFreshForwardConfig` — the same helper `/preview` already uses) and a chosen
 * `MARKET_UNIVERSES` entry, then spawn `apps/cli`'s own already-tested commands — never
 * re-implementing match creation here. "Synthetic" `gameType` is deliberately not offered by
 * either route (no UI path produces it) — out of scope for now, per this feature's own ask. */
export function createMatchesRouter(rootDir: string): Router {
  const router = createRouter();

  router.post('/historical', (req: Request, res: Response) => {
    const parsed = parseCreateMatchBody(req.body as unknown);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { participantIds, universeId, startDate, endDate, execution } = parsed.value;
    const lockKey = `create-historical:${participantIds.join(',')}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'A match is already being created for these participants.' });
      return;
    }

    (async () => {
      const universe = await resolveMarketUniverse(rootDir, universeId);
      if (universe === undefined) {
        res.status(400).json({ error: `Unknown universeId "${universeId}".` });
        return;
      }
      const fresh = await emitFreshForwardConfig(rootDir, {
        marketDataset: {
          id: universe.datasetId,
          version: universe.datasetVersion,
          dbPath: defaultForwardMatchStoreDbPath(rootDir),
        },
        marketDataUniverse: [...universe.tickers],
        startDate,
        endDate,
        execution,
      });
      if (!fresh.ok) {
        res.status(500).json({ error: fresh.error });
        return;
      }
      // `emitFreshForwardConfig` always bakes in `gameType: 'FORWARD_SHADOW'` (it's the only mode
      // its underlying script emits) — overridden here rather than in that script, since a
      // HISTORICAL match wants the exact same dataset/universe/research-timeline wiring, just
      // played to completion in one `match run` instead of resumed round by round.
      const config = { ...(fresh.config as Record<string, unknown>), gameType: 'HISTORICAL' };

      const tempDir = await mkdtemp(path.join(tmpdir(), 'sm4-create-historical-'));
      try {
        const configPath = path.join(tempDir, 'config.json');
        await writeFile(configPath, JSON.stringify(config), 'utf8');
        const result = await withLock(lockKey, () =>
          runAsLiveJob(
            rootDir,
            { kind: 'create-historical', label: `Historical match · ${universeId}` },
            () => runCli(rootDir, ['match', 'run', ...participantIds, '--config-file', configPath]),
          ),
        );
        res.json({ ...result, decisions: parseQuantDecisions(result.output) });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  router.post('/forward', (req: Request, res: Response) => {
    const parsed = parseCreateMatchBody(req.body as unknown);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { participantIds, universeId, startDate, endDate, execution } = parsed.value;
    // Human-decipherable rather than a bare UUID — this app is a single-developer local tool, so
    // "which universe, which window, created when" being readable straight off the id (e.g. in
    // the match switcher) is worth more here than global uniqueness guarantees a UUID would give.
    const matchId = `${universeId}-${startDate}-${Date.now().toString(36)}`;
    const lockKey = `create-forward:${matchId}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'A match is already being created.' });
      return;
    }

    (async () => {
      const universe = await resolveMarketUniverse(rootDir, universeId);
      if (universe === undefined) {
        res.status(400).json({ error: `Unknown universeId "${universeId}".` });
        return;
      }
      const fresh = await emitFreshForwardConfig(rootDir, {
        marketDataset: {
          id: universe.datasetId,
          version: universe.datasetVersion,
          dbPath: defaultForwardMatchStoreDbPath(rootDir),
        },
        marketDataUniverse: [...universe.tickers],
        startDate,
        endDate,
        execution,
      });
      if (!fresh.ok) {
        res.status(500).json({ error: fresh.error });
        return;
      }

      const tempDir = await mkdtemp(path.join(tmpdir(), 'sm4-create-forward-'));
      try {
        const configPath = path.join(tempDir, 'config.json');
        await writeFile(configPath, JSON.stringify(fresh.config), 'utf8');
        const result = await withLock(lockKey, () =>
          runAsLiveJob(
            rootDir,
            { kind: 'create-forward', label: `Create forward match · ${matchId}` },
            () =>
              runCli(rootDir, [
                'match',
                'forward',
                'run',
                matchId,
                ...participantIds,
                '--config-file',
                configPath,
              ]),
          ),
        );
        res.json({ ...result, decisions: parseQuantDecisions(result.output), matchId });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  return router;
}
