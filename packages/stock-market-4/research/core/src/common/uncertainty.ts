import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export type UncertaintyType = 'range' | 'interval' | 'distribution' | 'qualitative';

const BaseUncertaintySchema = z.object({
  type: z.enum(['range', 'interval', 'distribution', 'qualitative']),
  lower: z.number().optional(),
  upper: z.number().optional(),
  unit: z.string().optional(),
  distribution: z.string().optional(),
  description: z.string().optional(),
});

export const UncertaintySchema = BaseUncertaintySchema.strict().superRefine((value, ctx) => {
  if (value.lower !== undefined && value.upper !== undefined && value.lower > value.upper) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lower'],
      message: `lower (${String(value.lower)}) must not exceed upper (${String(value.upper)})`,
    });
  }

  if (
    (value.type === 'range' || value.type === 'interval') &&
    (value.lower === undefined || value.upper === undefined)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.lower === undefined ? ['lower'] : ['upper'],
      message: `uncertainty of type "${value.type}" requires both lower and upper bounds`,
    });
  }

  if (
    value.type === 'distribution' &&
    (value.distribution === undefined || value.distribution.trim().length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['distribution'],
      message: 'uncertainty of type "distribution" requires a non-empty distribution description',
    });
  }

  if (
    value.type === 'qualitative' &&
    (value.description === undefined || value.description.trim().length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['description'],
      message: 'uncertainty of type "qualitative" requires a non-empty description',
    });
  }
});

/**
 * How precisely a value is known. Distinct from `Confidence` (see confidence.ts): this
 * describes the shape/width of what's known, not how strongly it's believed.
 *
 * No statistical inference is implemented here (or anywhere in this package) — this only
 * validates that the structure is internally consistent (e.g. a "distribution" actually names
 * one, a "range"/"interval" actually has bounds, and bounds aren't inverted).
 *
 * Inferred from `UncertaintySchema` (rather than hand-declared) so the type and its runtime
 * validation can never drift apart, and so optional fields agree with `exactOptionalPropertyTypes`.
 */
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export function parseUncertainty(raw: unknown): ValidationResult<Uncertainty> {
  return fromZodSafeParse(UncertaintySchema.safeParse(raw));
}
