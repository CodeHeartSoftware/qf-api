import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Adds an optional `group_name` to `relationship_types` (see
 * `0038_relationship_types_table.ts`'s own doc comment for the table itself) — lets a person tag
 * several relationship types as one user-defined "group" (e.g. every supplier-ish type as
 * "supply chain"), purely so the Quant tab's Exposure Map can render one extra `ExposureMapCard`
 * per group. This is deliberately layered ON TOP of the registered taxonomy, not a new table:
 * a type either belongs to no group (`NULL`, the default for every already-registered type) or
 * exactly one. Never read by `@thunderdome/quant-sdk-js`'s own `computeExposureMap` — that
 * function is the real quant bot's own logic and stays untouched; a custom group is a SEPARATE,
 * additive categorization computed only in `apps/stock-market-4-api`'s `quantAnalysis.ts` for
 * this UI, never part of the bot's actual trading computation.
 *
 * Superseded by `0041_relationship_types_category_column.ts`, which renames this column to
 * `category` — the shipped feature narrowed from "any arbitrary group label" to "sort into one of
 * the Exposure Map's own pre-existing categories," so keep reading there for the current shape;
 * this migration stays as history (its own `sql` is never edited after the fact, per this
 * package's usual "never hand-edit this file" rule for later-generated migrations).
 */
export const migration0040RelationshipTypesGroupColumn: Migration = {
  id: 'research-store/0040_relationship_types_group_column',
  sql: `
ALTER TABLE relationship_types ADD COLUMN group_name TEXT;
`,
};
