import { z } from 'zod';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

/**
 * An ISO-8601 timestamp that always carries explicit timezone information — either `Z` or a
 * numeric `+HH:MM`/`-HH:MM` offset. A bare local timestamp (no zone at all) is rejected: this
 * package's entire temporal-correctness story (state reconstruction, no-future-leakage) depends
 * on being able to compare timestamps unambiguously, which a zone-less string can't guarantee.
 */
export type ResearchTimestamp = string;

export const ResearchTimestampSchema = z.string().datetime({
  offset: true,
  message:
    'timestamp must be an ISO-8601 datetime with an explicit timezone (e.g. "Z" or "-04:00")',
});

export function parseResearchTimestamp(raw: unknown): ValidationResult<ResearchTimestamp> {
  return fromZodSafeParse(ResearchTimestampSchema.safeParse(raw));
}

export function isValidResearchTimestamp(raw: unknown): raw is ResearchTimestamp {
  return ResearchTimestampSchema.safeParse(raw).success;
}

/**
 * Normalizes a timestamp to milliseconds since the Unix epoch, for numeric comparison — the
 * only timezone-safe way to compare two `ResearchTimestamp`s (string comparison is not, since
 * two equal instants can be written with different offsets).
 */
export function toEpochMillis(timestamp: ResearchTimestamp): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new Error(`invalid ResearchTimestamp: "${timestamp}"`);
  }
  return millis;
}

/** `-1` if `a` is before `b`, `1` if after, `0` if the same instant (regardless of offset). */
export function compareResearchTimestamps(a: ResearchTimestamp, b: ResearchTimestamp): -1 | 0 | 1 {
  const diff = toEpochMillis(a) - toEpochMillis(b);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
}

/** `true` iff `timestamp` names an instant at or before `asOf` — the core "is this visible yet?" check. */
export function isAtOrBefore(timestamp: ResearchTimestamp, asOf: ResearchTimestamp): boolean {
  return toEpochMillis(timestamp) <= toEpochMillis(asOf);
}
