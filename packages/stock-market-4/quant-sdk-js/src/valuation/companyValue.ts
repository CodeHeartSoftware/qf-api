import type { ModelEffect } from '../research/interpretEvents.js';
import { combineScenarios, constantScenario, sumScenarios } from './scenarios.js';
import type { CompanyValuation, ScenarioValue } from './types.js';

/**
 * How many dollars of value a unit of (`ModelEffect.magnitude * ModelEffect.confidence`) is worth,
 * per effect family — the explicit "sensitivity" knobs spec §11/§29 requires so this translation
 * from a qualitative research effect to a dollar value is a labeled strategy assumption, never
 * buried inside `computeCompanyValuation`'s arithmetic. Lives in a domain bot's own config
 * alongside every other strategy assumption.
 */
export interface ValuationSensitivities {
  /** $/share of base-business value per unit of a `manufacturing_capability` effect (spec §8:
   * increased manufacturing breadth is itself base-business value, independent of the domain
   * value chain). */
  manufacturingCapabilityToBaseValuePerShare: number;
  /** $/share of domain OPTION value (not domain-derived value) per unit of a
   * `manufacturing_capability` effect — "potential domain optionality," explicitly kept separate
   * from and much smaller than `domainDerivedValue`, which comes only from the domain adapter's
   * own value-chain formula (spec §8/§9). */
  manufacturingCapabilityToDomainOptionPerShare: number;
  /** $/share of domain option value per unit of a `hypothesis:*` effect that relates to the target
   * entity — the only other channel that can move domain option value. */
  hypothesisConfidenceToDomainOptionPerShare: number;
  /** $/share of domain option value per unit of a `supplier_capture` effect (a qualification/
   * customer/contract-type relationship change FROM this entity — see
   * `../research/interpretEvents.ts`). Deliberately its own, typically LARGER sensitivity than
   * `hypothesisConfidenceToDomainOptionPerShare`: a qualification or contract change is a
   * materially stronger evidence tier than a generic hypothesis-confidence shift (spec §10), so it
   * should move the option value more per unit of (magnitude * confidence) — but still only ever
   * touches OPTION value, never `domainDerivedValue` (which stays governed solely by the domain
   * adapter's own labeled bear/base/bull strategy assumptions, not something a single research
   * effect silently overrides). */
  supplierCaptureToDomainOptionPerShare: number;
}

/**
 * Applies `effects` (from `../research/interpretEvents.ts`) to a valuation baseline, producing the
 * `CompanyValuation` spec §9 describes. Deliberately narrow: only `manufacturing_capability` and
 * `hypothesis:*` factors move anything, and `hypothesis:*` effects only ever touch domain OPTION
 * value, never `domainDerivedValue` (which stays whatever `domainValue` says, driven purely by the
 * domain adapter's own value-chain formula) — so a supplier-relationship confidence change can
 * never masquerade as "this company's domain revenue capture went up" (spec §5/§19). Any
 * `direction: 'neutral'` effect (the anti-inference confirmations from `interpretEvents.ts`)
 * contributes exactly nothing, by construction — it isn't matched by either branch below.
 */
export function computeCompanyValuation(params: {
  ticker: string;
  asOf: string;
  /** $/share, before any research-driven adjustment. */
  baseBusinessValue: ScenarioValue;
  /** $/share, from the domain adapter's own value-chain formula (e.g. quant-v0's
   * `computeFusionValue(...).fusionValue`, already converted to a per-share figure via
   * `sharesOutstanding` by the caller — this SDK has no opinion on that conversion's inputs). */
  domainValue: ScenarioValue;
  /** $/share, before any research-driven adjustment. */
  domainOptionValueBaseline: ScenarioValue;
  effects: ModelEffect[];
  sensitivities: ValuationSensitivities;
  unknowns: string[];
}): CompanyValuation {
  let baseBusinessValue = params.baseBusinessValue;
  let domainOptionValue = params.domainOptionValueBaseline;

  for (const effect of params.effects) {
    const weight = effect.magnitude * effect.confidence;

    if (effect.factor === 'manufacturing_capability' && effect.direction === 'positive') {
      baseBusinessValue = combineScenarios(
        baseBusinessValue,
        constantScenario(weight * params.sensitivities.manufacturingCapabilityToBaseValuePerShare),
        (a, b) => a + b,
      );
      domainOptionValue = combineScenarios(
        domainOptionValue,
        constantScenario(
          weight * params.sensitivities.manufacturingCapabilityToDomainOptionPerShare,
        ),
        (a, b) => a + b,
      );
      continue;
    }

    if (effect.factor.startsWith('hypothesis:') && effect.direction === 'positive') {
      domainOptionValue = combineScenarios(
        domainOptionValue,
        constantScenario(weight * params.sensitivities.hypothesisConfidenceToDomainOptionPerShare),
        (a, b) => a + b,
      );
      continue;
    }

    if (effect.factor === 'supplier_capture' && effect.direction !== 'neutral') {
      // A downgrade (e.g. "production contract" -> "cancelled" — see
      // `../research/interpretEvents.ts`'s `NEGATIVE_STATUS_PATTERN`) SUBTRACTS the same way an
      // upgrade adds, never floored at zero here — a real loss of a qualification/contract is
      // exactly as informative as gaining one, and floors/clamps belong to the final fair-value
      // scenario values elsewhere, not silently applied mid-calculation.
      const sign = effect.direction === 'positive' ? 1 : -1;
      domainOptionValue = combineScenarios(
        domainOptionValue,
        constantScenario(
          sign * weight * params.sensitivities.supplierCaptureToDomainOptionPerShare,
        ),
        (a, b) => a + b,
      );
    }
    // direction 'neutral' (and any other factor) contributes nothing, intentionally.
  }

  const fairValue = sumScenarios([baseBusinessValue, params.domainValue, domainOptionValue]);

  return {
    ticker: params.ticker,
    asOf: params.asOf,
    baseBusinessValue,
    domainDerivedValue: params.domainValue,
    domainOptionValue,
    fairValue,
    unknowns: params.unknowns,
  };
}
