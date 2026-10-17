import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const ConfidenceSchema = z
  .object({
    value: z
      .number()
      .min(0, 'confidence value must be >= 0')
      .max(1, 'confidence value must be <= 1'),
    basis: z.string().optional(),
  })
  .strict();

/**
 * Belief/support strength for some claim, on a 0-1 scale. Distinct from `Uncertainty`
 * (see uncertainty.ts): confidence is "how strongly is this believed", uncertainty is
 * "how precisely is this known" — a value can be believed with high confidence yet still carry
 * wide uncertainty bounds, or vice versa.
 *
 * Inferred from `ConfidenceSchema` (rather than hand-declared) so the type and its runtime
 * validation can never drift apart, and so optional fields agree with `exactOptionalPropertyTypes`.
 */
export type Confidence = z.infer<typeof ConfidenceSchema>;

export function parseConfidence(raw: unknown): ValidationResult<Confidence> {
  return fromZodSafeParse(ConfidenceSchema.safeParse(raw));
}
