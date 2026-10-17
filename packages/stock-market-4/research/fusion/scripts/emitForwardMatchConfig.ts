/**
 * Emits a complete `stock-market-4` FORWARD_SHADOW match `--config` JSON to stdout, wiring
 * `@quant-fusion/research-fusion`'s fixture into `researchTimeline` via `buildResearchTimeline` —
 * the piece `match forward run` has no other way to get (unlike `runBacktest.ts`, which calls
 * `createResearchSnapshot` fresh per simulated day, a real match's config carries the whole
 * timeline up front once, at creation).
 *
 * Usage (`--universe` and `--db-path` are both optional — see their defaults below; NOTE:
 * `yarn workspace <pkg> run <script>` always writes its own "yarn run vX"/"$ <command>"/"Done in
 * Xs" banner to STDOUT — even with `--silent` — corrupting piped JSON; `cd` into the package and
 * use plain `yarn run --silent` instead, see scripts/README.md's own "known yarn
 * stdout-pollution issue" note in the repo root for the full explanation):
 *   (cd packages/stock-market-4/research/fusion && yarn run emit:forward-config --silent -- \
 *     --market-dataset-id fusion-fundamental-v0 --market-dataset-version 3 \
 *     --start-date 2026-07-13 --end-date 2026-12-31) > config.json
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKED_SECURITIES } from '@quant-fusion/fusion-universe';
import { REALISTIC_EXECUTION } from '@quant-fusion/game-stock-market-4';
import { createFusionFixtureDataset } from '../src/fixture.js';
import { buildResearchTimeline } from '../src/timeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Absolute, not "./.quant-fusion/db.sqlite" — a relative default silently broke
// when this config's dbPath was later read from a different cwd (see apps/cli's
// `matchForwardRefresh.ts`, which had to work around exactly this by re-resolving it at call
// time). Anchoring it here, once, at the actual source of the config, removes that whole class of
// bug for every future consumer.
const REPO_ROOT = resolve(__dirname, '../../../../..');
const DEFAULT_DB_PATH = resolve(REPO_ROOT, '.quant-fusion/db.sqlite');

function requireArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (value === undefined) throw new Error(`missing required --${name}`);
  return value;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    args[name] = value;
    i++;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const asOfDate = args['as-of-date'] ?? requireArg(args, 'end-date');
  const dbPath = args['db-path'] ?? DEFAULT_DB_PATH;
  // Defaults to the full 11-ticker universe (@quant-fusion/fusion-universe's own canonical order)
  // rather than requiring it be hand-typed on every invocation — pass --universe to trade a subset.
  const universe = args.universe ?? TRACKED_SECURITIES.map((s) => s.ticker).join(',');

  // Realistic execution (next-open fills plus spread/impact/volume cap — see the game's
  // `REALISTIC_EXECUTION`) for every new match; `--execution legacy` keeps the original same-close,
  // cost-free fills, e.g. to reproduce an older match's numbers.
  const executionArg = args.execution ?? 'realistic';
  if (executionArg !== 'realistic' && executionArg !== 'legacy') {
    throw new Error(`--execution must be "realistic" or "legacy", got "${executionArg}"`);
  }

  const dataset = createFusionFixtureDataset();
  const researchTimeline = buildResearchTimeline(dataset, asOfDate);

  const config = {
    gameType: 'FORWARD_SHADOW',
    marketDataUniverse: universe.split(','),
    marketDataset: {
      id: requireArg(args, 'market-dataset-id'),
      version: requireArg(args, 'market-dataset-version'),
      dbPath,
    },
    startDate: requireArg(args, 'start-date'),
    endDate: requireArg(args, 'end-date'),
    researchTimeline,
    ...(executionArg === 'realistic' ? { execution: REALISTIC_EXECUTION } : {}),
  };

  process.stdout.write(JSON.stringify(config));
}

main();
