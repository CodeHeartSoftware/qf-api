import { z } from 'zod';
import { ConfidenceSchema } from '../common/confidence.js';
import { ResearchIdSchema } from '../common/ids.js';
import { isQuantity, ResearchValueOrQuantitySchema } from '../common/quantity.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

const BaseResearchAssumptionSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'assumption name must be a non-empty string'),
  description: z.string().min(1, 'assumption description must be a non-empty string'),
  value: ResearchValueOrQuantitySchema,
  unit: z.string().optional(),
  validFrom: ResearchTimestampSchema.optional(),
  validTo: ResearchTimestampSchema.optional(),
  source: z.string().optional(),
  confidence: ConfidenceSchema.optional(),
  // Visibility (state reconstruction): gated by recordedAt — see entity.ts for why a separate
  // epistemic timestamp is needed (validFrom/validTo describe the assumption's real-world
  // validity window, not when research came to adopt it). Required; not spec-literal.
  recordedAt: ResearchTimestampSchema,
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchAssumptionSchema = BaseResearchAssumptionSchema.strict().superRefine(
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

    if (isQuantity(value.value) && value.unit !== undefined && value.unit !== value.value.unit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit'],
        message: `unit ("${value.unit}") conflicts with value.unit ("${value.value.unit}") — they must agree, or unit should be omitted`,
      });
    }
  },
);

/**
 * An input a model takes on faith rather than observes — kept explicitly distinguishable from
 * `Evidence`/observed `Variable`s, per research-core's evidence-vs-interpretation principle.
 */
export type ResearchAssumption = z.infer<typeof ResearchAssumptionSchema>;

export function parseResearchAssumption(raw: unknown): ValidationResult<ResearchAssumption> {
  return fromZodSafeParse(ResearchAssumptionSchema.safeParse(raw));
}
