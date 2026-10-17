/**
 * Same local reimplementation every small SQLite-backed store package in this repo already has
 * (`@quant-fusion/forward-match-store`, `@quant-fusion/market-data`) — a plain two-case `Result`,
 * not shared as a dependency, since none of these packages otherwise depend on each other.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}
