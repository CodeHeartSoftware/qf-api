/**
 * Publishes a NEW dataset version from a fresh Yahoo Finance pull over `--since`..`--through` — the
 * sanctioned way to backfill history earlier than a ticker's existing frontier, which
 * `fetchAndAppendBars.ts`/`appendBars` deliberately refuse ("publish a corrected NEW dataset version
 * instead of backfilling"). Like every ingestion script here it never writes a database: it renders
 * ONE auto-numbered migration (dataset version + every bar + a checked-through watermark per
 * ticker) under `src/migrations/`, reviewed like any other code change.
 *
 * `--compare-version <v>` (recommended) checks every date the new pull shares with an existing
 * version of the same dataset and refuses to write if any close differs by more than
 * `--max-close-diff-pct` (default 2) plus `--max-close-diff-abs` dollars (default 0.005 — earlier
 * appends were rounded to cents, which alone is ~4% on a $0.13 stock) — the guard against a silent unit change (a split applied
 * twice, a native-currency price where USD was expected; see this package's FX-conversion history
 * in `src/provider/yahooFinance.ts`'s doc comment). A difference that's a known error in the OLD
 * version can be accepted explicitly with `--accept-diff TICKER@YYYY-MM-DD[,...]`; every accepted
 * one is recorded in the published version's description. Late listings are fine: a ticker simply
 * starts at its first real Yahoo bar, or at `TrackedSecurity.tradingSince` when that's later.
 *
 * Usage:
 *   yarn workspace @quant-fusion/market-data fetch:publish-version -- \
 *     --dataset-id fusion-fundamental-v0 --dataset-version 4 --since 2026-01-02 \
 *     [--through YYYY-MM-DD] [--tickers T1,T2] [--compare-version 3] [--max-close-diff-pct 2]
 *     [--max-close-diff-abs 0.005] [--accept-diff T@YYYY-MM-DD,...] [--dry-run]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKED_SECURITIES } from '@quant-fusion/fusion-universe';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import type { DailyBar } from '../src/schema/dailyBar.js';
import { createMarketDataStore } from '../src/store/db.js';
import { fetchTicker, type TickerSource } from '../src/provider/yahooFinance.js';
import { datasetVersionExists, queryBarsAsOf } from '../src/store/queries.js';
import { renderCheckedThroughSql, renderPublishDatasetVersionSql } from '../src/store/sqlGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

// Built here rather than imported from fetchAndAppendBars.ts, which runs its own main() on import.
const TICKERS: Record<string, TickerSource & { tradingSince?: string }> = Object.fromEntries(
  TRACKED_SECURITIES.map((security) => [
    security.ticker,
    {
      yahooSymbol: security.yahooSymbol,
      currency: security.currency,
      usdRate: security.usdRate,
      ...(security.tradingSince === undefined ? {} : { tradingSince: security.tradingSince }),
    },
  ]),
);

/** `T1@2026-09-09,T2@2026-08-01` -> ticker -> accepted dates. Throws on a malformed entry. */
export function parseAcceptedDiffs(raw: string | undefined): Map<string, Set<string>> {
  const accepted = new Map<string, Set<string>>();
  if (raw === undefined) return accepted;
  for (const entry of raw.split(',')) {
    const match = /^([A-Z0-9.]+)@(\d{4}-\d{2}-\d{2})$/.exec(entry.trim());
    if (match === null) throw new Error(`--accept-diff entry "${entry}" must be TICKER@YYYY-MM-DD`);
    const [, ticker = '', date = ''] = match; // both groups always participate when the regex matches
    const dates = accepted.get(ticker) ?? new Set<string>();
    dates.add(date);
    accepted.set(ticker, dates);
  }
  return accepted;
}

export interface OverlapCheck {
  ticker: string;
  overlappingDays: number;
  maxClosePctDiff: number;
  worstDate: string | null;
  /** Shared dates whose close differs by more than `tolerance` allows. */
  violations: { date: string; pctDiff: number }[];
}

export interface OverlapTolerance {
  pct: number;
  abs: number;
}

