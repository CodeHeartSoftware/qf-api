/** How much weight the CAUSAL (research-exposure-overlap) correlation gets in the blend below,
 * vs. the statistical (real trailing-price-return) correlation getting `1 - causalWeight` —
 * illustrative starting point (not fitted/swept): with only ~2 months of real price history,
 * statistical correlation estimates are themselves noisy, so causal overlap — which needs no price
 * history at all — is given a meaningful, non-trivial share rather than being a tie-breaker. */
export interface CorrelationBlendPolicy {
  causalWeight: number;
}

/**
 * A simple, transparent, LABELED heuristic blend — never a fitted model (plan Phase 1, item 4:
 * "a simple transparent blend, not a fitted model"). `statistical` is `undefined` when there isn't
 * enough overlapping trailing-return history to compute a real Pearson correlation yet
 * (`../correlation/statistical.ts`'s `computePearsonCorrelation`) — treated as a NEUTRAL 0
 * contribution (not "unknown, so skip the blend entirely"), the same "absent data, don't invent an
 * adjustment, but don't stall the whole pipeline either" discipline `fusion-fundamental-v7`
 * applies to its own volatility/trend-filter scaling.
 */
export function computeEffectiveCorrelation(
  statistical: number | undefined,
  causal: number,
  policy: CorrelationBlendPolicy,
): number {
  const statisticalComponent = statistical ?? 0;
  return (1 - policy.causalWeight) * statisticalComponent + policy.causalWeight * causal;
}
