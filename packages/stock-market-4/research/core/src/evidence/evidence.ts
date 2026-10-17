import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';
import { EvidenceSourceSchema } from './source.js';

export const EvidenceSchema = z
  .object({
    id: ResearchIdSchema,
    // Visibility (state reconstruction): gated by observedAt, not publishedAt/availableAt — a
    // snapshot at time T may include this evidence once a researcher had actually observed it,
    // regardless of when the underlying source was published or became public. See README.md.
    observedAt: ResearchTimestampSchema,
    publishedAt: ResearchTimestampSchema.optional(),
    availableAt: ResearchTimestampSchema.optional(),
    source: EvidenceSourceSchema,
    // Should describe an observation, not an interpretation (e.g. "ELMT reported
    // development-stage work with CFS" rather than "ELMT is likely to become a supplier") — a
    // discipline this package documents but cannot mechanically enforce; see README.md.
    description: z.string().min(1, 'evidence description must be a non-empty string'),
    entityIds: z.array(ResearchIdSchema),
    metadata: z.record(ResearchValueSchema).optional(),
  })
  .strict();

/**
 * An observation or source-derived fact — never the researcher's interpretation of it (that
 * belongs in a `ResearchAssertion` or `ResearchHypothesis`, which cite evidence rather than
 * being it). See EvidenceSchema's `description` note.
 */
export type Evidence = z.infer<typeof EvidenceSchema>;

export function parseEvidence(raw: unknown): ValidationResult<Evidence> {
  return fromZodSafeParse(EvidenceSchema.safeParse(raw));
}
