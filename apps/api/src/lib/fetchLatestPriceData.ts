import path from 'node:path';
import type { MarketUniverse } from './marketUniverses.js';
import { registerMigration } from './migrationRegistration.js';
import { defaultForwardMatchStoreDbPath } from './paths.js';
import { runCommand } from './subprocess.js';

const MARKET_DATA_MIGRATIONS_INDEX = [
  'packages',
  'stock-market-4',
  'market-data',
  'src',
  'migrations',
  'index.ts',
];

/** `fetchAndAppendBars.ts` (`@quant-fusion/market-data`'s own price-fetch script) already writes a
 * new, self-contained migration file for whatever it fetched — but stops short of the "ONE manual
 * step left" it prints (adding the import + array entry to this file), by design: a previously-
 * applied migration must never be edited, and the script has no way to know this is the only
 * writer ever meant to touch this particular list. This does that one step for it, the exact edit
 * a developer following the script's own printed instructions would make by hand — see
 * `../lib/migrationRegistration.ts` for the shared mechanics. Takes `fileBaseName` (not hardcoded)
 * because the script generates one of TWO kinds depending on what it found: `append_bars` (new
 * final bars) or `checked_through` (nothing new to append, only a confirmed-checked-through
 * watermark advance — see that script's own doc comment) — both need registering the same way. */
async function registerMarketDataMigration(
  rootDir: string,
  migrationNumber: string,
  fileBaseName: 'append_bars' | 'checked_through',
  exportName: string,
): Promise<void> {
  const indexPath = path.join(rootDir, ...MARKET_DATA_MIGRATIONS_INDEX);
  const importStatement = `import { ${exportName} } from './${migrationNumber}_${fileBaseName}.js';`;
  await registerMigration(indexPath, importStatement, exportName);
}

// `fetchAndAppendBars.ts` has no way to know a caller is about to do its "one manual step" for
// it (see that script's own comment on why it stops short itself), so it always prints this
// block — genuinely correct advice when a person runs the script directly, but actively false by
// the time this route's own `registerMarketDataMigration` above has already done it. Left as-is,
// the job's own raw log (rendered verbatim by `JobCard.tsx`'s `ActionLog`, right below this same
// response's reassuring `note`) told the user to hand-edit a file that had already been edited.
// Replaced with a short pointer back to that `note` instead of just deleted, so the log still
// honestly reflects that a migration WAS generated — nothing here is hidden, only the
// now-inapplicable instruction.
const MANUAL_STEP_BLOCK_REGEX =
  /\n?One manual step left — add these two lines to market-data\/src\/migrations\/index\.ts:\n {2}import .*\n {2}\/\/ \.\.\.and add .* to the marketDataMigrations array\.\n?/;

function stripAlreadyHandledManualStep(output: string): string {
  return output.replace(
    MANUAL_STEP_BLOCK_REGEX,
    "\n(That migration was already registered automatically — see this run's own note above.)\n",
  );
}

/** Fires the `market-data`/`stock-market-4-db` rebuild WITHOUT awaiting it, so the route that
 * triggered it can return its response before the rebuild (which overwrites `dist/index.js`, this
 * API's own resolved import target for `@quant-fusion/market-data`) has a chance to run. Exactly
 * the same "Failed to fetch" fix `apps/api/src/lib/researchStore.ts`'s own
 * `rebuildResearchStoreInBackground` already established for research updates — this route had
 * the identical bug (an `await`ed rebuild racing `tsx watch`'s restart against the in-flight HTTP
 * response) and needed the identical fix. The migration file + its `index.ts` registration are
 * ALREADY durable by the time this is called — the rebuild only affects how soon a FUTURE read
 * picks it up. A rebuild failure is logged, never thrown — it can't retroactively un-succeed a
 * fetch whose migration file is already on disk. */
function rebuildMarketData(rootDir: string) {
  return Promise.all([
    runCommand('yarn', ['workspace', '@quant-fusion/market-data', 'build'], { cwd: rootDir }),
    runCommand('yarn', ['workspace', '@quant-fusion/stock-market-4-db', 'build'], { cwd: rootDir }),
  ]);
}

