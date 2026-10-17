import path from 'node:path';
import { registerMigration } from './migrationRegistration.js';
import { runCommand } from './subprocess.js';

const MARKET_DATA_MIGRATIONS_INDEX = [
  'packages',
  'stock-market-4',
  'market-data',
  'src',
  'migrations',
  'index.ts',
];

export interface AddNewTickerArgs {
  datasetId: string;
  datasetVersion: string;
  ticker: string;
  /** Defaults to `ticker` itself in the underlying script (the common case for a US-listed
   * symbol) when omitted. */
  yahooSymbol?: string;
  /** Defaults to `'USD'` in the underlying script when omitted. */
  currency?: string;
  /** Defaults to `1` in the underlying script when omitted. */
  usdRate?: number;
  since?: string;
  through?: string;
}

export interface AddNewTickerResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Fetches real Yahoo Finance bars for a ticker that's never been published before, via
 * `@quant-fusion/market-data`'s own `add:new-ticker` script (see that script's own doc comment for
 * why this is a genuinely different action from the Jobs tab's "Fetch Latest Price Data" — that
 * one only ever grows tickers already in a universe). Same "generate a migration, register it,
 * rebuild" pattern as `apps/api`'s other Phase B actions (e.g.
 * `researchStore.ts`'s `manageEventType`) — parsed generically off the script's own printed
 * import/export lines rather than hardcoding a filename convention, since this script's migration
 * file names (`..._add_new_ticker_<ticker>.ts`) differ from `fetch:append-bars`'s own
 * (`..._append_bars.ts`), which `routes/marketData.ts`'s `registerMarketDataMigration` hardcodes. */
export async function addNewTicker(
  rootDir: string,
  args: AddNewTickerArgs,
): Promise<AddNewTickerResult> {
  const result = await runCommand(
    'yarn',
    [
      'workspace',
      '@quant-fusion/market-data',
      'run',
      'add:new-ticker',
      '--',
      '--dataset-id',
      args.datasetId,
      '--dataset-version',
      args.datasetVersion,
      '--ticker',
      args.ticker,
      ...(args.yahooSymbol !== undefined ? ['--yahoo-symbol', args.yahooSymbol] : []),
      ...(args.currency !== undefined ? ['--currency', args.currency] : []),
      ...(args.usdRate !== undefined ? ['--usd-rate', String(args.usdRate)] : []),
      ...(args.since !== undefined ? ['--since', args.since] : []),
      ...(args.through !== undefined ? ['--through', args.through] : []),
    ],
    { cwd: rootDir },
  );
  if (!result.ok) {
    return { ok: false, output: result.output, error: result.output };
  }

  const importMatch = /import \{ (\w+) \} from '\.\/([^']+)\.js';/.exec(result.output);
  if (importMatch?.[1] === undefined || importMatch[2] === undefined) {
    // The script exited 0 but printed nothing to register — e.g. Yahoo Finance had no real
    // trading days in the requested range. Not a failure this caller should surface as one.
    return { ok: true, output: result.output };
  }
  const exportName = importMatch[1];
  const migrationFileName = `${importMatch[2]}.js`;

  const indexPath = path.join(rootDir, ...MARKET_DATA_MIGRATIONS_INDEX);
  await registerMigration(
    indexPath,
    `import { ${exportName} } from './${migrationFileName}';`,
    exportName,
  );

  const builds = await Promise.all([
    runCommand('yarn', ['workspace', '@quant-fusion/market-data', 'build'], { cwd: rootDir }),
    runCommand('yarn', ['workspace', '@quant-fusion/stock-market-4-db', 'build'], { cwd: rootDir }),
  ]);
  const failed = builds.find((b) => !b.ok);
  if (failed !== undefined) {
    return {
      ok: false,
      output: result.output,
      error: `"${args.ticker}" was fetched but rebuilding failed:\n${failed.output}`,
    };
  }

  return { ok: true, output: result.output };
}
