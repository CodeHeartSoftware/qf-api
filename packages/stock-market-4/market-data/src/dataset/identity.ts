import { z } from 'zod';

/**
 * Identifies exactly one immutable, published version of a dataset — the unit every query in
 * this package is scoped to. A correction to a dataset is published as a NEW version (see
 * `store/ingest.ts`'s `publishDatasetVersion`); an existing `(id, version)` pair's rows are never
 * mutated or deleted, so a competition that recorded which version it ran against stays
 * reproducible even after the dataset is later corrected (the roadmap's dataset-versioning
 * requirement).
 */
export const MarketDatasetIdentitySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();
export type MarketDatasetIdentity = z.infer<typeof MarketDatasetIdentitySchema>;
