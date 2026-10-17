import { z } from 'zod';
import { ConfidenceSchema } from '../common/confidence.js';
import { ResearchIdSchema } from '../common/ids.js';
import { isQuantity, ResearchValueOrQuantitySchema } from '../common/quantity.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { UncertaintySchema } from '../common/uncertainty.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const VariableOriginSchema = z.enum([
  'observed',
  'derived',
  'assumed',
  'estimated',
  'scenario',
]);
export type VariableOrigin = z.infer<typeof VariableOriginSchema>;

export const VariableStatusSchema = z.enum(['provisional', 'current', 'superseded', 'rejected']);
export type VariableStatus = z.infer<typeof VariableStatusSchema>;

const BaseResearchVariableSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'variable name must be a non-empty string'),
  value: ResearchValueOrQuantitySchema,
  // Distinguishes how this value came about — observed fact, derived calculation, assumed
  // input, estimated proxy, or scenario-specific override. research-core does not interpret
  // this beyond storing it; see README.md.
  origin: VariableOriginSchema,
  status: VariableStatusSchema.optional(),
  unit: z.string().optional(),
  effectiveFrom: ResearchTimestampSchema.optional(),
  effectiveTo: ResearchTimestampSchema.optional(),
  confidence: ConfidenceSchema.optional(),
  uncertainty: UncertaintySchema.optional(),
  // Visibility (state reconstruction): gated by recordedAt — see entity.ts for why a separate
  // epistemic timestamp is needed (effectiveFrom/effectiveTo describe the value's real-world
  // validity window, not when research came to know it). Required; not spec-literal.
  recordedAt: ResearchTimestampSchema,
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchVariableSchema = BaseResearchVariableSchema.strict().superRefine(
  (value, ctx) => {
    if (
      value.effectiveFrom !== undefined &&
      value.effectiveTo !== undefined &&
      compareResearchTimestamps(value.effectiveFrom, value.effectiveTo) > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: `effectiveFrom (${value.effectiveFrom}) must not be after effectiveTo (${value.effectiveTo})`,
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
 * A quantity or value used in research models — a number, JSON value, or `Quantity`, tagged
 * with where it came from (`origin`) and (optionally) its own confidence/uncertainty.
 */
export type ResearchVariable = z.infer<typeof ResearchVariableSchema>;

export function parseResearchVariable(raw: unknown): ValidationResult<ResearchVariable> {
  return fromZodSafeParse(ResearchVariableSchema.safeParse(raw));
}
