import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchValueOrQuantitySchema } from '../common/quantity.js';
import { compareResearchTimestamps, ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

const BaseResearchScenarioSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'scenario name must be a non-empty string'),
  description: z.string().optional(),
  parentScenarioId: ResearchIdSchema.optional(),
  // Optional: research-core does not assume every scenario has a mathematically meaningful
  // probability (see README.md). When present, it's a probability, so bounded [0, 1].
  probability: z
    .number()
    .min(0, 'probability must be >= 0')
    .max(1, 'probability must be <= 1')
    .optional(),
  assumptionIds: z.array(ResearchIdSchema),
  variableOverrides: z.record(ResearchIdSchema, ResearchValueOrQuantitySchema),
  eventIds: z.array(ResearchIdSchema),
  validFrom: ResearchTimestampSchema.optional(),
  validTo: ResearchTimestampSchema.optional(),
  // Visibility (state reconstruction): gated by recordedAt — see entity.ts for why a separate
  // epistemic timestamp is needed (validFrom/validTo describe the scenario's real-world
  // validity window, not when research came to define it). Required; not spec-literal.
  recordedAt: ResearchTimestampSchema,
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchScenarioSchema = BaseResearchScenarioSchema.strict().superRefine(
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

    if (value.parentScenarioId !== undefined && value.parentScenarioId === value.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentScenarioId'],
        message: 'a scenario cannot be its own parentScenarioId',
      });
    }
  },
);

/**
 * An alternative possible world/assumption set — e.g. "high-demand, constrained tritium". Does
 * not require a `probability`; see README.md.
 */
export type ResearchScenario = z.infer<typeof ResearchScenarioSchema>;

export function parseResearchScenario(raw: unknown): ValidationResult<ResearchScenario> {
  return fromZodSafeParse(ResearchScenarioSchema.safeParse(raw));
}
