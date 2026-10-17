/**
 * Deterministic, no-LLM price ingestion: fetches real daily bars from Yahoo Finance's public
 * chart API and renders them as a NEW, auto-numbered migration file — the replacement for asking
 * an AI agent to browse/gather prices by hand each time, and (per
 * `docs/adr/0014-sqlite-standard-and-migrations.md`) for writing directly into a local sqlite
 * file. Auto-detects each ticker's own gap (`queryLatestKnownDate`, checked against a fresh
 * replay of this package's own current migrations, never a real file), so it's safe to just
 * re-run this daily/whenever with no date arguments at all.
 *
 * BACKGROUND (why this exists, and why it validates currency so aggressively): an earlier manual
 * gap-fill for this exact dataset wrote FUJIKURA/SUMITOMO/FURUKAWA/VITZRONEXTECH/FREEM's bars in
 * their RAW native currency (JPY/KRW/SEK) instead of USD, silently breaking continuity with the
 * rest of the (USD) dataset — a ~150x price discontinuity for the JPY tickers. That required
 * republishing a corrected dataset version. This script hard-codes each ticker's expected
 * currency and conversion rate (the SAME flat per-ticker rate already established in
 * `bots/stock-market-4/fusion-fundamental-v0/backtest/*HistoricalPrices.ts` — reused, not
 * re-derived, for consistency with a ticker's own existing history) and REFUSES to write a bar
 * whose fetched currency doesn't match what's configured, rather than silently trusting the API's
 * response — see `TICKERS` and the currency check in `fetchTicker` below.
 *
 * Usage:
 *   yarn workspace @quant-fusion/market-data run fetch:append-bars -- \
 *     --dataset-id fusion-fundamental-v0 --dataset-version 4 [--tickers KMT,AMSC,...] \
 *     [--through 2026-09-11] [--db-path /path/to/real/db.sqlite] [--dry-run]
 *
 * The generated migration file still needs ONE manual step: add its import + array entry to
 * `market-data/src/migrations/index.ts` (this script prints the exact lines).
 *
 * Also advances each successfully-checked ticker's `ticker_checked_through` watermark (see
 * `migrations/0009_ticker_checked_through_table.ts`) — but deliberately never past YESTERDAY
 * relative to this script's own real run time (`safeAbsenceThrough` below), never today. A
 * same-day "no bars found" is genuinely ambiguous (a real holiday and "Yahoo just hasn't
 * published it yet" look identical), so trusting it immediately risks permanently mislabeling a
 * plain ingestion lag as a confirmed gap. Waiting one calendar day costs nothing here — a bar that
 * WAS coming still arrives and gets appended normally; only the "nothing is ever coming" case
 * benefits from the watermark, and that case is just as true tomorrow as it looked today. A ticker
 * with an actual fetched bar always gets full credit for that bar's own date regardless of this
 * cap — presence of real data is never ambiguous, only absence is.
 *
 * PROVISIONAL (intraday) bars: today's bar for a ticker whose exchange's regular session hasn't
 * closed yet (`fetchTicker`'s own `regularSessionEndUnixSeconds`) is real, live-updating data —
 * never null-padded, verified against Yahoo's actual API — but it's NOT final: its close is
 * whatever the last trade happened to be at the moment this script ran, not the day's real
 * closing price. It NEVER goes into the generated migration (that stays exclusively FINAL,
 * closed-session data, so `daily_bars`/`latestKnownDate` keep meaning exactly what they always
 * meant). Instead, when `--db-path` points at the real, live database, it's written straight into
 * `daily_bars_intraday` (`store/provisional.ts`) — a plain, non-migration, OVERWRITE-in-place
 * write: at most one row per ticker, replaced by whatever this run's snapshot is, so re-running
 * this script throughout the day just refreshes it rather than accumulating history. Once the
 * session actually closes and a real final bar lands, any lingering provisional row for that
 * ticker is cleared — the two can never coexist as if they were both current. This is what lets
 * `match forward preview` (never `match forward run`) read a live mid-day snapshot without any
 * of it ever becoming a match's real, persisted round — see `MarketDataProvider.provisionalBar`'s
 * own doc comment.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKED_SECURITIES } from '@quant-fusion/fusion-universe';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import { createMarketDataStore, type MarketDataStore } from '../src/store/db.js';
import { fetchTicker, type FetchedBars, type TickerSource } from '../src/provider/yahooFinance.js';
import { queryLatestKnownDate, queryTickers } from '../src/store/queries.js';
import { clearProvisionalBar, writeProvisionalBar } from '../src/store/provisional.js';
import {
  renderAppendBarsSql,
  renderCheckedThroughSql,
  type CheckedThroughUpdate,
} from '../src/store/sqlGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

// Derived from `@quant-fusion/fusion-universe`'s `TRACKED_SECURITIES` — the shared source of truth
// with `@quant-fusion/research-fusion` (see that package's `scope.ts`) — rather than a second
// hand-copied 11-ticker table living only here.
export const TICKERS: Record<string, TickerSource> = Object.fromEntries(
  TRACKED_SECURITIES.map((security) => [
    security.ticker,
    { yahooSymbol: security.yahooSymbol, currency: security.currency, usdRate: security.usdRate },
  ]),
);

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
  if (typeof datasetId !== 'string' || typeof datasetVersion !== 'string') {
    console.error(
      'Usage: fetch:append-bars -- --dataset-id <id> --dataset-version <version> ' +
        '[--tickers T1,T2,...] [--through YYYY-MM-DD] [--db-path <path>] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }
  const through =
    typeof args.through === 'string' ? args.through : new Date().toISOString().slice(0, 10);
  const dryRun = args['dry-run'] === true;

  // Never trust a same-day "no bars found" as a confirmed gap (see this file's own doc comment) —
  // `yesterdayUTC` is relative to when THIS script actually runs, not to `--through`.
  const realTodayUTC = new Date().toISOString().slice(0, 10);
  const yesterdayUTC = new Date(
    new Date(`${realTodayUTC}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const safeAbsenceThrough = through < yesterdayUTC ? through : yesterdayUTC;
  const checkedAt = new Date().toISOString();

  const store = createMarketDataStore(':memory:');
  const identity = { id: datasetId, version: datasetVersion };

  // The REAL, live database — only for provisional (intraday) writes, never for the migration
  // path above, which stays exactly as file-generated as it always was. `undefined` when no
  // `--db-path` was given (e.g. an ad hoc local invocation): provisional bars are still detected
  // and reported, just not persisted anywhere, since there's nowhere real to put them.
  const dbPathArg = args['db-path'];
  const realStore: MarketDataStore | undefined =
    typeof dbPathArg === 'string' ? createMarketDataStore(dbPathArg) : undefined;

  const requestedTickers =
    typeof args.tickers === 'string' ? args.tickers.split(',') : queryTickers(store, identity);

  const results: FetchedBars[] = [];
  const checkedThroughUpdates: CheckedThroughUpdate[] = [];
  const provisionalWrites: { ticker: string; date: string; close: number }[] = [];
  for (const ticker of requestedTickers) {
    const source = TICKERS[ticker];
    if (source === undefined) {
      console.error(
        `${ticker}: no Yahoo Finance mapping configured in this script's TICKERS table — skipped.`,
      );
      continue;
    }
    const latestKnown = queryLatestKnownDate(store, identity, ticker);
    const sinceDate =
      latestKnown === null
        ? through // unknown ticker in this dataset — nothing to append from here, only via publishDatasetVersion
        : new Date(new Date(`${latestKnown}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
    if (latestKnown !== null && sinceDate > through) {
      console.log(`${ticker}: already known through ${latestKnown} — nothing new to fetch.`);
      continue;
    }
    if (latestKnown === null) {
      console.error(
        `${ticker}: not yet published in dataset "${datasetId}" version "${datasetVersion}" — publish it first, this script only grows an existing ticker.`,
      );
      continue;
    }
    try {
      const fetched = await fetchTicker(ticker, source, sinceDate, through);

      // Split into FINAL bars (always safe to append via migration, same as before this feature
      // existed) and at most one PROVISIONAL bar — today's, only if its exchange's regular
      // session hasn't closed yet. A bar dated strictly before today is always final regardless
      // of session state; one dated strictly after today shouldn't exist (Yahoo doesn't return
      // future dates) and is dropped defensively rather than trusted.
      const nowUnixSeconds = Math.floor(Date.now() / 1000);
      const sessionEnd = fetched.regularSessionEndUnixSeconds;
      const finalBars = fetched.bars.filter((bar) => {
        if (bar.date < realTodayUTC) return true;
        if (bar.date > realTodayUTC) return false;
        // bar.date === realTodayUTC: final only once the session has confirmed-closed. Unknown
        // session-end is treated as NOT yet final (conservative) — it just delays finalization to
        // tomorrow's run, when the same date is safely in the past regardless.
        return sessionEnd !== undefined && nowUnixSeconds >= sessionEnd;
      });
      const provisional = fetched.bars.find(
        (bar) => bar.date === realTodayUTC && !finalBars.includes(bar),
      );

      // Only FINAL bars count as "we fetched real data through this date" for the checked-through
      // watermark — a provisional bar is real data too, but not yet a trustworthy confirmation
      // that nothing else is coming for that date (it's still mid-session).
      const lastFetchedDate = finalBars.at(-1)?.date ?? null;
      const checkedThroughCandidate =
        lastFetchedDate !== null && lastFetchedDate > safeAbsenceThrough
          ? lastFetchedDate
          : safeAbsenceThrough;
      if (checkedThroughCandidate >= sinceDate) {
        checkedThroughUpdates.push({
          ticker,
          checkedThroughDate: checkedThroughCandidate,
          checkedAt,
        });
      }

      if (provisional !== undefined) {
        if (dryRun) {
          console.log(
            `${ticker}: session still open — would write a provisional bar for ${provisional.date} ` +
              `(close ${String(provisional.close)}); --dry-run, not writing.`,
          );
        } else if (realStore !== undefined) {
          writeProvisionalBar(realStore, identity, ticker, provisional, checkedAt);
          provisionalWrites.push({ ticker, date: provisional.date, close: provisional.close });
          console.log(
            `${ticker}: session still open — wrote a provisional bar for ${provisional.date} ` +
              `(close ${String(provisional.close)}), not yet final.`,
          );
        } else {
          console.log(
            `${ticker}: session still open (would write a provisional bar for ${provisional.date}, ` +
              `close ${String(provisional.close)}) — no --db-path given, nowhere real to write it.`,
          );
        }
      }

      if (finalBars.length === 0) {
        if (provisional === undefined) {
          console.log(`${ticker}: no new real trading days found in ${sinceDate}..${through}.`);
        }
        continue;
      }

      // The session closed and a real final bar for today just landed — any leftover provisional
      // snapshot for this ticker is now stale/redundant, never left sitting alongside the real
      // thing as if both were current.
      if (realStore !== undefined && !dryRun) {
        clearProvisionalBar(realStore, identity, ticker);
      }

      results.push({ ticker, bars: finalBars });
      const firstBar = finalBars[0];
      const lastBar = finalBars.at(-1);
      if (firstBar === undefined || lastBar === undefined) {
        throw new Error(`${ticker}: unreachable — finalBars.length was already checked to be > 0`);
      }
      console.log(
        `${ticker}: fetched ${String(finalBars.length)} bar(s), ${firstBar.date} through ${lastBar.date}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (results.length === 0 && checkedThroughUpdates.length === 0) {
    console.log(
      provisionalWrites.length > 0
        ? `\nNo new FINAL bars to append this run — wrote ${String(provisionalWrites.length)} ` +
            'provisional (session-open) snapshot(s) live.'
        : '\nNothing to append.',
    );
    return;
  }
  if (dryRun) {
    console.log(
      '\n--dry-run: not appending. Bars found:',
      JSON.stringify(Object.fromEntries(results.map((r) => [r.ticker, r.bars])), null, 2),
    );
    console.log(
      '--dry-run: checked-through watermarks that would advance:',
      JSON.stringify(checkedThroughUpdates, null, 2),
    );
    return;
  }

  let barsSql = '';
  if (results.length > 0) {
    const bars = Object.fromEntries(results.map((r) => [r.ticker, r.bars]));
    const rendered = renderAppendBarsSql(store, identity, { bars });
    if (!rendered.ok) {
      console.error(rendered.reason);
      process.exitCode = 1;
      return;
    }
    barsSql = rendered.value;
  }
  const checkedThroughSql = renderCheckedThroughSql(identity, checkedThroughUpdates);
  const sql = [barsSql, checkedThroughSql].filter((s) => s.length > 0).join('\n');

  const number = nextMigrationNumber(MIGRATIONS_DIR);
  const kind = results.length > 0 ? 'append_bars' : 'checked_through';
  const exportName = `migration${number}${results.length > 0 ? 'AppendBars' : 'CheckedThrough'}`;
  const id = `market-data/${number}_${kind}`;
  const migrationPath = join(MIGRATIONS_DIR, `${number}_${kind}.ts`);

  const docComment =
    results.length > 0
      ? `/** New bars fetched from Yahoo Finance and appended to dataset "${datasetId}" version\n * "${datasetVersion}", generated by \`scripts/fetchAndAppendBars.ts\` — never hand-edit this file;\n * a correction is always a NEW migration. */`
      : `/** Confirmed-checked-through watermarks for dataset "${datasetId}" version "${datasetVersion}"\n * (no new bars found this run), generated by \`scripts/fetchAndAppendBars.ts\` — never hand-edit\n * this file; a correction is always a NEW migration. */`;

  const source = renderMigrationFileSource({
    exportName,
    id,
    sql,
    docComment,
  });
  writeFileSync(migrationPath, source, 'utf8');

  console.log(`\nWrote ${migrationPath}`);
  console.log(
    '\nOne manual step left — add these two lines to market-data/src/migrations/index.ts:',
  );
  console.log(`  import { ${exportName} } from './${number}_append_bars.js';`);
  console.log(`  // ...and add ${exportName} to the marketDataMigrations array.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
