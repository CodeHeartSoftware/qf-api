/**
 * Prints ONE research domain's registered relationship-type taxonomy, each annotated with how
 * many of the domain's ACTUAL relationships currently carry that type — resolved by the domain's
 * public slug — as a single line of JSON on stdout: `{"ok":true,"relationshipTypes":[...]}`, or
 * `{"ok":false,"error":"..."}` for an unregistered domain (a normal, expected outcome, not a
 * thrown error). A fresh process each time — see `printDataset.ts`'s own doc comment for why.
 *
 * Usage: yarn workspace @quant-fusion/research-store run print:relationship-types -- --domain fusion
 */
import { createResearchStore } from '../src/store/db.js';
import { getResearchDataset, listResearchDatasets } from '../src/store/read.js';
import { listRelationshipTypes } from '../src/store/relationshipTypes.js';

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
      JSON.stringify({ ok: false, error: 'Usage: print:relationship-types -- --domain <domain>' }),
    );
    return;
  }

  const store = createResearchStore(':memory:');
  const match = listResearchDatasets(store).find((d) => d.domain === domain);
  if (match === undefined) {
    console.log(JSON.stringify({ ok: false, error: `no registered research domain "${domain}"` }));
    return;
  }

  const datasetResult = getResearchDataset(store, match.datasetId);
  if (!datasetResult.ok) {
    console.log(JSON.stringify({ ok: false, error: datasetResult.reason }));
    return;
  }

  const relationshipCounts = new Map<string, number>();
  for (const relationship of datasetResult.value.relationships) {
    relationshipCounts.set(relationship.type, (relationshipCounts.get(relationship.type) ?? 0) + 1);
  }

  const relationshipTypes = listRelationshipTypes(store, match.datasetId).map((t) => ({
    type: t.type,
    addedAt: t.addedAt,
    relationshipCount: relationshipCounts.get(t.type) ?? 0,
    ...(t.category !== undefined ? { category: t.category } : {}),
  }));
  console.log(JSON.stringify({ ok: true, relationshipTypes }));
}

main();
