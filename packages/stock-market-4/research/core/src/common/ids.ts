import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

/**
 * A stable, unique-within-its-dataset identifier. Deliberately a plain string, not a UUID
 * abstraction — the repository has no existing UUID convention to reuse, and V1 stays simple.
 */
export type ResearchId = string;

// Validates without transforming: an id is never silently trimmed, since other objects
// reference it by exact value and a silent rewrite would break those references.
export const ResearchIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: 'id must be a non-empty string' });

export function parseResearchId(raw: unknown): ValidationResult<ResearchId> {
  return fromZodSafeParse(ResearchIdSchema.safeParse(raw));
}

export function isValidResearchId(raw: unknown): raw is ResearchId {
  return ResearchIdSchema.safeParse(raw).success;
}
