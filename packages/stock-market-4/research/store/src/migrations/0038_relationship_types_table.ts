import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * A domain's registered relationship-type taxonomy — which `type` values the Add Relationship
 * modal offers, NOT the `type` values already recorded on existing relationships. Deliberately
 * separate from `ResearchDataset`/`relationships`, same reasoning as
 * `0036_entity_types_table.ts`'s own doc comment: a registered type is app-level configuration
 * ("what can a NEW relationship be tagged with"), not research content, so renaming or removing
 * one here never rewrites any relationship already recorded with the old type string — it only
 * changes the going-forward dropdown option. `research-core` has no "edit a relationship's type
 * in place" concept either (see `RelationshipFormModal.tsx`'s own doc comment — a relationship's
 * type is fixed at creation, only its `states[]` evolve), so this table only ever constrains a
 * BRAND NEW relationship's type field, never an edit.
 */
export const migration0038RelationshipTypesTable: Migration = {
  id: 'research-store/0038_relationship_types_table',
  sql: `
CREATE TABLE IF NOT EXISTS relationship_types (
  dataset_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (dataset_id, type),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
`,
};
