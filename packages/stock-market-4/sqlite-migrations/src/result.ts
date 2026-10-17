/**
 * Same shape as `@quant-fusion/market-data`'s own `Result<T>` — reimplemented rather than shared,
 * since every SQLite-backed store package in this repo keeps its own copy of this tiny type
 * rather than taking on a dependency for it (see `market-data/src/result.ts`).
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}
