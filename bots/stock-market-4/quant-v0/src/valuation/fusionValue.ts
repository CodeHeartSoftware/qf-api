import { combineScenarios, type ScenarioValue } from '@quant-fusion/quant-sdk-js';

/**
 * The fusion revenue-chain assumptions (spec §11): Fusion Revenue = reactorDeployments *
 * tungstenContentTonnes * supplierCapture * replacementDemand; Fusion EBIT = Fusion Revenue *
 * incrementalEbitMargin; Fusion Value = Fusion EBIT * valuationMultiple. Every one of these is a
 * `ScenarioValue`, never a bare number — so no step of the chain can quietly collapse Bear/Base/
 * Bull into one path, and nothing here is "hidden inside arithmetic" (spec §11's own words).
 *
 * This is THE genuinely fusion-specific piece of this bot (see `@quant-fusion/quant-sdk-js`'s own
 * doc comment on why it doesn't live there) — a future domain bot (a different research package,
 * a different tracked universe) replaces this whole file with its own value-chain formula and
 * assumption shape, supplying it to the SDK's generic `DomainAdapter` (see `../index.ts`).
 *
 * These are STRATEGY ASSUMPTIONS (see `../config.ts`), not researched facts — the research dataset
 * establishes none of: reactor deployment counts, tungsten content per reactor, ELMT's share of
 * that demand, replacement/consumable demand multiplier, incremental margin on fusion-derived
 * revenue, or the multiple the market would apply to it (spec §9, §28).
 */
export interface FusionValuationAssumptions {
  /** Expected number of fusion reactor deployments the addressable tungsten demand is based on. */
  reactorDeployments: ScenarioValue;
  /** Tonnes of tungsten content per reactor deployment. */
  tungstenContentTonnes: ScenarioValue;
  /** USD per tonne of tungsten content — an explicit price assumption. Not one of the fields the
   * spec's sketch of `FusionValuationAssumptions` names, but without SOME $/tonne figure,
   * "reactorDeployments * tungstenContentTonnes" is a quantity of tonnes, not dollars, and
   * "Fusion Revenue" would be nonsensical. Added rather than silently treating tonnes as if they
   * were already dollars — an assumption made explicit, never one hidden inside the arithmetic
   * (spec §11's own stated goal). */
  tungstenPriceUsdPerTonne: ScenarioValue;
  /** Fraction of that tungsten demand ELMT is assumed to capture — 0 to 1. This is explicitly an
   * ASSUMPTION, never a value the bot derives from `manufactures`/`has_capability` relationships;
   * see `@quant-fusion/quant-sdk-js`'s `research/interpretEvents.ts` for why capability must never
   * imply capture. */
  supplierCapture: ScenarioValue;
  /** Multiplier for replacement/consumable demand beyond the initial reactor build. */
  replacementDemand: ScenarioValue;
  /** Incremental EBIT margin on fusion-derived revenue — 0 to 1. */
  incrementalEbitMargin: ScenarioValue;
  /** EBIT valuation multiple applied to fusion-derived EBIT. */
  valuationMultiple: ScenarioValue;
}

/** Fusion Revenue -> Fusion EBIT -> Fusion Value, each kept as a `ScenarioValue` (spec §11). */
export interface FusionValueResult {
  fusionRevenue: ScenarioValue;
  fusionEbit: ScenarioValue;
  fusionValue: ScenarioValue;
}

/**
 * The fusion revenue-chain formula from spec §11, applied leg-by-leg across Bear/Base/Bull
 * (`combineScenarios` — never cross-multiplies a bear leg of one assumption with a bull leg of
 * another):
 *
 *   Fusion Revenue = reactorDeployments * tungstenContentTonnes * tungstenPriceUsdPerTonne
 *                    * supplierCapture * replacementDemand
 *   Fusion EBIT     = Fusion Revenue * incrementalEbitMargin
 *   Fusion Value    = Fusion EBIT * valuationMultiple
 *
 * (`tungstenPriceUsdPerTonne` is the one addition beyond the spec's literal field sketch — see
 * `FusionValuationAssumptions`'s doc comment for why a $/tonne figure has to be explicit somewhere
 * in this chain.)
 *
 * Result is company-level ABSOLUTE dollars (reactorDeployments/tungstenContentTonnes are
 * whole-company quantities, not per-share) — `../index.ts`'s `DomainAdapter.computeDomainValue`
 * divides by `sharesOutstanding` before handing the SDK a per-share `ScenarioValue`.
 */
export function computeFusionValue(assumptions: FusionValuationAssumptions): FusionValueResult {
  const tungstenRevenue = combineScenarios(
    combineScenarios(assumptions.reactorDeployments, assumptions.tungstenContentTonnes, (a, b) => a * b),
    assumptions.tungstenPriceUsdPerTonne,
    (a, b) => a * b,
  );
  const fusionRevenue = combineScenarios(
    combineScenarios(tungstenRevenue, assumptions.supplierCapture, (a, b) => a * b),
    assumptions.replacementDemand,
    (a, b) => a * b,
  );

  const fusionEbit = combineScenarios(fusionRevenue, assumptions.incrementalEbitMargin, (a, b) => a * b);
  const fusionValue = combineScenarios(fusionEbit, assumptions.valuationMultiple, (a, b) => a * b);

  return { fusionRevenue, fusionEbit, fusionValue };
}