/** Compares two bar series' closes on the dates they share (skipping `acceptedDates`): the largest
 * relative difference, and every date beyond `abs + pct% * oldClose`. */
export function compareOverlap(
  ticker: string,
  fresh: readonly DailyBar[],
  existing: readonly DailyBar[],
  tolerance: OverlapTolerance,
  acceptedDates: ReadonlySet<string> = new Set(),
): OverlapCheck {
  const existingByDate = new Map(existing.map((bar) => [bar.date, bar.close]));
  let maxClosePctDiff = 0;
  let worstDate: string | null = null;
  let overlappingDays = 0;
  const violations: { date: string; pctDiff: number }[] = [];
  for (const bar of fresh) {
    const old = existingByDate.get(bar.date);
    if (old === undefined || old === 0 || acceptedDates.has(bar.date)) continue;
    overlappingDays += 1;
    const absDiff = Math.abs(bar.close - old);
    const diff = (absDiff / Math.abs(old)) * 100;
    if (absDiff > tolerance.abs + (tolerance.pct / 100) * Math.abs(old))
      violations.push({ date: bar.date, pctDiff: diff });
    if (diff > maxClosePctDiff) {
      maxClosePctDiff = diff;
      worstDate = bar.date;
    }
  }
  return { ticker, overlappingDays, maxClosePctDiff, worstDate, violations };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[token.slice(2)] = true;
    } else {
      args[token.slice(2)] = next;
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetId = args['dataset-id'];
  const datasetVersion = args['dataset-version'];
  const since = args.since;
  if (
    typeof datasetId !== 'string' ||
    typeof datasetVersion !== 'string' ||
    typeof since !== 'string'
  ) {
    console.error(
      'Usage: fetch:publish-version -- --dataset-id <id> --dataset-version <new version> --since YYYY-MM-DD ' +
        '[--through YYYY-MM-DD] [--tickers T1,T2,...] [--compare-version <v>] [--max-close-diff-pct 2] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }
  const realTodayUTC = new Date().toISOString().slice(0, 10);
  const through = typeof args.through === 'string' ? args.through : realTodayUTC;
  const compareVersion =
    typeof args['compare-version'] === 'string' ? args['compare-version'] : undefined;
  const tolerance: OverlapTolerance = {
    pct: typeof args['max-close-diff-pct'] === 'string' ? Number(args['max-close-diff-pct']) : 2,
    abs:
      typeof args['max-close-diff-abs'] === 'string' ? Number(args['max-close-diff-abs']) : 0.005,
  };
  const dryRun = args['dry-run'] === true;
  const acceptedDiffs = parseAcceptedDiffs(
    typeof args['accept-diff'] === 'string' ? args['accept-diff'] : undefined,
  );
  const checkedAt = new Date().toISOString();

  // Replays every committed migration — the true current state, same as fetchAndAppendBars.ts.
  const store = createMarketDataStore(':memory:');
  const identity = { id: datasetId, version: datasetVersion };
  if (datasetVersionExists(store, identity)) {
    console.error(
      `dataset "${datasetId}" version "${datasetVersion}" is already published — versions are immutable; pick a new one.`,
    );
    process.exitCode = 1;
    return;
  }
  const compareIdentity =
    compareVersion === undefined ? undefined : { id: datasetId, version: compareVersion };
  if (compareIdentity !== undefined && !datasetVersionExists(store, compareIdentity)) {
    console.error(
      `--compare-version "${String(compareVersion)}" doesn't exist for dataset "${datasetId}".`,
    );
    process.exitCode = 1;
    return;
  }

  const tickers =
    typeof args.tickers === 'string'
      ? args.tickers.split(',')
      : TRACKED_SECURITIES.map((s) => s.ticker);
  const bars: Record<string, DailyBar[]> = {};
  const failures: string[] = [];
  for (const ticker of tickers) {
    const source = TICKERS[ticker];
    if (source === undefined) {
      failures.push(`${ticker}: no Yahoo Finance mapping in @quant-fusion/fusion-universe`);
      continue;
    }
    const fetched = await fetchTicker(ticker, source, since, through);
    // Same final-bar rule as fetchAndAppendBars.ts: today's bar only once its session has closed.
    const nowUnixSeconds = Math.floor(Date.now() / 1000);
    const sessionEnd = fetched.regularSessionEndUnixSeconds;
    const finalBars = fetched.bars.filter(
      (bar) =>
        (source.tradingSince === undefined || bar.date >= source.tradingSince) &&
        (bar.date < realTodayUTC ||
          (bar.date === realTodayUTC && sessionEnd !== undefined && nowUnixSeconds >= sessionEnd)),
    );
    if (finalBars.length === 0) {
      failures.push(`${ticker}: Yahoo returned no final bars in ${since}..${through}`);
      continue;
    }
    bars[ticker] = finalBars;

    let overlapNote = '';
    if (compareIdentity !== undefined) {
      const check = compareOverlap(
        ticker,
        finalBars,
        queryBarsAsOf(store, compareIdentity, ticker, through, Number.POSITIVE_INFINITY),
        tolerance,
        acceptedDiffs.get(ticker),
      );
      overlapNote = ` | vs v${String(compareVersion)}: ${String(check.overlappingDays)} shared days, max close diff ${check.maxClosePctDiff.toFixed(2)}%${check.worstDate === null ? '' : ` (${check.worstDate})`}`;
      for (const violation of check.violations) {
        failures.push(
          `${ticker}: close differs from v${String(compareVersion)} by ${violation.pctDiff.toFixed(2)}% on ${violation.date} ` +
            `(limit ${String(tolerance.pct)}% + $${String(tolerance.abs)}) — split/currency mismatch, or a wrong bar in the old version?`,
        );
      }
    }
    console.log(
      `${ticker}: ${String(finalBars.length)} bars, ${String(finalBars[0]?.date)} through ${String(finalBars.at(-1)?.date)}${overlapNote}`,
    );
  }

  if (failures.length > 0) {
    console.error(`\nRefusing to write a migration:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log('\n--dry-run: all checks passed, nothing written.');
    return;
  }

  const acceptedNote = [...acceptedDiffs].flatMap(([ticker, dates]) =>
    [...dates].map((date) => `${ticker}@${date}`),
  );
  const description =
    `Yahoo Finance daily bars ${since} through ${through} for ${Object.keys(bars).join(', ')} — USD-converted at ` +
    `each ticker's flat @quant-fusion/fusion-universe rate (and trimmed to its tradingSince), generated by ` +
    `scripts/fetchAndPublishVersion.ts.` +
    (acceptedNote.length === 0
      ? ''
      : ` Accepted close differences vs v${String(compareVersion)} (old version wrong): ${acceptedNote.join(', ')}.`);
  const sql = [
    renderPublishDatasetVersionSql(identity, { description, bars }, checkedAt),
    renderCheckedThroughSql(
      identity,
      Object.entries(bars).flatMap(([ticker, series]) => {
        const last = series.at(-1);
        return last === undefined ? [] : [{ ticker, checkedThroughDate: last.date, checkedAt }];
      }),
    ),
  ].join('\n');

  const number = nextMigrationNumber(MIGRATIONS_DIR);
  const exportName = `migration${number}PublishDatasetVersion`;
  const migrationPath = join(MIGRATIONS_DIR, `${number}_publish_dataset_version.ts`);
  writeFileSync(
    migrationPath,
    renderMigrationFileSource({
      exportName,
      id: `market-data/${number}_publish_dataset_version`,
      sql,
      docComment:
        `/** Dataset "${datasetId}" version "${datasetVersion}": Yahoo Finance bars ${since} through ${through}, generated\n` +
        ' * by `scripts/fetchAndPublishVersion.ts` — never hand-edit this file; a correction is always a\n' +
        ' * NEW dataset version. */',
    }),
    'utf8',
  );
  console.log(`\nWrote ${migrationPath}`);
  console.log(
    '\nOne manual step left — add these two lines to market-data/src/migrations/index.ts:',
  );
  console.log(`  import { ${exportName} } from './${number}_publish_dataset_version.js';`);
  console.log(`  // ...and add ${exportName} to the marketDataMigrations array.`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(`fetch:publish-version failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
