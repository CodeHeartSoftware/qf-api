import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Renames `relationship_types.group_name` (added by
 * `0040_relationship_types_group_column.ts`) to `category`, reflecting a narrower feature than
 * originally shipped: a person doesn't invent an arbitrary group label anymore — they SORT a
 * relationship type into one of the Quant tab's own pre-existing Exposure Map categories
 * (`manufacturing`/`qualification`/`contract`/`program` — the four dimensions
 * `@thunderdome/quant-sdk-js`'s own `computeExposureMap` already classifies relationships into;
 * see that function's own doc comment). This package still enforces nothing about WHICH values
 * are valid here — it's still just an optional string column — the fixed set of allowed
 * categories is `apps/stock-market-4-api`'s own business rule (that's the one place that already
 * knows about quant-sdk-js's dimension names), enforced in `quantAnalysis.ts`/`routes/research.ts`
 * before this store is ever called.
 */
export const migration0041RelationshipTypesCategoryColumn: Migration = {
  id: 'research-store/0041_relationship_types_category_column',
  sql: `
ALTER TABLE relationship_types RENAME COLUMN group_name TO category;
`,
};
