import type { ModelEffect } from '../research/interpretEvents.js';
import type { AlphaSignal } from './types.js';

/** $ of expected-return fraction per unit of (magnitude * confidence) for a generic
 * manufacturing-capability/hypothesis-confidence research effect — an illustrative starting
 * strategy assumption (not swept/tuned), deliberately SMALLER than `commercialization.ts`'s own
 * scale, mirroring `fusion-fundamental-v7`'s `hypothesisConfidenceToFusionOptionPerShare` being a
 * weaker evidence tier than a qualification/contract change (spec §10, carried over from that
 * bot's own `research/interpretEvents.ts` doc comment). */
export const EVIDENCE_DELTA_SCALE = 0.02;

/**
 * Turns the SAME `ModelEffect`s `fusion-fundamental-v7`'s `computeCompanyValuation` already
 * consumes (`research/interpretEvents.ts`, unchanged in this bot) into one `AlphaSignal` — the
 * "generic research news" alpha, deliberately excluding `supplier_capture` effects (those get
 * their OWN, independently-measured alpha — see `commercialization.ts` — since a qualification/
 * contract-tier change is a materially different evidence class, not just a bigger version of a
 * capability/hypothesis change).
 */
export function computeEvidenceDeltaAlpha(params: {
  ticker: string;
  date: string | null;
  effects: ModelEffect[];
}): AlphaSignal {
  const relevant = params.effects.filter(
    (effect) =>
      effect.factor === 'manufacturing_capability' || effect.factor.startsWith('hypothesis:'),
  );
  if (relevant.length === 0) {
    return {
      factor: 'evidence_delta',
      ticker: params.ticker,
      date: params.date,
      value: 0,
      confidence: 0,
    };
  }

  let value = 0;
  let confidenceSum = 0;
  for (const effect of relevant) {
    const sign = effect.direction === 'positive' ? 1 : effect.direction === 'negative' ? -1 : 0;
    value += sign * effect.magnitude * effect.confidence * EVIDENCE_DELTA_SCALE;
    confidenceSum += effect.confidence;
  }

  return {
    factor: 'evidence_delta',
    ticker: params.ticker,
    date: params.date,
    value,
    confidence: Math.min(1, confidenceSum / relevant.length),
  };
}
