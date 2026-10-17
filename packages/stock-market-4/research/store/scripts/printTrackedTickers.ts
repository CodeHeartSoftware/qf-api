/**
 * Prints ONE research domain's news watchlist — resolved by its public `domain` slug — as a
 * single line of JSON on stdout: `{"ok":true,"tickers":[...]}`, or `{"ok":false,"error":"..."}`
 * for an unregistered domain (a normal, expected outcome, not a thrown error). A fresh process
 * each time — see `printDataset.ts`'s own doc comment for why.
 *
 * Usage: yarn workspace @quant-fusion/research-store run print:tracked-tickers -- --domain fusion
 */
import { createResearchStore } from '../src/store/db.js';
import { listResearchDatasets } from '../src/store/read.js';
import { listTrackedTickers } from '../src/store/trackedTickers.js';

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
  const domain = args.domain;
  if (domain === undefined) {
    console.log(
      JSON.stringify({ ok: false, error: 'Usage: print:tracked-tickers -- --domain <domain>' }),
    );
    return;
  }

  const store = createResearchStore(':memory:');
  const match = listResearchDatasets(store).find((d) => d.domain === domain);
  if (match === undefined) {
    console.log(JSON.stringify({ ok: false, error: `no registered research domain "${domain}"` }));
    return;
  }

  const tickers = listTrackedTickers(store, match.datasetId);
  console.log(JSON.stringify({ ok: true, tickers }));
}

main();
