import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  deleteForwardMatchRecords,
  listForwardMatchRecords,
  listRoundAudit,
  loadForwardMatchRecord,
} from '@quant-fusion/forward-match-store';
import {
  game,
  getCurrentStandings,
  isForwardMatchFullyResolved,
  resumeForwardState,
} from '@quant-fusion/game-stock-market-4';
import { emitFreshForwardConfig, withStoredExecution } from '../lib/emitForwardConfig.js';
import { readForwardShadowFields } from '../lib/forwardShadowConfig.js';
import { defaultForwardMatchStoreDbPath } from '../lib/paths.js';
import { parseQuantDecisions } from '../lib/parseQuantDecisions.js';
import { parsePreviewMoves } from '../lib/parsePreviewMoves.js';
import { dailyCycleHistoryJobId, startDailyCycleJob } from '../lib/dailyCycle.js';
import { isDetachedJobRunning } from '../lib/detachedJobs.js';
import { runAsLiveJob } from '../lib/jobRunner.js';
import { isLocked, runCli, withLock } from '../lib/subprocess.js';

/** Matches `games/stock-market-4/manifest.json`'s `id` — hardcoded rather than resolved through
 * `@quant-fusion/registry` since this whole package is already SM4-specific (see this repo's
 * `packages/README.md`: nothing about "which game" is generic here). */
const STOCK_MARKET_4_GAME_ID = 'stock-market-4';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The two plain date fields `readForwardShadowFields` doesn't already extract (that helper's own
 * two callers, this route's own GET and `/api/market-data/status`, never needed them before now —
 * only a fresh `emit:forward-config` call for preview does). */
function readStartEndDate(config: unknown): { startDate: string; endDate: string } | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const c = config as Record<string, unknown>;
  if (typeof c.startDate !== 'string' || typeof c.endDate !== 'string') return undefined;
  return { startDate: c.startDate, endDate: c.endDate };
}

