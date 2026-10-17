/**
 * Same shape as `@quant-fusion/engine`'s own `Result<T>` — reimplemented rather than imported,
 * since this package has no dependency on the engine (it's a generic data layer, usable by any
 * game or none at all). Every fallible operation here (opening a store, resolving a dataset
 * version) returns this instead of throwing, matching `@quant-fusion/tournament-store`'s own
 * "never throw on a missing/corrupt record" convention.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}
