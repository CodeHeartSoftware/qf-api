import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';
import { ResearchCalculationSchema } from './calculation.js';

const BaseResearchModelSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'model name must be a non-empty string'),
  description: z.string().optional(),
  variableIds: z.array(ResearchIdSchema),
  assumptionIds: z.array(ResearchIdSchema),
  calculations: z.array(ResearchCalculationSchema),
  outputVariableIds: z.array(ResearchIdSchema),
  // Visibility (state reconstruction): gated by createdAt.
  createdAt: ResearchTimestampSchema,
  validFrom: ResearchTimestampSchema.optional(),
  validTo: ResearchTimestampSchema.optional(),
  evidenceIds: z.array(ResearchIdSchema).optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchModelSchema = BaseResearchModelSchema.strict().superRefine((value, ctx) => {
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
 * Structure around a set of calculations, variables, and assumptions — e.g. a revenue model.
 * Whether every referenced variable/assumption id actually resolves is a dataset-level concern
 * (see validateResearchDataset), not checked here since a Model alone has no dataset to check
 * against.
 */
export type ResearchModel = z.infer<typeof ResearchModelSchema>;

export function parseResearchModel(raw: unknown): ValidationResult<ResearchModel> {
  return fromZodSafeParse(ResearchModelSchema.safeParse(raw));
}
