/**
 * Same shape as `@quant-fusion/engine`'s own `Result<T>` — reimplemented rather than imported,
 * since this package has no dependency on the engine (it never inspects `RoundEvent`/
 * `StandingOutcome` or any other match-shaped type; a forward match's `snapshot` stays fully
 * opaque to it — see `types.ts`). Every fallible operation here (saving, loading) returns this
 * instead of throwing, matching `@quant-fusion/market-data`'s own local reimplementation for the
 * same reason.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}
