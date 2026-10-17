import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import {
  compareResearchTimestamps,
  ResearchTimestampSchema,
  toEpochMillis,
} from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import {
  fromZodSafeParse,
  type ValidationIssue,
  type ValidationResult,
} from '../validation/issue.js';
import { HypothesisAssessmentSchema, type HypothesisAssessment } from './assessment.js';
import { ResearchCriterionSchema } from './criterion.js';
import { HypothesisStatusSchema } from './status.js';

// Re-exported (not just used internally) — every existing consumer imports these from here or
// from the package barrel, both of which keep working unchanged now that the definition itself
// lives in `status.ts` (moved so `assessment.ts` can reference it too without an import cycle).
export { HypothesisStatusSchema, type HypothesisStatus } from './status.js';

/**
 * Two assessments of the same hypothesis sharing a timestamp would make "what was the
 * confidence at that instant" ambiguous — flagged rather than silently resolved by array order.
 */
export function findDuplicateAssessmentTimestamps(
  assessments: readonly HypothesisAssessment[],
): ValidationIssue[] {
  const indicesByInstant = new Map<number, number[]>();
  assessments.forEach((assessment, index) => {
    const millis = toEpochMillis(assessment.timestamp);
    const indices = indicesByInstant.get(millis) ?? [];
    indices.push(index);
    indicesByInstant.set(millis, indices);
  });

  const issues: ValidationIssue[] = [];
  for (const indices of indicesByInstant.values()) {
    if (indices.length <= 1) continue;
    const [first] = indices;
    if (first === undefined) continue; // unreachable given the length check above
    issues.push({
      path: `assessments.${String(first)}`,
      code: 'ambiguous-assessment-timestamp',
      message: `assessments at indices ${indices.join(', ')} share the same timestamp — the confidence at that instant is ambiguous`,
    });
  }
  return issues;
}

const BaseResearchHypothesisSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'hypothesis name must be a non-empty string'),
  statement: z.string().min(1, 'hypothesis statement must be a non-empty string'),
  status: HypothesisStatusSchema,
  // Visibility (state reconstruction): the hypothesis itself is gated by createdAt; each
  // assessment within it is separately gated by its own timestamp (see assessment.ts) — a
  // snapshot at T sees a hypothesis created at or before T with only the subset of its
  // assessments whose timestamp is also at or before T.
  createdAt: ResearchTimestampSchema,
  assessments: z.array(HypothesisAssessmentSchema),
  falsifiers: z.array(ResearchCriterionSchema).optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchHypothesisSchema = BaseResearchHypothesisSchema.strict().superRefine(
  (value, ctx) => {
    value.assessments.forEach((assessment, index) => {
      if (compareResearchTimestamps(assessment.timestamp, value.createdAt) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assessments', index, 'timestamp'],
          message: `assessments.${String(index)}.timestamp (${assessment.timestamp}) precedes the hypothesis's createdAt (${value.createdAt})`,
        });
      }
    });

    for (const issue of findDuplicateAssessmentTimestamps(value.assessments)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }

    // A hypothesis's top-level `status` is its CURRENT status — if any assessment ever recorded
    // one, the chronologically last such assessment is the one authority on what "current" means,
    // and must agree with this field, or the two have silently drifted apart (someone updated one
    // without the other).
    const statused = value.assessments.filter((a) => a.status !== undefined);
    const latestStatused = [...statused]
      .sort((a, b) => compareResearchTimestamps(a.timestamp, b.timestamp))
      .at(-1);
    if (latestStatused !== undefined && latestStatused.status !== value.status) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message:
          `status ("${value.status}") does not match the most recent assessment that recorded ` +
          `one ("${String(latestStatused.status)}" as of ${latestStatused.timestamp}) — update ` +
          'one or the other so they agree.',
      });
    }
  },
);

/**
 * An explicitly testable research belief, tracked over time via `assessments` rather than a
 * single mutable confidence value, with optional `falsifiers` describing what would weaken or
 * falsify it. research-core does not prescribe how falsifiers are evaluated (no rule engine).
 *
 * `status` is this hypothesis's CURRENT status — kept as its own top-level field (not derived)
 * since most hypotheses never change status at all, but an assessment MAY optionally also record
 * a status change (`HypothesisAssessment.status`), in which case this field must agree with
 * whichever such assessment is chronologically last (enforced above). A point-in-time snapshot
 * (`computeResearchStateAt`) uses the latest VISIBLE status-carrying assessment instead of this
 * field directly, so an as-yet-unknown future status change is never leaked early — see that
 * function's own doc comment for the one known gap this doesn't close (a hypothesis's very FIRST
 * status change, if the schema has no prior status-carrying assessment to fall back on).
 */
export type ResearchHypothesis = z.infer<typeof ResearchHypothesisSchema>;

export function parseResearchHypothesis(raw: unknown): ValidationResult<ResearchHypothesis> {
  return fromZodSafeParse(ResearchHypothesisSchema.safeParse(raw));
}
