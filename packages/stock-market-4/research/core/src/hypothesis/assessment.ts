import { z } from 'zod';
import { ConfidenceSchema } from '../common/confidence.js';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';
import { HypothesisStatusSchema } from './status.js';

const BaseHypothesisAssessmentSchema = z.object({
  // Visibility (state reconstruction): gated by timestamp — a snapshot at T includes only the
  // assessments with timestamp <= T. This is how confidence changes over time without ever
  // mutating a historical assessment (see README.md).
  timestamp: ResearchTimestampSchema,
  confidence: ConfidenceSchema,
  supportingEvidenceIds: z.array(ResearchIdSchema),
  contradictingEvidenceIds: z.array(ResearchIdSchema),
  rationale: z.string().optional(),
  // Optional: records that the hypothesis's overall status changed to this value as of this
  // assessment — the same timeline confidence already lives on, rather than a second, separately
  // time-gated mechanism. Omitted on most assessments (a plain confidence update with no status
  // change); `ResearchHypothesis`'s own `superRefine` requires its top-level `status` to match
  // whichever assessment last recorded one, so the two can never silently drift apart. See
  // `hypothesis.ts`'s own doc comment for how a point-in-time snapshot uses this.
  status: HypothesisStatusSchema.optional(),
});

export const HypothesisAssessmentSchema = BaseHypothesisAssessmentSchema.strict().superRefine(
  (value, ctx) => {
    const overlap = value.supportingEvidenceIds.filter((id) =>
      value.contradictingEvidenceIds.includes(id),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contradictingEvidenceIds'],
        message: `evidence ${overlap.join(', ')} cannot both support and contradict the same assessment`,
      });
    }
  },
);

/**
 * One point-in-time read of a hypothesis's confidence (and, optionally, its status), never
 * mutated after the fact — see `ResearchHypothesis.assessments`, which accumulates these rather
 * than holding a single mutable confidence value or a status with no record of when/why it
 * changed.
 */
export type HypothesisAssessment = z.infer<typeof HypothesisAssessmentSchema>;

export function parseHypothesisAssessment(raw: unknown): ValidationResult<HypothesisAssessment> {
  return fromZodSafeParse(HypothesisAssessmentSchema.safeParse(raw));
}
