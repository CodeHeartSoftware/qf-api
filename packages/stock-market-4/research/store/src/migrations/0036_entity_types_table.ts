import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * A domain's registered entity-type taxonomy — which `type` values the Add/Edit Entity modal
 * offers, NOT the `type` values already recorded on existing entities. Deliberately separate from
 * `ResearchDataset`/`entities`, same reasoning as `0034_event_types_table.ts`'s own doc comment: a
 * registered type is app-level configuration ("what can a NEW or edited entity be tagged with"),
 * not research content, so renaming or removing one here never rewrites any entity already
 * recorded with the old type string — it only changes the going-forward dropdown option. Unlike
 * events, entities ARE individually editable/deletable already (`renderDeleteSql`,
 * `mergeResearchUpdate`'s edit-by-id path) — this table isn't a substitute for that, it's only the
 * suggestion list a NEW/edited entity's type field is constrained to.
 */
export const migration0036EntityTypesTable: Migration = {
  id: 'research-store/0036_entity_types_table',
  sql: `
CREATE TABLE IF NOT EXISTS entity_types (
  dataset_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (dataset_id, type),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
`,
};
