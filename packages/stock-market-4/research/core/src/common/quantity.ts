import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';
import { UncertaintySchema } from './uncertainty.js';
import { ResearchValueSchema } from './values.js';

export const QuantitySchema = z
  .object({
    value: z.number().finite('quantity value must be a finite number'),
    unit: z.string().min(1, 'quantity unit must be a non-empty string'),
    uncertainty: UncertaintySchema.optional(),
  })
  .strict();

/**
 * A numeric value paired explicitly with its unit, so quantities are never silently embedded
 * in arbitrary strings (e.g. `"24.7 tonnes"`). No unit conversion is implemented in V1 — `unit`
 * is stored as-is and it is the caller's responsibility to compare like units.
 *
 * Inferred from `QuantitySchema` (rather than hand-declared) so the type and its runtime
 * validation can never drift apart, and so optional fields agree with `exactOptionalPropertyTypes`.
 */
export type Quantity = z.infer<typeof QuantitySchema>;

export function parseQuantity(raw: unknown): ValidationResult<Quantity> {
  return fromZodSafeParse(QuantitySchema.safeParse(raw));
}

/** Structural check for the `ResearchValue | Quantity` unions used elsewhere in this package. */
export function isQuantity(value: unknown): value is Quantity {
  return QuantitySchema.safeParse(value).success;
}

/**
 * Shared by `Variable`, `Assumption`, and `Scenario.variableOverrides` — a value is either a
 * bare JSON `ResearchValue` or an explicit `Quantity`. `QuantitySchema` is tried first so a
 * well-formed `{value, unit}` object parses as a `Quantity` rather than falling through to the
 * generic JSON-object branch of `ResearchValueSchema`.
 */
export const ResearchValueOrQuantitySchema = z.union([QuantitySchema, ResearchValueSchema]);

export type ResearchValueOrQuantity = z.infer<typeof ResearchValueOrQuantitySchema>;
