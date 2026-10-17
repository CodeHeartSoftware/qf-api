import { err, ok, type Result } from '@quant-fusion/engine';
import {
  SecuritySchema,
  type CalendarDate,
  type Security,
  type SecurityLifecycleRecord,
} from '../types.js';

export function parseSecurity(raw: unknown): Result<Security> {
  const result = SecuritySchema.safeParse(raw);
  return result.success
    ? ok(result.data)
    : err(result.error.issues.map((issue) => issue.message).join('; '));
}

/**
 * The lifecycle record in effect as of `date` — the last record with `effectiveDate <= date`, or
 * `undefined` if this security had no recorded lifecycle yet as of that date. This is the one
 * place "was this security's ticker/name/state knowable as of this date" is answered — a bot
 * must only ever see this record, never a later one (spec §12).
 */
export function resolveSecurityAsOf(
  security: Security,
  date: CalendarDate,
): SecurityLifecycleRecord | undefined {
  let current: SecurityLifecycleRecord | undefined;
  for (const record of security.lifecycle) {
    if (record.effectiveDate > date) break;
    current = record;
  }
  return current;
}

/**
 * Resolves a match's declared `marketDataUniverse` (tickers) against the known security
 * registry as of `asOfDate` (normally the match's own `startDate`), to stable security ids.
 * Fails closed: a ticker that doesn't resolve to exactly one already-knowable-by-`asOfDate`
 * security is a validation error, not a silently-dropped entry — "the tournament validates the
 * requested universe before the match begins" (spec §11).
 */
export function resolveMarketDataUniverse(
  tickers: readonly string[],
  securities: readonly Security[],
  asOfDate: CalendarDate,
): Result<string[]> {
  const resolvedIds: string[] = [];
  const problems: string[] = [];

  for (const ticker of tickers) {
    const matches = securities.filter(
      (security) => resolveSecurityAsOf(security, asOfDate)?.ticker === ticker,
    );
    if (matches.length === 0) {
      problems.push(`"${ticker}" does not resolve to any known security as of ${asOfDate}`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `"${ticker}" resolves to more than one security as of ${asOfDate} (${matches.map((match) => match.id).join(', ')})`,
      );
      continue;
    }
    const [match] = matches;
    if (match !== undefined) {
      resolvedIds.push(match.id);
    }
  }

  if (problems.length > 0) {
    return err(problems.join('; '));
  }
  return ok(resolvedIds);
}
