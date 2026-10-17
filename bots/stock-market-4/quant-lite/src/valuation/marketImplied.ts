import { constantScenario, type MarketImpliedGap, type ScenarioValue } from '@quant-fusion/quant-sdk-js';
import { computeFusionValue } from './fusionValue.js';
import type { FusionValuationAssumptions } from './fusionValue.js';

/**
 * Reverse-engineers what `supplierCapture` fraction the CURRENT market price already assumes
 * (spec §14), by inverting `computeFusionValue`'s formula and holding every other assumption at
 * its `base` scenario value. `supplierCapture` is the natural variable to solve for — it's the one
 * assumption in `FusionValuationAssumptions` that is BOTH scenario-varying AND explicitly the
 * least-evidenced input (spec §5: "unknown whether this company will ever supply any program").
 *
 * This is the fusion-specific half of `@quant-fusion/quant-sdk-js`'s `DomainAdapter.
 * computeMarketImpliedGap` seam (see `../index.ts`) — the SDK has no opinion on what quantity gets
 * inverted or how, only that a domain can produce a generic `MarketImpliedGap`.
 *
 * Returns `undefined` when the fusion chain is a flat zero regardless of capture (every OTHER
 * multiplicand is zero — `NO_FUSION_ASSUMPTIONS` in `../config.ts`) — there is nothing to invert,
 * and reporting `impliedValue: 0` there would misleadingly suggest a real, evidenced "the market
 * prices in zero fusion success" finding rather than "this security has no modeled fusion revenue
 * chain at all yet" (spec §28: never manufacture false precision).
 */
export function computeMarketImpliedExpectations(params: {
  marketPricePerShare: number;
  baseBusinessValuePerSharebase: number;
  domainOptionValuePerShareBase: number;
  fusion: FusionValuationAssumptions;
  sharesOutstanding: number;
}): MarketImpliedGap | undefined {
  // Fusion value at 100% capture, base scenario — the "$ of fusion value per unit of capture"
  // conversion factor. Every OTHER leg of the chain is held at its own base-scenario value, since
  // supplierCapture is the one variable being solved for.
  const fullCaptureAssumptions: FusionValuationAssumptions = {
    ...params.fusion,
    supplierCapture: constantScenario(1),
  };
  const fusionValuePerUnitCaptureTotal = computeFusionValue(fullCaptureAssumptions).fusionValue.base;
  const fusionValuePerUnitCapturePerShare = fusionValuePerUnitCaptureTotal / params.sharesOutstanding;

  if (fusionValuePerUnitCapturePerShare === 0) return undefined;

  const impliedFusionValuePerShare =
    params.marketPricePerShare - params.baseBusinessValuePerSharebase - params.domainOptionValuePerShareBase;
  const impliedSupplierCapture = impliedFusionValuePerShare / fusionValuePerUnitCapturePerShare;
  const assumedSupplierCapture = params.fusion.supplierCapture.base;

  const lowerBound = Math.min(params.fusion.supplierCapture.bear, params.fusion.supplierCapture.bull);
  const upperBound = Math.max(params.fusion.supplierCapture.bear, params.fusion.supplierCapture.bull);
  const gapVsRange: MarketImpliedGap['gapVsRange'] =
    impliedSupplierCapture > upperBound
      ? 'above_bull_case'
      : impliedSupplierCapture < lowerBound
        ? 'below_bear_case'
        : 'within_range';

  return {
    impliedValue: impliedSupplierCapture,
    assumedValue: assumedSupplierCapture,
    gap: assumedSupplierCapture - impliedSupplierCapture,
    gapVsRange,
  };
}

/** Convenience: the same reverse-engineering, taking a full `ScenarioValue` baseline instead of
 * bare `.base` numbers — the shape `../index.ts`'s `DomainAdapter.computeMarketImpliedGap` already
 * has on hand from `SecurityConfig`. */
export function computeMarketImpliedExpectationsFromScenarios(params: {
  marketPricePerShare: number;
  baseBusinessValuePerShare: ScenarioValue;
  domainOptionValuePerShare: ScenarioValue;
  fusion: FusionValuationAssumptions;
  sharesOutstanding: number;
}): MarketImpliedGap | undefined {
  return computeMarketImpliedExpectations({
    marketPricePerShare: params.marketPricePerShare,
    baseBusinessValuePerSharebase: params.baseBusinessValuePerShare.base,
    domainOptionValuePerShareBase: params.domainOptionValuePerShare.base,
    fusion: params.fusion,
    sharesOutstanding: params.sharesOutstanding,
  });
}
