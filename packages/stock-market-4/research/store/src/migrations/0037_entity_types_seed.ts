import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Backfills `entity_types` with every distinct `type` already used by an existing entity, across
 * every domain — same reasoning as `0035_event_types_seed.ts`'s own doc comment: every value this
 * needs already lives in the `entities` table by this point in migration history, so this is one
 * generic `INSERT ... SELECT`, not hand-enumerated per-domain literals.
 */
export const migration0037EntityTypesSeed: Migration = {
  id: 'research-store/0037_entity_types_seed',
  sql: `
INSERT INTO entity_types (dataset_id, type, added_at)
SELECT DISTINCT dataset_id, type, '2026-09-20T00:00:00Z' FROM entities;
`,
};
