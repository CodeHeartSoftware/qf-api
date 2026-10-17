import type { ModelEffect } from '../research/interpretEvents.js';
import type { AlphaSignal } from './types.js';

/** $ of expected-return fraction per unit of (magnitude * confidence) for a `supplier_capture`
 * change — larger than `evidenceDelta.ts`'s `EVIDENCE_DELTA_SCALE` (illustrative, not swept),
 * mirroring the same "qualification/contract evidence outranks a generic hypothesis shift"
 * discipline `fusion-fundamental-v7`'s `valuation/companyValue.ts` already documents. */
export const COMMERCIALIZATION_SCALE = 0.05;

/**
 * The commercialization-specific alpha: isolates `supplier_capture` relationship-status changes
 * (a qualification/customer/contract-tier transition FROM the target entity — see
 * `research/interpretEvents.ts`, unchanged in this bot) as their OWN independently-measured signal,
 * rather than folding them into the generic `evidence_delta` alpha. Distinct evidence classes get
 * distinct alphas so `ic.ts` can measure — separately — whether a "the company got a new customer
 * or contract" signal predicts returns any better or worse than a "some hypothesis moved" one.
 */
export function computeCommercializationAlpha(params: {
  ticker: string;
  date: string | null;
  effects: ModelEffect[];
}): AlphaSignal {
  const captureEffect = params.effects.find((effect) => effect.factor === 'supplier_capture');
  if (captureEffect === undefined || captureEffect.direction === 'neutral') {
    return {
      factor: 'commercialization',
      ticker: params.ticker,
      date: params.date,
      value: 0,
      confidence: 0,
    };
  }

  const sign = captureEffect.direction === 'positive' ? 1 : -1;
  return {
    factor: 'commercialization',
    ticker: params.ticker,
    date: params.date,
    value: sign * captureEffect.magnitude * captureEffect.confidence * COMMERCIALIZATION_SCALE,
    confidence: captureEffect.confidence,
  };
}