export function createForwardMatchesRouter(rootDir: string): Router {
  const router = createRouter();
  const dbPath = defaultForwardMatchStoreDbPath(rootDir);

  router.get('/', (_req: Request, res: Response) => {
    listForwardMatchRecords(dbPath)
      .then(({ summaries, issues }) => {
        res.json({ matches: summaries, issues });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Permanent: `?inactive=true` deletes every non-active match (ended/completed/forfeited); an
  // active match is only ever deleted by id, deliberately.
  router.delete('/', (req: Request, res: Response) => {
    if (req.query.inactive !== 'true') {
      res.status(400).json({ error: 'DELETE /api/forward-matches requires ?inactive=true.' });
      return;
    }
    void deleteForwardMatchRecords(dbPath).then((result) => {
      if (!result.ok) res.status(500).json({ error: result.reason });
      else res.json({ deletedMatchIds: result.value });
    });
  });

  router.delete('/:matchId', (req: Request, res: Response) => {
    const matchId = String(req.params.matchId);
    if (isLocked(`run:${matchId}`)) {
      res.status(409).json({ error: `"${matchId}" is busy (a run/preview/end is in progress).` });
      return;
    }
    void (async () => {
      if (await isDetachedJobRunning(rootDir, `run:${matchId}`)) {
        res.status(409).json({ error: `"${matchId}" is busy (a daily cycle is in progress).` });
        return;
      }
      const result = await deleteForwardMatchRecords(dbPath, matchId);
      if (!result.ok) res.status(500).json({ error: result.reason });
      else if (result.value.length === 0)
        res.status(404).json({ error: `No forward match "${matchId}".` });
      else res.json({ deletedMatchIds: result.value });
    })();
  });

  router.get('/:matchId', (req: Request, res: Response) => {
    const { matchId } = req.params;
    if (matchId === undefined) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }
    loadForwardMatchRecord(dbPath, matchId)
      .then((outcome) => {
        if (outcome.status === 'not-found') {
          res.status(404).json({ error: `No forward match record found for "${matchId}".` });
          return;
        }
        if (outcome.status === 'corrupt') {
          res.status(500).json({ error: outcome.reason });
          return;
        }
        const { record } = outcome;
        if (record.gameId !== STOCK_MARKET_4_GAME_ID) {
          res.status(409).json({
            error:
              `Forward match "${matchId}" was created for game "${record.gameId}", not ` +
              `"${STOCK_MARKET_4_GAME_ID}".`,
          });
          return;
        }
        const configResult = game.parseConfig(record.config);
        if (!configResult.ok) {
          res.status(422).json({
            error: `Stored config for "${matchId}" is no longer valid: ${configResult.reason}`,
          });
          return;
        }
        const state = resumeForwardState({
          config: configResult.value,
          participantIds: record.participantIds,
          snapshot: record.snapshot,
        });
        const standings = getCurrentStandings(state);
        // The bot's own tracked-security universe (from its config, not from what it happens to
        // currently hold) — lets a consumer show every ticker it's ALLOWED to trade, not just
        // the ones it currently has a nonzero position in (see `standings.standings[].positions`,
        // which — correctly — only ever lists real, current holdings).
        const marketDataUniverse = readForwardShadowFields(record.config)?.marketDataUniverse ?? [];
        // Per-participant equity curve, oldest first — one entry at match start plus one more
        // per round resolved so far (see `StockMarket4State.equityHistory`'s own doc comment).
        // `getCurrentStandings` only returns metrics ALREADY COMPUTED from this (Sharpe, max
        // drawdown, ...), never the series itself, so it's read directly off the resumed state
        // here instead — the one piece of real historical data this route can offer beyond a
        // single current snapshot.
        const equityHistoryByParticipant = Object.fromEntries(
          record.participantIds.map((id) => [id, state.equityHistory.get(id) ?? []]),
        );
        res.json({
          matchId: record.matchId,
          gameId: record.gameId,
          gameVersion: record.gameVersion,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          roundsPlayed: record.roundsPlayed,
          participantIds: record.participantIds,
          forfeitedParticipantIds: record.forfeitedParticipantIds,
          fullyResolved: isForwardMatchFullyResolved(state),
          marketDataUniverse,
          equityHistoryByParticipant,
          standings,
        });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // --- Mutating actions (Phase B — see docs/adr/0015-quant-fusion-ui-read-api.md's Phase B
  // note). Both spawn `apps/cli`'s own, already-tested commands as a child process rather than
  // re-implementing Docker/game execution here — see `../lib/subprocess.ts`'s own doc comment.

  router.post('/:matchId/run', (req: Request, res: Response) => {
    const { matchId } = req.params;
    if (matchId === undefined) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }
    const lockKey = `run:${matchId}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: `A run is already in progress for "${matchId}".` });
      return;
    }

    (async () => {
      const outcome = await loadForwardMatchRecord(dbPath, matchId);
      if (outcome.status === 'not-found') {
        res.status(404).json({ error: `No forward match record found for "${matchId}".` });
        return;
      }
      if (outcome.status === 'corrupt') {
        res.status(500).json({ error: outcome.reason });
        return;
      }
      if (outcome.record.status !== 'active') {
        res.status(409).json({ error: `"${matchId}" is already ${outcome.record.status}.` });
        return;
      }
      if (await isDetachedJobRunning(rootDir, lockKey)) {
        res.status(409).json({ error: `A daily cycle is already running for "${matchId}".` });
        return;
      }
      const result = await withLock(lockKey, () =>
        runAsLiveJob(rootDir, { kind: 'run', label: `Run next round · ${matchId}` }, () =>
          runCli(rootDir, ['match', 'forward', 'run', matchId, ...outcome.record.participantIds]),
        ),
      );
      res.json({ ...result, decisions: parseQuantDecisions(result.output) });
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  router.post('/:matchId/end', (req: Request, res: Response) => {
    const { matchId } = req.params;
    if (matchId === undefined) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }
    const lockKey = `run:${matchId}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: `A run is already in progress for "${matchId}".` });
      return;
    }

    (async () => {
      const outcome = await loadForwardMatchRecord(dbPath, matchId);
      if (outcome.status === 'not-found') {
        res.status(404).json({ error: `No forward match record found for "${matchId}".` });
        return;
      }
      if (outcome.status === 'corrupt') {
        res.status(500).json({ error: outcome.reason });
        return;
      }
      if (outcome.record.status !== 'active') {
        res.status(409).json({ error: `"${matchId}" is already ${outcome.record.status}.` });
        return;
      }
      const result = await withLock(lockKey, () =>
        runCli(rootDir, ['match', 'forward', 'end', matchId]),
      );
      res.json(result);
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  // The decision audit trail — one entry per (round, participant), newest first: what each bot
  // submitted, the fills it got, its equity afterward, the code/config it ran, and its own
  // rationale. Written by `match forward run`; empty for rounds played before it existed.
  router.get('/:matchId/audit', (req: Request, res: Response) => {
    const participantId =
      typeof req.query.participantId === 'string' && req.query.participantId !== ''
        ? req.query.participantId
        : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      res.status(400).json({ error: '"limit", when given, must be a positive integer.' });
      return;
    }
    const result = listRoundAudit(dbPath, String(req.params.matchId), {
      ...(participantId !== undefined ? { participantId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    if (!result.ok) res.status(500).json({ error: result.reason });
    else res.json({ entries: result.value });
  });

  // Each participant's pin state (pinned/drifted/unpinned) — via `apps/cli`'s own
  // `match forward pin-status --json`, the same hash `match forward run` checks on resume.
  router.get('/:matchId/pin-status', (req: Request, res: Response) => {
    const matchId = String(req.params.matchId);
    runCli(rootDir, ['match', 'forward', 'pin-status', matchId, '--json'])
      .then((result) => {
        if (!result.ok) {
          res.status(result.output.includes('No forward match') ? 404 : 500).json({
            error: result.output.trim(),
          });
          return;
        }
        res.json(JSON.parse(result.stdout.trim()) as unknown);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Fetch prices → check pins → run every newly available round, as ONE background job (see
  // `lib/dailyCycle.ts`). Returns immediately with the job's id; the UI polls
  // `/api/jobs/live/:jobId` for its streaming log. Detached (see `lib/detachedJobs.ts`) because the
  // price fetch's rebuild restarts this API under `tsx watch`.
  router.post('/:matchId/daily-cycle', (req: Request, res: Response) => {
    const matchId = String(req.params.matchId);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;
    if (
      (body.repin !== undefined && typeof body.repin !== 'boolean') ||
      (body.skipFetch !== undefined && typeof body.skipFetch !== 'boolean')
    ) {
      res.status(400).json({ error: '"repin" and "skipFetch", when given, must be booleans.' });
      return;
    }
    const lockKey = `run:${matchId}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: `A run is already in progress for "${matchId}".` });
      return;
    }

    void withLock(lockKey, async () => {
      if (await isDetachedJobRunning(rootDir, lockKey)) {
        res.status(409).json({ error: `A daily cycle is already running for "${matchId}".` });
        return;
      }
      const outcome = await loadForwardMatchRecord(dbPath, matchId);
      if (outcome.status === 'not-found') {
        res.status(404).json({ error: `No forward match record found for "${matchId}".` });
        return;
      }
      if (outcome.status === 'corrupt') {
        res.status(500).json({ error: outcome.reason });
        return;
      }
      if (outcome.record.status !== 'active') {
        res.status(409).json({ error: `"${matchId}" is already ${outcome.record.status}.` });
        return;
      }
      const job = await startDailyCycleJob(rootDir, matchId, {
        repin: body.repin === true,
        skipFetch: body.skipFetch === true,
      });
      res.status(202).json({ jobId: job.id, historyJobId: dailyCycleHistoryJobId(matchId) });
    }).catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  router.post('/:matchId/preview', (req: Request, res: Response) => {
    const { matchId } = req.params;
    if (matchId === undefined) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }
    // Optional: restricts the preview to one bot's own row (the Fleet tab's per-bot button) —
    // omitted, the Matches panel's own button previews every participant in the match.
    const participantId =
      typeof req.body === 'object' && req.body !== null
        ? (req.body as Record<string, unknown>).participantId
        : undefined;
    if (participantId !== undefined && typeof participantId !== 'string') {
      res.status(400).json({ error: 'participantId, when given, must be a string.' });
      return;
    }
    const lockKey = `preview:${matchId}:${participantId ?? 'all'}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: `A preview is already in progress for "${matchId}".` });
      return;
    }

    (async () => {
      const outcome = await loadForwardMatchRecord(dbPath, matchId);
      if (outcome.status === 'not-found') {
        res.status(404).json({ error: `No forward match record found for "${matchId}".` });
        return;
      }
      if (outcome.status === 'corrupt') {
        res.status(500).json({ error: outcome.reason });
        return;
      }
      const { record } = outcome;
      const fields = readForwardShadowFields(record.config);
      const dates = readStartEndDate(record.config);
      if (fields === undefined || dates === undefined) {
        res.status(422).json({
          error: `"${matchId}" isn't a FORWARD_SHADOW match (no marketDataUniverse/marketDataset/startDate/endDate) — preview isn't meaningful for it.`,
        });
        return;
      }

      const fresh = await emitFreshForwardConfig(rootDir, {
        marketDataset: fields.marketDataset,
        marketDataUniverse: fields.marketDataUniverse,
        startDate: dates.startDate,
        endDate: dates.endDate,
        execution: 'legacy', // replaced by this match's own stored execution just below
      });
      if (!fresh.ok) {
        res.status(500).json({ error: fresh.error });
        return;
      }

      const tempDir = await mkdtemp(path.join(tmpdir(), 'sm4-preview-'));
      try {
        const configPath = path.join(tempDir, 'config.json');
        await writeFile(
          configPath,
          JSON.stringify(withStoredExecution(fresh.config, record.config)),
          'utf8',
        );
        const result = await withLock(lockKey, () =>
          runAsLiveJob(rootDir, { kind: 'preview', label: `Preview · ${matchId}` }, () =>
            runCli(rootDir, [
              'match',
              'forward',
              'preview',
              matchId,
              '--config-file',
              configPath,
              ...(participantId !== undefined ? ['--participant', participantId] : []),
            ]),
          ),
        );
        res.json({
          ...result,
          decisions: parseQuantDecisions(result.output),
          moves: parsePreviewMoves(result.output),
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  return router;
}
