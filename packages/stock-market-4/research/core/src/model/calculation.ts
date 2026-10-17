import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

const BaseResearchCalculationSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'calculation name must be a non-empty string'),
  // Stored as an opaque description of the relationship (e.g. "Revenue = Reactors × Content ×
  // Share × Replacements") — research-core does not parse or execute formulas; see README.md.
  formula: z.string().min(1, 'calculation formula must be a non-empty string'),
  inputVariableIds: z.array(ResearchIdSchema),
  outputVariableId: ResearchIdSchema,
  assumptionIds: z.array(ResearchIdSchema).optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchCalculationSchema = BaseResearchCalculationSchema.strict().superRefine(
  (value, ctx) => {
    if (value.inputVariableIds.includes(value.outputVariableId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outputVariableId'],
        message: `outputVariableId ("${value.outputVariableId}") must not also appear in inputVariableIds`,
      });
    }
  },
);

/**
 * A named, deterministic relationship between variables — the formula itself is stored as an
 * opaque string (no expression interpreter/execution engine in V1; see README.md).
 */
export type ResearchCalculation = z.infer<typeof ResearchCalculationSchema>;

export function parseResearchCalculation(raw: unknown): ValidationResult<ResearchCalculation> {
  return fromZodSafeParse(ResearchCalculationSchema.safeParse(raw));
}