function rebuildMarketDataInBackground(rootDir: string): void {
  rebuildMarketData(rootDir)
    .then((builds) => {
      const failed = builds.find((b) => !b.ok);
      if (failed !== undefined) {
        console.error(
          `rebuilding market-data/stock-market-4-db failed after a fetch:\n${failed.output}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(
        `rebuilding market-data/stock-market-4-db failed after a fetch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
}

export interface FetchLatestPriceDataResult {
  ok: boolean;
  universeId: string;
  datasetId: string;
  datasetVersion: string;
  tickers: string[];
  fetchedNewBars: boolean;
  output: string;
  note: string;
}

/** The Jobs panel's "Fetch Latest Price Data" for ONE explicit market universe (see
 * `../lib/marketUniverses.ts`) — runs the real fetch script against that universe's own pinned
 * dataset identity/tickers, and (only when it actually generated a new migration) registers it
 * and rebuilds `market-data`/`stock-market-4-db` so the new bars are live in THOSE packages' own
 * `dist/`. Always resolves against the combined db `defaultForwardMatchStoreDbPath` points at —
 * the one real db this app's match/price data lives in — not a per-universe path, since every
 * universe registered today shares it (see that registry's own doc comment on why a second
 * game's universe might one day need its own). Deliberately does NOT also resume/advance any
 * match — that is the separate, explicit "Run Next Round" action on the Matches panel, not a side
 * effect of a price refresh (mirrors `matchForwardRefresh.ts`'s own "top up, then delegate to
 * run" split, just without the delegate-to-run half). */
export async function fetchLatestPriceData(
  rootDir: string,
  universe: MarketUniverse,
  options: { rebuild?: 'background' | 'await' } = {},
): Promise<FetchLatestPriceDataResult> {
  const dbPath = defaultForwardMatchStoreDbPath(rootDir);
  const fetched = await runCommand(
    'yarn',
    [
      'workspace',
      '@quant-fusion/market-data',
      'run',
      'fetch:append-bars',
      '--',
      '--dataset-id',
      universe.datasetId,
      '--dataset-version',
      universe.datasetVersion,
      '--tickers',
      universe.tickers.join(','),
      '--db-path',
      dbPath,
    ],
    { cwd: rootDir },
  );

  // The script writes exactly one of two migration kinds per run — see its own doc comment:
  // `append_bars` when it found new FINAL bars, `checked_through` when it didn't but still
  // confirmed one or more tickers' watermarks (e.g. a market holiday). Both need registering the
  // same way; only `append_bars` counts as `fetchedNewBars` (real new price data), since a
  // checked-through-only run hasn't actually grown the dataset.
  const appendBarsMatch = /Wrote .*[/\\](\d+)_append_bars\.ts/.exec(fetched.output);
  const checkedThroughMatch =
    appendBarsMatch === null ? /Wrote .*[/\\](\d+)_checked_through\.ts/.exec(fetched.output) : null;
  const migrationNumber = appendBarsMatch?.[1] ?? checkedThroughMatch?.[1];

  if (migrationNumber !== undefined) {
    const fileBaseName = appendBarsMatch !== null ? 'append_bars' : 'checked_through';
    const exportSuffix = appendBarsMatch !== null ? 'AppendBars' : 'CheckedThrough';
    await registerMarketDataMigration(
      rootDir,
      migrationNumber,
      fileBaseName,
      `migration${migrationNumber}${exportSuffix}`,
    );
    if (options.rebuild === 'await') {
      // The daily-cycle worker's path: it runs `match forward run` in a FRESH process right after
      // this, which only sees the new bars once `market-data`'s `dist/` includes the migration —
      // so it must wait. Safe there (unlike in a route handler) because that worker is a detached
      // process: the `tsx watch` restart this rebuild triggers in the API can't take it down.
      const builds = await rebuildMarketData(rootDir);
      const failed = builds.find((b) => !b.ok);
      if (failed !== undefined) {
        return {
          ok: false,
          universeId: universe.id,
          datasetId: universe.datasetId,
          datasetVersion: universe.datasetVersion,
          tickers: [...universe.tickers],
          fetchedNewBars: appendBarsMatch !== null,
          output: `${fetched.output}\n${failed.output}`,
          note: 'Fetched new price data, but rebuilding market-data failed — see the output.',
        };
      }
    } else {
      rebuildMarketDataInBackground(rootDir);
    }
  }

  return {
    ok: fetched.ok,
    universeId: universe.id,
    datasetId: universe.datasetId,
    datasetVersion: universe.datasetVersion,
    tickers: [...universe.tickers],
    fetchedNewBars: appendBarsMatch !== null,
    output:
      migrationNumber !== undefined
        ? stripAlreadyHandledManualStep(fetched.output)
        : fetched.output,
    note:
      appendBarsMatch !== null
        ? 'New price data was fetched and saved — no restart needed. The rebuild that makes a ' +
          'FUTURE read reflect it runs in the background and usually finishes in well under a ' +
          'second, but a read that races it very closely could still see the prior version once.'
        : checkedThroughMatch !== null
          ? 'No new price data this run, but one or more tickers’ confirmed-checked-through ' +
            'watermarks advanced (see market-data’s own ticker_checked_through table) — ' +
            'rebuilding in the background so future reads reflect it.'
          : 'Checked every tracked ticker — no new trading days were available to fetch.',
  };
}
