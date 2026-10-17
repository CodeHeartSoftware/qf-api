import type { AlphaSignal } from './alpha/types.js';

/**
 * The "null research" ablation switch the plan calls out as the key scientific test of whether
 * point-in-time fusion research adds real alpha (plan Phase 1, item 8): `full` runs every alpha;
 * `research_only` keeps every research-derived alpha but drops `momentum` (isolates whether
 * research alone predicts returns); `price_only` drops every research-derived alpha, keeping only
 * `momentum` (the price-only control); `null_research` is presently equivalent to `price_only` but
 * kept as its own named mode — `price_only` asks "does price-only do as well as the full model?",
 * `null_research` asks "does REMOVING research hurt?" — same mechanism, different experimental
 * framing, so `../backtest/walkForward.ts` can report both labels distinctly even though today
 * they compute the same thing.
 */
export type ResearchAblationMode = 'full' | 'null_research' | 'research_only' | 'price_only';

const RESEARCH_FACTORS = new Set([
  'evidence_delta',
  'commercialization',
  'valuation_gap',
  'market_implied',
]);
const PRICE_FACTORS = new Set(['momentum']);

/** Every alpha factor this bot computes (`./alpha/*.ts`) — the canonical list `../decision.ts`
 * uses to know which factor NAMES survive a given ablation mode, without needing a real round of
 * signals on hand just to ask the question. */
export const ALL_ALPHA_FACTORS: string[] = [
  'evidence_delta',
  'commercialization',
  'valuation_gap',
  'market_implied',
  'momentum',
];

/** The factor names that survive `mode` — used to scope `alpha/ic.ts`'s
 * `computeEnsembleWeights` to only the factors actually in play this round, so an ablated-away
 * factor's historical IC never contributes an equal-weight fallback share it shouldn't get. */
export function activeFactorsForMode(mode: ResearchAblationMode): string[] {
  if (mode === 'full') return ALL_ALPHA_FACTORS;
  if (mode === 'research_only')
    return ALL_ALPHA_FACTORS.filter((factor) => !PRICE_FACTORS.has(factor));
  return ALL_ALPHA_FACTORS.filter((factor) => !RESEARCH_FACTORS.has(factor));
}

/**
 * Filters (never zeroes-in-place) the alpha signals reaching `ic.ts`'s ensemble combiner — a
 * dropped factor is treated as "not observed this round" (excluded from both numerator and
 * denominator in `combineAlphaEnsemble`), not "observed as a confident zero," which would silently
 * dilute the surviving factors' combined weight for no reason.
 */
export function applyAblation(signals: AlphaSignal[], mode: ResearchAblationMode): AlphaSignal[] {
  if (mode === 'full') return signals;
  if (mode === 'research_only')
    return signals.filter((signal) => !PRICE_FACTORS.has(signal.factor));
  // 'price_only' and 'null_research' — see this file's own doc comment for why both names exist.
  return signals.filter((signal) => !RESEARCH_FACTORS.has(signal.factor));
}
