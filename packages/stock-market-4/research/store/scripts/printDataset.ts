/**
 * Prints ONE research domain's full current dataset — resolved by its public `domain` slug, not
 * its internal `dataset_id` — as a single line of JSON on stdout: `{"ok":true,"dataset":{...}}`,
 * or `{"ok":false,"error":"..."}` if no domain by that name is registered (a normal, expected
 * outcome — not a thrown error).
 *
 * A fresh process each time, not an in-process import: this is what lets a long-lived server
 * (`apps/api`) always read the CURRENT dataset, including one just grown by
 * `apply:research-update` moments ago — Node has no way to hot-reload an already-imported ESM
 * module, but a brand-new process has no such stale cache to begin with. Generic across every
 * domain, superseding each domain package's own bespoke "print my dataset" script (the retired
 * `research-fusion` `print:dataset`, `research-quantum`'s in-process
 * `createQuantumSkeletonDataset` import) now that domain data lives entirely in this package's own
 * migrations.
 *
 * Usage: yarn workspace @quant-fusion/research-store run print:dataset -- --domain fusion
 */
import { createResearchStore } from '../src/store/db.js';
import { getResearchDataset, listResearchDatasets } from '../src/store/read.js';

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
    console.log(JSON.stringify({ ok: false, error: 'Usage: print:dataset -- --domain <domain>' }));
    return;
  }

  const store = createResearchStore(':memory:');
  const match = listResearchDatasets(store).find((d) => d.domain === domain);
  if (match === undefined) {
    console.log(JSON.stringify({ ok: false, error: `no registered research domain "${domain}"` }));
    return;
  }

  const result = getResearchDataset(store, match.datasetId);
  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, error: result.reason }));
    return;
  }
  console.log(JSON.stringify({ ok: true, dataset: result.value }));
}

main();
