import { z } from 'zod';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

const BaseResearchEntitySchema = z.object({
  id: ResearchIdSchema,
  // Domain-defined (e.g. "company", "material", "reactor") — research-core does not
  // enumerate types; a domain package like research/fusion owns that vocabulary.
  type: z.string().min(1, 'entity type must be a non-empty string'),
  name: z.string().min(1, 'entity name must be a non-empty string'),
  description: z.string().optional(),
  // When this entity entered the research record — distinct from validFrom/validTo, which
  // describe the entity's real-world existence window, not when research came to know about
  // it. Without this, a state reconstruction at time T could not tell whether an entity valid
  // "since 2020" was actually known to research before or after T. Required (not spec-literal;
  // see README's temporal-semantics section for the rationale).
  recordedAt: ResearchTimestampSchema,
  validFrom: ResearchTimestampSchema.optional(),
  validTo: ResearchTimestampSchema.optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchEntitySchema = BaseResearchEntitySchema.strict().superRefine((value, ctx) => {
  if (
    value.validFrom !== undefined &&
    value.validTo !== undefined &&
    compareResearchTimestamps(value.validFrom, value.validTo) > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validTo'],
      message: `validFrom (${value.validFrom}) must not be after validTo (${value.validTo})`,
    });
  }
});

/**
 * Something research reasons about — a company, material, technology, reactor, or any other
 * domain-defined subject. research-core imposes no vocabulary on `type`; see README.md.
 */
export type ResearchEntity = z.infer<typeof ResearchEntitySchema>;

export function parseResearchEntity(raw: unknown): ValidationResult<ResearchEntity> {
  return fromZodSafeParse(ResearchEntitySchema.safeParse(raw));
}
