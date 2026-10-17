import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const ResearchCriterionSchema = z
  .object({
    description: z.string().min(1, 'criterion description must be a non-empty string'),
    evidenceIds: z.array(ResearchIdSchema).optional(),
  })
  .strict();

/**
 * A structured support/falsification criterion for a hypothesis — deliberately just a
 * description plus optional evidence citations, not a rule engine (out of scope for V1;
 * see README.md).
 */
export type ResearchCriterion = z.infer<typeof ResearchCriterionSchema>;

export function parseResearchCriterion(raw: unknown): ValidationResult<ResearchCriterion> {
  return fromZodSafeParse(ResearchCriterionSchema.safeParse(raw));
}
