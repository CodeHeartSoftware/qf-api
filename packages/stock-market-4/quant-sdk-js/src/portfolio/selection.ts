import type { AlphaInput, PortfolioConstructionPolicy } from './types.js';

/**
 * WHICH names a strategy sizes, applied identically by every `PortfolioStrategy` so strategies
 * differ only in HOW they size the chosen set.
 *
 * - `threshold` (the default) — every name whose `expectedReturn * confidence` clears
 *   `activationThreshold`. Its behavior depends on the absolute scale of the combined signal,
 *   which is why standardizing signals (`../alpha/standardize.ts`) left the book almost empty.
 * - `top_k` — rank names by `expectedReturn * confidence` and hold the best `k` that score above
 *   `minScore` (long-only: `0` means "positive view only"). Scale-free, so it works on
 *   standardized signals without a tuned constant — the usual long-only selection rule.
 */
export type SelectionPolicy =
  { mode: 'threshold' } | { mode: 'top_k'; k: number; minScore: number };

export function selectActiveAlphas(
  alphas: AlphaInput[],
  policy: PortfolioConstructionPolicy,
): AlphaInput[] {
  const score = (a: AlphaInput) => a.expectedReturn * a.confidence;
  const selection = policy.selection ?? { mode: 'threshold' };
  if (selection.mode === 'threshold')
    return alphas.filter((a) => score(a) >= policy.activationThreshold);
  return alphas
    .filter((a) => score(a) > selection.minScore)
    .sort((a, b) => score(b) - score(a) || (a.ticker < b.ticker ? -1 : 1))
    .slice(0, selection.k);
}

/** Short human-readable description of which rule chose the active set, for decision notes. */
export function describeSelection(policy: PortfolioConstructionPolicy): string {
  const selection = policy.selection ?? { mode: 'threshold' };
  return selection.mode === 'threshold'
    ? `expectedReturn*confidence >= ${(policy.activationThreshold * 100).toFixed(2)}%`
    : `top ${String(selection.k)} by expectedReturn*confidence, above ${String(selection.minScore)}`;
}
