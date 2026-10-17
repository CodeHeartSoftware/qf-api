// `quant-fusion match forward status` — a single read-only "what's stale" view across every
// active forward match: how far each match's own price data actually reaches per ticker (queried
// live from the market-data store its config points at, deduped across matches sharing a
// dataset), plus the research-fusion dataset's own freshness. Never mutates anything — pure reads,
// mirroring `list`/`inspect`'s own design.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { listForwardMatchRecords, loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import {
  createMarketDataStore,
  queryLatestKnownDate,
  queryTickers,
} from '@quant-fusion/market-data';
import { createFusionFixtureDataset } from '@quant-fusion/research-fusion';
import {
  defaultForwardMatchStoreDir,
  readForwardShadowFields,
} from '../lib/forwardShadowConfig.js';

export interface MatchForwardStatusOptions {
  rootDir: string;
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

/** The freshest day a research dataset actually KNEW something — the latest `observedAt` anywhere
 * in it (evidence, provenance, …), found by walking the whole object so a field the schema adds
 * later is never silently missed. Deliberately ignores every other timestamp: `publishedAt` in
 * particular is often a journal's future cover date (a "January 2027" issue whose preprint was
 * observed in May 2026), and scenario/expiry fields are forward-looking by design — neither says
 * anything about how fresh the dataset is. (Unlike `@quant-fusion/research-fusion`'s own
 * `distinctDatasetDates`, which scans every timestamp on purpose — there an extra date is
 * harmless; here it's the whole answer.) Same logic as `apps/api`'s
 * `src/lib/latestResearchDate.ts`. */
export function latestResearchDate(dataset: unknown): string | undefined {
  let latest: string | undefined;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'observedAt' && typeof child === 'string') {
        const day = child.slice(0, 'YYYY-MM-DD'.length);
        if (latest === undefined || day > latest) latest = day;
      } else {
        visit(child);
      }
    }
  };
  visit(dataset);
  return latest;
}

export async function runMatchForwardStatusCommand(
  argv: readonly string[],
  options: MatchForwardStatusOptions,
): Promise<number> {
  const { values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: false,
  });
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const { summaries, issues } = await listForwardMatchRecords(storeDir);
  if (summaries.length === 0) {
    console.log('No forward matches recorded yet.');
  }

  const priceCacheByKey = new Map<string, Map<string, string | null>>();

  for (const summary of summaries) {
    console.log(
      `\n${summary.matchId}  (${summary.status}, ${String(summary.roundsPlayed)} round(s), updated ${summary.updatedAt})`,
    );
    if (summary.status !== 'active') continue; // no price freshness to report for a finished match

    const outcome = await loadForwardMatchRecord(storeDir, summary.matchId);
    if (outcome.status !== 'found') continue; // already reported by `issues` below
    const fields = readForwardShadowFields(outcome.record.config);
    if (fields === undefined) {
      console.log('  config not recognized as FORWARD_SHADOW — no price freshness to report.');
      continue;
    }

    const { id, version, dbPath: marketDbPath } = fields.marketDataset;
    const key = `${id}@${version}@${marketDbPath ?? ''}`;
    let latestByTicker = priceCacheByKey.get(key);
    if (latestByTicker === undefined) {
      const resolvedDbPath =
        marketDbPath !== undefined
          ? path.resolve(options.rootDir, marketDbPath)
          : path.join(options.rootDir, '.quant-fusion', 'db.sqlite');
      try {
        latestByTicker = latestPriceDatesByTicker(resolvedDbPath, id, version);
      } catch (error) {
        console.log(
          `  warning: could not read market-data store for "${id}"@${version}: ${error instanceof Error ? error.message : String(error)}`,
        );
        latestByTicker = new Map();
      }
      priceCacheByKey.set(key, latestByTicker);
    }

    const knownDates = fields.marketDataUniverse
      .map((ticker) => latestByTicker.get(ticker))
      .filter((date): date is string => typeof date === 'string');
    const maxDate =
      knownDates.length > 0 ? knownDates.reduce((a, b) => (a > b ? a : b)) : undefined;
    console.log(`  prices (${id}@${version}): latest known ${maxDate ?? 'unknown'}`);
    for (const ticker of fields.marketDataUniverse) {
      const date = latestByTicker.get(ticker);
      if (date === undefined)
        console.log(`    ${ticker}: no Yahoo Finance mapping / never fetched`);
      else if (date === null) console.log(`    ${ticker}: no bars yet`);
      else if (maxDate !== undefined && date < maxDate)
        console.log(`    ${ticker}: behind — latest ${date} (dataset's latest is ${maxDate})`);
    }
  }
  for (const issue of issues) {
    console.error(`warning: could not read ${issue.path}: ${issue.message}`);
  }

  try {
    const dataset = createFusionFixtureDataset();
    console.log(
      `\nResearch dataset "${dataset.id}" version "${dataset.version}": latest known development ${latestResearchDate(dataset) ?? 'unknown'}`,
    );
  } catch (error) {
    console.log(
      `\nwarning: could not read research-fusion dataset: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return 0;
}
