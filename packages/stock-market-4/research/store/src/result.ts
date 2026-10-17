/**
 * Same shape as `@quant-fusion/market-data`'s own `Result<T>` — reimplemented rather than shared,
 * following that package's own precedent of each store keeping its own tiny copy.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}
