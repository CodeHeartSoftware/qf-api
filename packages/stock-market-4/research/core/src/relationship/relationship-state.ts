import { z } from 'zod';
import { ConfidenceSchema } from '../common/confidence.js';
import { ResearchIdSchema } from '../common/ids.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

const BaseRelationshipStateSchema = z.object({
  // Domain-defined (e.g. "tested", "qualified", "production contract") — see relationship.ts.
  status: z.string().min(1, 'relationship state status must be a non-empty string'),
  // When this state entered the research record — see entity.ts for why this differs from
  // effectiveFrom/effectiveTo (the state's real-world validity window).
  recordedAt: ResearchTimestampSchema,
  effectiveFrom: ResearchTimestampSchema,
  effectiveTo: ResearchTimestampSchema.optional(),
  evidenceIds: z.array(ResearchIdSchema),
  confidence: ConfidenceSchema.optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const RelationshipStateSchema = BaseRelationshipStateSchema.strict().superRefine(
  (value, ctx) => {
    if (
      value.effectiveTo !== undefined &&
      compareResearchTimestamps(value.effectiveFrom, value.effectiveTo) > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: `effectiveFrom (${value.effectiveFrom}) must not be after effectiveTo (${value.effectiveTo})`,
      });
    }
  },
);

/** One point in a relationship's evolution over time — see relationship.ts. */
export type RelationshipState = z.infer<typeof RelationshipStateSchema>;

export function parseRelationshipState(raw: unknown): ValidationResult<RelationshipState> {
  return fromZodSafeParse(RelationshipStateSchema.safeParse(raw));
}
