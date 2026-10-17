import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';
import { ResearchTimestampSchema } from './timestamps.js';
import { ResearchValueSchema } from './values.js';

export const ProvenanceSchema = z
  .object({
    source: z.string().optional(),
    uri: z.string().optional(),
    publisher: z.string().optional(),
    observedAt: ResearchTimestampSchema.optional(),
    publishedAt: ResearchTimestampSchema.optional(),
    availableAt: ResearchTimestampSchema.optional(),
    retrievedAt: ResearchTimestampSchema.optional(),
    metadata: z.record(ResearchValueSchema).optional(),
  })
  .strict();

/**
 * Traceability for a piece of research: who produced it, where it came from, and the distinct
 * timestamps that matter (see the package README's temporal-semantics section for how these
 * differ from `validFrom`/`effectiveFrom`/etc. used elsewhere): `observedAt` (when a researcher
 * observed it), `publishedAt` (when its source published it), `availableAt` (when it became
 * publicly available, if different from publication), `retrievedAt` (when this record fetched
 * it from the source).
 *
 * Inferred from `ProvenanceSchema` (rather than hand-declared) so the type and its runtime
 * validation can never drift apart, and so optional fields agree with `exactOptionalPropertyTypes`.
 */
export type Provenance = z.infer<typeof ProvenanceSchema>;

export function parseProvenance(raw: unknown): ValidationResult<Provenance> {
  return fromZodSafeParse(ProvenanceSchema.safeParse(raw));
}
