import type { ScenarioValue } from './types.js';

/** Applies `fn` independently to each leg of a `ScenarioValue` — the one place Bear/Base/Bull
 * combination logic lives, so every valuation step (spec §10/§11) reuses this instead of each
 * hand-rolling its own bear/base/bull arithmetic (and risking one leg silently drifting out of
 * sync with the others). */
export function mapScenario(value: ScenarioValue, fn: (leg: number) => number): ScenarioValue {
  return { bear: fn(value.bear), base: fn(value.base), bull: fn(value.bull) };
}

/** Combines two `ScenarioValue`s leg-by-leg (bear-with-bear, base-with-base, bull-with-bull) —
 * never cross-multiplies a bear leg of one assumption with a bull leg of another, which would
 * produce a scenario that isn't internally coherent. */
export function combineScenarios(
  a: ScenarioValue,
  b: ScenarioValue,
  fn: (legA: number, legB: number) => number,
): ScenarioValue {
  return { bear: fn(a.bear, b.bear), base: fn(a.base, b.base), bull: fn(a.bull, b.bull) };
}

/** Sums any number of `ScenarioValue`s leg-by-leg — e.g. combining base business value, fusion-
 * derived value, and fusion option value into a fair value estimate (spec §9). */
export function sumScenarios(values: ScenarioValue[]): ScenarioValue {
  return values.reduce((total, value) => combineScenarios(total, value, (a, b) => a + b), {
    bear: 0,
    base: 0,
    bull: 0,
  });
}

/** A constant `ScenarioValue` — all three legs equal. Used for assumptions the strategy config
 * treats as fixed rather than scenario-dependent (spec §29 — still a labeled strategy assumption,
 * just one that doesn't vary bear/base/bull). */
export function constantScenario(value: number): ScenarioValue {
  return { bear: value, base: value, bull: value };
}
