import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Removes the ELMT <-> Masan High-Tech Materials test data 0091/0092 recorded while exercising the
 * research-update flow (evidence ids ending "-test1", placeholder TradingView URIs) — never real
 * research. Deleted by a NEW migration rather than by editing/removing 0091/0092, which are already
 * applied to existing databases. 0090's "equity stake acquisition" relationship type stays. */
export const migration0093RemoveElmtMasanTestData: Migration = {
  id: "research-store/0093_remove_elmt_masan_test_data",
  sql: `
DELETE FROM hypotheses WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'hypothesis-test-elmt-masan-supply-deepening';
DELETE FROM relationships WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'rel-elmt-masan-high-tech-materials';
DELETE FROM evidence WHERE dataset_id = 'dataset-fusion-2026-09' AND id IN ('evidence-elmt-rel-2026-09-20-test1', 'evidence-elmt-hyp-2026-09-20-test1');
DELETE FROM entities WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'entity-masan-high-tech-materials';
UPDATE research_datasets SET version = '2026.09+update.71', updated_at = '2026-10-15T00:00:00.000Z' WHERE dataset_id = 'dataset-fusion-2026-09';
`,
};
