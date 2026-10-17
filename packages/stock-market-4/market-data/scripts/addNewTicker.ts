/**
 * Fetches real daily bars from Yahoo Finance for a ticker that has NEVER been published in a
 * dataset before, and renders them as a NEW, auto-numbered migration file — the counterpart to
 * `fetchAndAppendBars.ts`, which deliberately REFUSES an unknown ticker ("this script only grows
 * an existing ticker"). That refusal is `fetchAndAppendBars.ts`'s own policy choice, not a limit
 * of the underlying mechanism: `renderAppendBarsSql` (`../src/store/sqlGen.ts`) only requires the
 * DATASET VERSION to already exist, never the specific ticker — a ticker with no prior bars has
 * no "already known through" cursor to conflict with, so its first batch of real bars inserts
 * cleanly. This script is that other, deliberate path: adding a genuinely new symbol (not
 * necessarily fusion-related) to an already-published dataset version.
 *
 * Same currency-safety posture as `fetchAndAppendBars.ts` (see that file's own module doc comment
 * for the real incident that motivated it) — `--currency`/`--usd-rate` are required up front and
 * `fetchTicker` still refuses to write a bar whose fetched currency doesn't match what was
 * declared, rather than silently trusting the API's response.
 *
 * Usage:
 *   yarn workspace @quant-fusion/market-data run add:new-ticker -- \
 *     --dataset-id fusion-fundamental-v0 --dataset-version 3 --ticker NVDA \
 *     [--yahoo-symbol NVDA] [--currency USD] [--usd-rate 1] [--since 2025-01-01] \
 *     [--through 2026-09-21] [--dry-run]
 *
 * The generated migration file still needs ONE manual step: add its import + array entry to
 * `market-data/src/migrations/index.ts` (this script prints the exact lines).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import { createMarketDataStore } from '../src/store/db.js';
import { fetchTicker } from '../src/provider/yahooFinance.js';
import { queryLatestKnownDate, queryTickers } from '../src/store/queries.js';
import { renderAppendBarsSql } from '../src/store/sqlGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetId = args['dataset-id'];
  const datasetVersion = args['dataset-version'];
  const ticker = args.ticker;
  const usage =
    'Usage: add:new-ticker -- --dataset-id <id> --dataset-version <version> --ticker <TICKER> ' +
    '[--yahoo-symbol <symbol>] [--currency USD] [--usd-rate 1] [--since YYYY-MM-DD] ' +
    '[--through YYYY-MM-DD] [--dry-run]';
  if (
    typeof datasetId !== 'string' ||
    typeof datasetVersion !== 'string' ||
    typeof ticker !== 'string'
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const through =
    typeof args.through === 'string' ? args.through : new Date().toISOString().slice(0, 10);
  // Defaults to one trading year back — plenty of real history for a fresh symbol without
  // requiring the caller to know/guess how far Yahoo Finance's own history goes.
  const since =
    typeof args.since === 'string'
      ? args.since
      : new Date(new Date(`${through}T00:00:00Z`).getTime() - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
  const source = {
    yahooSymbol: typeof args['yahoo-symbol'] === 'string' ? args['yahoo-symbol'] : ticker,
    currency: typeof args.currency === 'string' ? args.currency : 'USD',
    usdRate: typeof args['usd-rate'] === 'string' ? Number(args['usd-rate']) : 1,
  };
  if (!Number.isFinite(source.usdRate) || source.usdRate <= 0) {
    console.error(`--usd-rate must be a positive number (got "${String(args['usd-rate'])}").`);
    process.exitCode = 1;
    return;
  }
  const dryRun = args['dry-run'] === true;

  const store = createMarketDataStore(':memory:');
  const identity = { id: datasetId, version: datasetVersion };

  if (queryTickers(store, identity).includes(ticker)) {
    console.error(
      `"${ticker}" is already published in dataset "${datasetId}" version "${datasetVersion}" — ` +
        `use \`fetch:append-bars\` to grow it instead, this script is only for a genuinely new symbol.`,
    );
    process.exitCode = 1;
    return;
  }
  if (queryLatestKnownDate(store, identity, ticker) !== null) {
    // Unreachable given the check above, but keeps this script's own invariant explicit rather
    // than relying solely on `queryTickers`.
    throw new Error(`"${ticker}" unexpectedly already has known bars — refusing to proceed.`);
  }

  const fetched = await fetchTicker(ticker, source, since, through);
  // A brand-new ticker never has a running match tracking it yet, so there's no `daily_bars_intraday`
  // consumer worth wiring up here (see `fetchAndAppendBars.ts`'s own doc comment for that
  // machinery) — simpler to just never publish today's bar at all until its session has closed,
  // same "presence of real data is unambiguous, only a still-open session is" reasoning.
  const realTodayUTC = new Date().toISOString().slice(0, 10);
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  const sessionEnd = fetched.regularSessionEndUnixSeconds;
  const bars = fetched.bars.filter((bar) => {
    if (bar.date < realTodayUTC) return true;
    if (bar.date > realTodayUTC) return false;
    return sessionEnd !== undefined && nowUnixSeconds >= sessionEnd;
  });
  if (bars.length < fetched.bars.length) {
    console.log(
      `${ticker}: today's session is still open — excluding today's not-yet-final bar from this add.`,
    );
  }
  if (bars.length === 0) {
    console.error(
      `${ticker}: no real, final trading days found in ${since}..${through} — nothing to add.`,
    );
    process.exitCode = 1;
    return;
  }
  const firstBar = bars[0];
  const lastBar = bars.at(-1);
  console.log(
    `${ticker}: fetched ${String(bars.length)} bar(s), ${firstBar?.date ?? '?'} through ${lastBar?.date ?? '?'}`,
  );

  if (dryRun) {
    console.log('\n--dry-run: not adding. Bars found:', JSON.stringify(bars, null, 2));
    return;
  }

  const rendered = renderAppendBarsSql(store, identity, { bars: { [ticker]: bars } });
  if (!rendered.ok) {
    console.error(rendered.reason);
    process.exitCode = 1;
    return;
  }

  const number = nextMigrationNumber(MIGRATIONS_DIR);
  const tickerSlug = ticker.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const exportName = `migration${number}AddNewTicker${ticker.replace(/[^a-zA-Z0-9]+/g, '')}`;
  const id = `market-data/${number}_add_new_ticker_${tickerSlug}`;
  const migrationFileName = `${number}_add_new_ticker_${tickerSlug}.ts`;
  const migrationPath = join(MIGRATIONS_DIR, migrationFileName);

  const source_ = renderMigrationFileSource({
    exportName,
    id,
    sql: rendered.value,
    docComment: `/** "${ticker}" (Yahoo Finance symbol "${source.yahooSymbol}") added as a brand-new ticker to\n * dataset "${datasetId}" version "${datasetVersion}", generated by\n * \`scripts/addNewTicker.ts\` — never hand-edit this file; a correction is always a NEW\n * migration. */`,
  });
  writeFileSync(migrationPath, source_, 'utf8');

  console.log(`\nWrote ${migrationPath}`);
  console.log(
    '\nOne manual step left — add these two lines to market-data/src/migrations/index.ts:',
  );
  console.log(`  import { ${exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`);
  console.log(`  // ...and add ${exportName} to the marketDataMigrations array.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
