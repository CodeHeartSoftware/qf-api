// `quant-fusion match forward refresh` — collapses the daily "fetch latest prices, then resume
// each active forward match" chore into one command. Deliberately does NOT regenerate/replace a
// match's `researchTimeline`: `runMatchForwardRunCommand` already refuses a `--config`/
// `--config-file` on resume (it's frozen at creation, see that file's own comment) — new research
// findings only ever reach an EXISTING match via `match forward preview`'s read-only check, never
// a silent resume-time swap. What DOES change safely between invocations is the live market-data
// SQLite store every active match already reads from — this command's whole job is to top that up
// before resuming, per match, then delegate the actual resume to the existing `run` command so
// there is exactly one code path that plays rounds.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listForwardMatchRecords, loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import {
  defaultForwardMatchStoreDir,
  readForwardShadowFields,
  type MarketDatasetRef,
} from '../lib/forwardShadowConfig.js';
import { runMatchForwardRunCommand } from './matchForward.js';

const USAGE =
  'Usage: quant-fusion match forward refresh <matchId> [<matchId>...] | --all [--store-dir <path>]';

export interface MatchForwardRefreshOptions {
  rootDir: string;
}

export async function runMatchForwardRefreshCommand(
  argv: readonly string[],
  options: MatchForwardRefreshOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { all: { type: 'boolean' }, 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  let matchIds: string[];
  if (values.all === true) {
    const { summaries } = await listForwardMatchRecords(storeDir);
    matchIds = summaries.filter((s) => s.status === 'active').map((s) => s.matchId);
    if (matchIds.length === 0) {
      console.log('No active forward matches to refresh.');
      return 0;
    }
  } else if (positionals.length > 0) {
    matchIds = positionals;
  } else {
    console.error(USAGE);
    return 1;
  }

  const toRefresh: { matchId: string; participantIds: string[] }[] = [];
  const datasetsByKey = new Map<string, MarketDatasetRef & { tickers: Set<string> }>();

  for (const matchId of matchIds) {
    const outcome = await loadForwardMatchRecord(storeDir, matchId);
    if (outcome.status === 'not-found') {
      console.error(`warning: no forward match "${matchId}" — skipping.`);
      continue;
    }
    if (outcome.status === 'corrupt') {
      console.error(`warning: ${outcome.reason} — skipping.`);
      continue;
    }
    const { record } = outcome;
    if (record.status !== 'active') {
      console.log(`"${matchId}" is already ${record.status} — nothing to refresh.`);
      continue;
    }
    const fields = readForwardShadowFields(record.config);
    if (fields === undefined) {
      console.error(
        `warning: "${matchId}"'s config isn't a recognizable FORWARD_SHADOW config (no ` +
          `marketDataUniverse/marketDataset) — skipping price refresh, will still try to resume it.`,
      );
      toRefresh.push({ matchId, participantIds: record.participantIds });
      continue;
    }
    const key = `${fields.marketDataset.id}@${fields.marketDataset.version}`;
    const entry = datasetsByKey.get(key) ?? { ...fields.marketDataset, tickers: new Set<string>() };
    for (const ticker of fields.marketDataUniverse) entry.tickers.add(ticker);
    datasetsByKey.set(key, entry);
    toRefresh.push({ matchId, participantIds: record.participantIds });
  }

  for (const { id, version, dbPath: marketDbPath, tickers } of datasetsByKey.values()) {
    console.log(
      `\nFetching latest prices for dataset "${id}" v${version} (${String(tickers.size)} ticker(s))...`,
    );
    const args = [
      'workspace',
      '@quant-fusion/market-data',
      'run',
      'fetch:append-bars',
      '--',
      '--dataset-id',
      id,
      '--dataset-version',
      version,
      '--tickers',
      [...tickers].join(','),
      // `yarn workspace <pkg> run <script>` executes with cwd set to that PACKAGE's own
      // directory, not the invoking cwd — so a config's own `marketDataset.dbPath` (stored
      // relative to the repo root by `emitForwardMatchConfig.ts`, e.g. "./.quant-fusion/
      // stock-market-4/db.sqlite") must be resolved against `options.rootDir` here, or it
      // resolves against packages/stock-market-4/market-data/ instead and the fetch fails with
      // "unable to open database file".
      ...(marketDbPath !== undefined
        ? ['--db-path', path.resolve(options.rootDir, marketDbPath)]
        : []),
    ];
    const result = spawnSync('yarn', args, { cwd: options.rootDir, stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(
        `warning: price fetch for dataset "${id}" v${version} exited with status ${String(result.status)} — continuing to resume matches anyway.`,
      );
    }
  }

  let failures = 0;
  for (const { matchId, participantIds } of toRefresh) {
    console.log(`\nResuming forward match "${matchId}"...`);
    // Explicit --store-dir so a custom one passed to `refresh` also applies to the resume itself,
    // not just to reading records above (this function's own default matches `runMatchForward-
    // RunCommand`'s, so this is a no-op unless the caller passed a custom --store-dir).
    const code = await runMatchForwardRunCommand(
      [matchId, ...participantIds, '--store-dir', storeDir],
      options,
    );
    if (code !== 0) failures += 1;
  }
  return failures > 0 ? 1 : 0;
}
