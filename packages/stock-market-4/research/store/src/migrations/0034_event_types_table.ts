import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * A domain's registered event-type taxonomy — which `type` values the Add Event modal offers
 * (`apps/stock-market-4-api`'s "Manage Event Types" feature), NOT the `type` values already recorded on
 * existing events. Deliberately separate from `ResearchDataset`/`events`, same reasoning as
 * `0009_tracked_tickers_table.ts`'s own doc comment: a registered type is app-level configuration
 * ("what can a NEW event be tagged with"), not research content, so renaming or removing one here
 * never rewrites any event already recorded with the old type string — this package has no
 * precedent for mutating already-recorded events outside the merge/delete-by-id pipeline (see
 * `src/store/sqlGen.ts`'s `renderDeleteSql` doc comment on why events aren't even deletable
 * through that path), and a registered type is a going-forward option, not itself evidence.
 */
export const migration0034EventTypesTable: Migration = {
  id: 'research-store/0034_event_types_table',
  sql: `
CREATE TABLE IF NOT EXISTS event_types (
  dataset_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (dataset_id, type),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
`,
};
