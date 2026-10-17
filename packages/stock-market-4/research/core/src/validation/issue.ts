import type { z } from 'zod';

/**
 * One structured validation problem. `path` is a dot-joined field path (e.g.
 * `"hypotheses[2].assessments[0].confidence.value"`), empty string for a root-level issue.
 * Used uniformly everywhere in this package instead of throwing/joining ad-hoc strings, so a
 * caller (e.g. the dataset validator) can merge issues from many sub-checks into one report.
 */
export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** Adapts a zod `safeParse` result to this package's `ValidationResult` shape. */
export function fromZodSafeParse<T>(
  result: z.SafeParseReturnType<unknown, T>,
): ValidationResult<T> {
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}

/** Joins issue messages into one human-readable string, for callers that just want a summary. */
export function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join('; ');
}
