/**
 * Prints every registered research domain — one row per `research_datasets` entry, enriched with
 * per-collection counts — as a single line of JSON on stdout. The generic replacement for a
 * hardcoded per-domain registry (previously a plain TS array in `apps/api`'s
 * `routes/research.ts`): "which domains exist" is itself data in this package's own migrations
 * now (see `src/migrations/0001_init.ts`'s doc comment on `research_datasets`), so listing them
 * is a query, not a list a developer edits by hand for every new domain.
 *
 * A fresh process each time — see `printDataset.ts`'s own doc comment for why.
 *
 * Usage: yarn workspace @quant-fusion/research-store run print:domains
 */
import { createResearchStore } from '../src/store/db.js';
import { getResearchDataset, listResearchDatasets } from '../src/store/read.js';

function main(): void {
  const store = createResearchStore(':memory:');
  const domains = listResearchDatasets(store).map((row) => {
    const result = getResearchDataset(store, row.datasetId);
    if (!result.ok) {
      throw new Error(
        `domain "${row.domain}" (dataset "${row.datasetId}") is corrupt: ${result.reason}`,
      );
    }
    const dataset = result.value;
    return {
      domain: dataset.domain,
      id: dataset.id,
      name: dataset.name,
      version: dataset.version,
      priority: row.priority,
      entityCount: dataset.entities.length,
      relationshipCount: dataset.relationships.length,
      hypothesisCount: dataset.hypotheses.length,
      eventCount: dataset.events.length,
    };
  });
  console.log(JSON.stringify({ domains }));
}

main();
