import { z } from 'zod';
import { ConfidenceSchema } from '../common/confidence.js';
import { ResearchIdSchema } from '../common/ids.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const AssertionStatusSchema = z.enum([
  'proposed',
  'active',
  'supported',
  'contested',
  'rejected',
  'retired',
]);

export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

const BaseResearchAssertionSchema = z.object({
  id: ResearchIdSchema,
  statement: z.string().min(1, 'assertion statement must be a non-empty string'),
  status: AssertionStatusSchema,
  // Visibility (state reconstruction): gated by createdAt.
  createdAt: ResearchTimestampSchema,
  validFrom: ResearchTimestampSchema.optional(),
  validTo: ResearchTimestampSchema.optional(),
  confidence: ConfidenceSchema.optional(),
  // May be empty: some assertions are general analytical conclusions (e.g. "supplier
  // qualification does not imply commercial procurement") rather than citations of specific
  // evidence.
  evidenceIds: z.array(ResearchIdSchema),
  entityIds: z.array(ResearchIdSchema).optional(),
  relationshipIds: z.array(ResearchIdSchema).optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchAssertionSchema = BaseResearchAssertionSchema.strict().superRefine(
  (value, ctx) => {
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
  },
);

/**
 * A conclusion or generalization that isn't necessarily framed as a testable hypothesis (see
 * `ResearchHypothesis` for that) — e.g. an analytical rule-of-thumb the research relies on.
 */
export type ResearchAssertion = z.infer<typeof ResearchAssertionSchema>;

export function parseResearchAssertion(raw: unknown): ValidationResult<ResearchAssertion> {
  return fromZodSafeParse(ResearchAssertionSchema.safeParse(raw));
}
