import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import type { ResearchDataset } from '../dataset/dataset.js';
import { computeResearchStateAt } from '../state/provider.js';
import { ResearchStateSchema } from '../state/state.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const ResearchSnapshotSchema = z
  .object({
    datasetId: ResearchIdSchema,
    // Not in the spec's literal §32 interface — added because a consumer (e.g. a bot, or a
    // reproducibility record) generally needs to know WHICH published version of the dataset
    // this snapshot was reconstructed from, and the dataset already carries this field. See
    // README.md.
    datasetVersion: z.string().min(1),
    timestamp: ResearchTimestampSchema,
    state: ResearchStateSchema,
  })
  .strict();

/**
 * A self-contained, serializable, immutable-from-the-consumer's-perspective view of research at
 * one point in time — the object eventually handed to a bot. Bots must never receive direct
 * dataset/provider access, only snapshots like this.
 */
export type ResearchSnapshot = z.infer<typeof ResearchSnapshotSchema>;

export function parseResearchSnapshot(raw: unknown): ValidationResult<ResearchSnapshot> {
  return fromZodSafeParse(ResearchSnapshotSchema.safeParse(raw));
}

/** Convenience constructor: reconstructs state at `timestamp` and wraps it as a snapshot. */
export function createResearchSnapshot(
  dataset: ResearchDataset,
  timestamp: ResearchSnapshot['timestamp'],
): ResearchSnapshot {
  return {
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    timestamp,
    state: computeResearchStateAt(dataset, timestamp),
  };
}
