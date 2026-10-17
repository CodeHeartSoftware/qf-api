import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { listForwardMatchRecords, loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { recordJobRun } from '@quant-fusion/job-run-store';
import {
  createMarketDataStore,
  queryLatestKnownDate,
  queryTickers,
} from '@quant-fusion/market-data';
import { latestResearchDate } from '../lib/latestResearchDate.js';
import { loadResearchDataset } from '../lib/researchStore.js';
import { addNewTicker } from '../lib/addNewTicker.js';
import {
  addCustomUniverse,
  listAllMarketUniverses,
  resolveMarketUniverse,
} from '../lib/customUniverses.js';
import { readForwardShadowFields } from '../lib/forwardShadowConfig.js';
import { marketDataFetchJobId } from '../lib/marketUniverses.js';
import { fetchLatestPriceData } from '../lib/fetchLatestPriceData.js';
import { runAsLiveJob } from '../lib/jobRunner.js';
import { defaultForwardMatchStoreDbPath, defaultJobRunStoreDbPath } from '../lib/paths.js';
import { isLocked, withLock } from '../lib/subprocess.js';

export type TickerFreshnessStatus = 'current' | 'behind' | 'no-bars' | 'unmapped';

export interface TickerFreshness {
  ticker: string;
  latestKnownDate: string | null;
  status: TickerFreshnessStatus;
}

export interface DatasetFreshness {
  id: string;
  version: string;
  latestKnownDate: string | undefined;
  tickers: TickerFreshness[];
}

function latestPriceDatesByTicker(
  dbPath: string,
  id: string,
  version: string,
): Map<string, string | null> {
  const store = createMarketDataStore(dbPath);
  const identity = { id, version };
  const result = new Map<string, string | null>();
  for (const ticker of queryTickers(store, identity)) {
    result.set(ticker, queryLatestKnownDate(store, identity, ticker));
  }
  return result;
}

interface ActiveMarketDataset {
  id: string;
  version: string;
  /** Resolved absolute path — `fields.marketDataset.dbPath`, when a match's config sets one, is
   * repo-root-relative (see `emitForwardMatchConfig.ts`'s own comment on why). */
  dbPath: string;
  tickers: string[];
}

/** Every distinct market-data dataset (deduped by id+version+dbPath) at least one ACTIVE forward
 * match currently trades against, with every ticker any of them track — the same discovery
 * `matchForwardStatus`/`matchForwardRefresh` (`apps/cli`) already do, shared here by both the
 * freshness computation below and the `/fetch` action route (which needs the resolved `dbPath` a
 * plain freshness reading doesn't). */
async function discoverActiveMarketDatasets(rootDir: string): Promise<ActiveMarketDataset[]> {
  const dbPath = defaultForwardMatchStoreDbPath(rootDir);
  const { summaries } = await listForwardMatchRecords(dbPath);

  const byKey = new Map<string, ActiveMarketDataset>();
  for (const summary of summaries) {
    if (summary.status !== 'active') continue;
    const outcome = await loadForwardMatchRecord(dbPath, summary.matchId);
    if (outcome.status !== 'found') continue;
    const fields = readForwardShadowFields(outcome.record.config);
    if (fields === undefined) continue;

    const { id, version, dbPath: marketDbPath } = fields.marketDataset;
    // A match's config can carry an ABSOLUTE path baked in at whatever machine/environment
    // created it (see emitForwardMatchConfig.ts's own comment on why it's absolute, not
    // relative). That's still valid when this API runs on the same host, but resolves to nothing
    // when it runs in a container with a different filesystem root (`/app`, not
    // `/Users/...`) — fall back to this rootDir's own default db rather than silently treating
    // every ticker as "unmapped".
    const candidateDbPath =
      marketDbPath !== undefined ? path.resolve(rootDir, marketDbPath) : dbPath;
    const resolvedDbPath = existsSync(candidateDbPath) ? candidateDbPath : dbPath;
    const key = `${id}@${version}@${resolvedDbPath}`;

    const existing = byKey.get(key);
    if (existing !== undefined) {
      for (const ticker of fields.marketDataUniverse) {
        if (!existing.tickers.includes(ticker)) existing.tickers.push(ticker);
      }
      continue;
    }
    byKey.set(key, {
      id,
      version,
      dbPath: resolvedDbPath,
      tickers: [...fields.marketDataUniverse],
    });
  }
  return [...byKey.values()];
}

/** Mirrors `matchForwardStatus`'s own per-dataset freshness scan (every active forward match's
 * `marketDataset` + `marketDataUniverse`), reshaped into JSON instead of console lines. */
export async function computeMarketDataStatus(rootDir: string): Promise<{
  datasets: DatasetFreshness[];
  research: { datasetId: string; latestKnownDate: string | undefined };
}> {
  const activeDatasets = await discoverActiveMarketDatasets(rootDir);
  const datasets: DatasetFreshness[] = activeDatasets.map(({ id, version, dbPath, tickers: t }) => {
    let latestByTicker: Map<string, string | null>;
    try {
      latestByTicker = latestPriceDatesByTicker(dbPath, id, version);
    } catch {
      latestByTicker = new Map();
    }

    const tickers: TickerFreshness[] = t.map((ticker) => {
      const date = latestByTicker.get(ticker);
      const status: TickerFreshnessStatus =
        date === undefined ? 'unmapped' : date === null ? 'no-bars' : 'current';
      return { ticker, latestKnownDate: date ?? null, status };
    });
    const knownDates = tickers
      .map((tk) => tk.latestKnownDate)
      .filter((d): d is string => d !== null);
    const maxDate =
      knownDates.length > 0 ? knownDates.reduce((a, b) => (a > b ? a : b)) : undefined;
    for (const tk of tickers) {
      if (
        tk.status === 'current' &&
        maxDate !== undefined &&
        tk.latestKnownDate !== null &&
        tk.latestKnownDate < maxDate
      ) {
        tk.status = 'behind';
      }
    }

    return { id, version, latestKnownDate: maxDate, tickers };
  });

  let research: { datasetId: string; latestKnownDate: string | undefined };
  try {
    // This freshness check is specifically about the fusion portfolio's price+research pairing
    // (the 11 tracked securities) — not "every research domain," which is a different concern.
    const result = await loadResearchDataset('fusion');
    research = result.ok
      ? {
          datasetId: `${result.dataset.id}@${result.dataset.version}`,
          latestKnownDate: latestResearchDate(result.dataset),
        }
      : { datasetId: 'unknown', latestKnownDate: undefined };
  } catch {
    research = { datasetId: 'unknown', latestKnownDate: undefined };
  }

  return { datasets, research };
}

/** `recordJobRun` itself never throws, but its `Result` still deserves a look rather than being
 * silently dropped — a history-recording failure must never fail the job it's recording, but it
 * shouldn't vanish without a trace either. */
function recordJobRunSafely(dbPath: string, run: Parameters<typeof recordJobRun>[1]): void {
  const result = recordJobRun(dbPath, run);
  if (!result.ok) {
    console.error(`failed to record job run for "${run.jobId}": ${result.reason}`);
  }
}

export function createMarketDataRouter(rootDir: string): Router {
  const router = createRouter();
  router.get('/status', (_req: Request, res: Response) => {
    computeMarketDataStatus(rootDir)
      .then((status) => res.json(status))
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });

  router.get('/universes', (_req: Request, res: Response) => {
    listAllMarketUniverses(rootDir)
      .then((universes) => {
        res.json({
          universes: universes.map((universe) => ({
            ...universe,
            jobId: marketDataFetchJobId(universe.id),
          })),
        });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });

  // A new universe's `datasetId`/`datasetVersion` are always inherited from an EXISTING universe
  // (`baseUniverseId`), never hand-typed — a person only picks a new id/label and a ticker
  // subset of that base's own already-fetched, real tickers, so a custom universe can never point
  // at data that doesn't actually exist. See `customUniverses.ts`'s own doc comment.
  router.post('/universes', (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { id, label, baseUniverseId, tickers } = body as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "id" string.' });
      return;
    }
    if (typeof label !== 'string' || label.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "label" string.' });
      return;
    }
    if (typeof baseUniverseId !== 'string' || baseUniverseId.trim() === '') {
      res
        .status(400)
        .json({ error: 'Request body must include a non-empty "baseUniverseId" string.' });
      return;
    }
    if (
      !Array.isArray(tickers) ||
      tickers.length === 0 ||
      !tickers.every((t): t is string => typeof t === 'string' && t.trim() !== '')
    ) {
      res
        .status(400)
        .json({ error: 'Request body must include a non-empty "tickers" array of strings.' });
      return;
    }

    (async () => {
      const base = await resolveMarketUniverse(rootDir, baseUniverseId);
      if (base === undefined) {
        res.status(400).json({ error: `Unknown baseUniverseId "${baseUniverseId}".` });
        return;
      }
      // Validated against every REAL ticker currently in the dataset — not just `base`'s own
      // curated subset — so a symbol added via `POST /tickers` (possibly unrelated to `base`,
      // see that route's own doc comment) can go straight into a new universe built off the
      // SAME dataset, without needing to already belong to some existing universe first. Falls
      // back to `base.tickers` when the live store file doesn't exist yet (same `existsSync`
      // guard `discoverActiveMarketDatasets` above uses) — there's nothing live to validate a
      // newly-added symbol against in that case anyway, so this degrades to the prior behavior.
      const dbPath = defaultForwardMatchStoreDbPath(rootDir);
      const datasetTickers = existsSync(dbPath)
        ? new Set(
            queryTickers(createMarketDataStore(dbPath), {
              id: base.datasetId,
              version: base.datasetVersion,
            }),
          )
        : new Set(base.tickers);
      const unknownTickers = tickers.filter((t) => !datasetTickers.has(t));
      if (unknownTickers.length > 0) {
        res.status(400).json({
          error: `Tickers not in dataset "${base.datasetId}" version "${base.datasetVersion}": ${unknownTickers.join(', ')}.`,
        });
        return;
      }
      const result = await addCustomUniverse(rootDir, {
        id,
        label,
        datasetId: base.datasetId,
        datasetVersion: base.datasetVersion,
        tickers,
      });
      if (!result.ok) {
        res.status(409).json({ error: result.error });
        return;
      }
      res.json({
        universe: { ...result.universe, jobId: marketDataFetchJobId(result.universe.id) },
      });
    })().catch((error: unknown) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    });
  });

  // A ticker BASED ON an existing universe's dataset, not necessarily related to that universe's
  // own curated subset (e.g. fusion) — this is deliberately generic: any real, Yahoo-Finance-
  // fetchable symbol can be added to the SAME shared dataset a match's universe draws from. See
  // `addNewTicker.ts`'s own doc comment for why this is a different action from the Jobs tab's
  // "Fetch Latest Price Data" (which only ever grows a ticker already tracked by a universe).
  router.get('/tickers', (req: Request, res: Response) => {
    const { datasetId, datasetVersion } = req.query;
    if (typeof datasetId !== 'string' || typeof datasetVersion !== 'string') {
      res
        .status(400)
        .json({ error: '"datasetId" and "datasetVersion" query params are required.' });
      return;
    }
    try {
      const dbPath = defaultForwardMatchStoreDbPath(rootDir);
      if (!existsSync(dbPath)) {
        // No data has ever been published to this rootDir — an empty list, not an error, matches
        // `GET /status`'s own "no datasets when no matches are recorded" convention above.
        res.json({ tickers: [] });
        return;
      }
      const tickers = queryTickers(createMarketDataStore(dbPath), {
        id: datasetId,
        version: datasetVersion,
      });
      res.json({ tickers });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/tickers', (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { datasetId, datasetVersion, ticker, yahooSymbol, currency, usdRate, since } =
      body as Record<string, unknown>;
    if (typeof datasetId !== 'string' || datasetId.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "datasetId" string.' });
      return;
    }
    if (typeof datasetVersion !== 'string' || datasetVersion.trim() === '') {
      res
        .status(400)
        .json({ error: 'Request body must include a non-empty "datasetVersion" string.' });
      return;
    }
    if (typeof ticker !== 'string' || ticker.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "ticker" string.' });
      return;
    }
    if (
      yahooSymbol !== undefined &&
      (typeof yahooSymbol !== 'string' || yahooSymbol.trim() === '')
    ) {
      res.status(400).json({ error: '"yahooSymbol", when given, must be a non-empty string.' });
      return;
    }
    if (currency !== undefined && (typeof currency !== 'string' || currency.trim() === '')) {
      res.status(400).json({ error: '"currency", when given, must be a non-empty string.' });
      return;
    }
    if (
      usdRate !== undefined &&
      (typeof usdRate !== 'number' || !Number.isFinite(usdRate) || usdRate <= 0)
    ) {
      res.status(400).json({ error: '"usdRate", when given, must be a positive number.' });
      return;
    }
    if (since !== undefined && typeof since !== 'string') {
      res.status(400).json({ error: '"since", when given, must be a string.' });
      return;
    }

    const lockKey = `add-new-ticker:${datasetId}:${datasetVersion}:${ticker}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: `Already adding "${ticker}" — try again shortly.` });
      return;
    }

    (async () => {
      const store = createMarketDataStore(defaultForwardMatchStoreDbPath(rootDir));
      if (queryTickers(store, { id: datasetId, version: datasetVersion }).includes(ticker)) {
        res.status(409).json({
          error: `"${ticker}" is already published in dataset "${datasetId}" version "${datasetVersion}".`,
        });
        return;
      }
      const result = await withLock(lockKey, () =>
        addNewTicker(rootDir, {
          datasetId,
          datasetVersion,
          ticker,
          ...(yahooSymbol !== undefined ? { yahooSymbol } : {}),
          ...(currency !== undefined ? { currency } : {}),
          ...(usdRate !== undefined ? { usdRate } : {}),
          ...(since !== undefined ? { since } : {}),
        }),
      );
      res.json(result);
    })().catch((error: unknown) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    });
  });

  router.post('/fetch/:universeId', (req: Request, res: Response) => {
    const { universeId } = req.params;

    (async () => {
      const universe =
        universeId !== undefined ? await resolveMarketUniverse(rootDir, universeId) : undefined;
      if (universe === undefined) {
        res.status(404).json({ error: `no registered market universe "${String(universeId)}"` });
        return;
      }
      const jobId = marketDataFetchJobId(universe.id);
      const lockKey = `market-data:fetch:${universe.id}`;
      if (isLocked(lockKey)) {
        res
          .status(409)
          .json({ error: 'A price-data fetch is already in progress for this universe.' });
        return;
      }

      const startedAt = new Date().toISOString();
      try {
        const result = await withLock(lockKey, () =>
          runAsLiveJob(
            rootDir,
            { kind: 'market-data-fetch', label: `Fetch prices · ${universe.id}` },
            () => fetchLatestPriceData(rootDir, universe),
          ),
        );
        recordJobRunSafely(defaultJobRunStoreDbPath(rootDir), {
          jobId,
          startedAt,
          finishedAt: new Date().toISOString(),
          ok: result.ok,
          summary: result.note,
          output: result.output,
        });
        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordJobRunSafely(defaultJobRunStoreDbPath(rootDir), {
          jobId,
          startedAt,
          finishedAt: new Date().toISOString(),
          ok: false,
          summary: message,
          output: message,
        });
        res.status(500).json({ error: message });
      }
    })().catch((error: unknown) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    });
  });

  return router;
}
