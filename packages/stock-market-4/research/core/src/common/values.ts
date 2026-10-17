import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

/**
 * A JSON-compatible value. Quantities are NOT represented as bare `ResearchValue`s with units
 * silently embedded in strings — see `quantity.ts` for the explicit `Quantity` type.
 */
export type ResearchValue =
  string | number | boolean | null | ResearchValue[] | { [key: string]: ResearchValue };

export const ResearchValueSchema: z.ZodType<ResearchValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ResearchValueSchema),
    z.record(ResearchValueSchema),
  ]),
);

export function parseResearchValue(raw: unknown): ValidationResult<ResearchValue> {
  return fromZodSafeParse(ResearchValueSchema.safeParse(raw));
}
