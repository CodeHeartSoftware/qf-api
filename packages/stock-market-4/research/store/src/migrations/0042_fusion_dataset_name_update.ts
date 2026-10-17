import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Renames the "dataset-fusion-2026-09" dataset from its original seed name to "Fusion Research"
 * — `0002_fusion_seed`'s own doc comment already says a later research update, never an edit to
 * that migration, is how this kind of change belongs; an earlier commit violated that rule by
 * editing `0002_fusion_seed.ts`'s SQL directly, which broke `applyMigrations`'s checksum guard for
 * any database that had already applied the original content. This migration is the correct
 * fix: `0002_fusion_seed.ts` is reverted back to its original, already-applied text, and this
 * migration applies the intended rename instead. */
export const migration0042FusionDatasetNameUpdate: Migration = {
  id: 'research-store/0042_fusion_dataset_name_update',
  sql: `
UPDATE research_datasets SET name = 'Fusion Research', updated_at = '2026-09-21T18:00:00.000Z' WHERE dataset_id = 'dataset-fusion-2026-09' AND name = 'Fusion Research (September 2026 snapshot)';
`,
};
