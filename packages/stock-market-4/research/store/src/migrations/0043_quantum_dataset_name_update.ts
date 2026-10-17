import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Renames the "dataset-quantum-skeleton" dataset from its original seed name to "Quantum
 * Research" — see `0042_fusion_dataset_name_update.ts`'s doc comment for why this is a follow-up
 * migration rather than an edit to `0003_quantum_seed.ts` (which is reverted back to its
 * original, already-applied text). */
export const migration0043QuantumDatasetNameUpdate: Migration = {
  id: 'research-store/0043_quantum_dataset_name_update',
  sql: `
UPDATE research_datasets SET name = 'Quantum Research', updated_at = '2026-09-21T18:00:00.000Z' WHERE dataset_id = 'dataset-quantum-skeleton' AND name = 'Quantum Research (skeleton)';
`,
};
