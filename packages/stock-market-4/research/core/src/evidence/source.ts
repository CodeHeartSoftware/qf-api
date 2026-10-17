import { z } from 'zod';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const EvidenceSourceSchema = z
  .object({
    name: z.string().min(1, 'evidence source name must be a non-empty string'),
    uri: z.string().optional(),
    publisher: z.string().optional(),
    retrievedAt: ResearchTimestampSchema.optional(),
    metadata: z.record(ResearchValueSchema).optional(),
  })
  .strict();

/**
 * Where a piece of evidence came from — preserved explicitly rather than collapsed into a bare
 * URL, so provenance survives even if the URL later rots.
 */
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export function parseEvidenceSource(raw: unknown): ValidationResult<EvidenceSource> {
  return fromZodSafeParse(EvidenceSourceSchema.safeParse(raw));
}
