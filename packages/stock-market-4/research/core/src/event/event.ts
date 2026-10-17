import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const ResearchEventSchema = z
  .object({
    id: ResearchIdSchema,
    // Visibility (state reconstruction): gated by timestamp.
    timestamp: ResearchTimestampSchema,
    // Domain-defined (e.g. "SUPPLIER_QUALIFIED") — research-core does not enumerate event
    // types; a domain package like research/fusion owns that vocabulary.
    type: z.string().min(1, 'event type must be a non-empty string'),
    entityIds: z.array(ResearchIdSchema),
    payload: z.record(ResearchValueSchema),
    evidenceIds: z.array(ResearchIdSchema),
  })
  .strict();

/**
 * A modeled occurrence (e.g. `SUPPLIER_QUALIFIED`), distinct from the `Evidence` that supports
 * it (e.g. "Company X announced successful qualification") — see EvidenceSchema.
 */
export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

export function parseResearchEvent(raw: unknown): ValidationResult<ResearchEvent> {
  return fromZodSafeParse(ResearchEventSchema.safeParse(raw));
}
