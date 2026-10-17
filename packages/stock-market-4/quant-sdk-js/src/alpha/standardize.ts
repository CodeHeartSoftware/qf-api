import type { RealizedAlphaSample } from './ic.js';
import type { AlphaSignal } from './types.js';

/**
 * Puts every factor on one scale before `combineAlphaEnsemble` averages them. Without this the
 * raw units dominate: `valuation_gap` is a fair-value/price ratio routinely ±50%, while
 * `evidence_delta` is scaled by 0.02 — so the "measured" ensemble weights barely mattered and
 * valuation decided everything (2026-09 audit).
 *
 * Each factor is divided by the RMS of its own past NON-ZERO values (every realized sample so far
 * plus this round's live signals) — standard signal-volatility scaling. Deliberately NOT demeaned
 * across tickers: the book is long-only, so "cheap in absolute terms" must keep its sign.
 * `expectedReturnPerUnit` then maps one unit of typical signal back to an expected return, so
 * `PortfolioConstructionPolicy.activationThreshold` keeps its meaning.
 */
export interface SignalStandardizationPolicy {
  expectedReturnPerUnit: number;
  /** Symmetric clip in RMS units, so one outlier reading can't dominate the combination. */
  clip: number;
}

export function computeFactorScales(
  history: RealizedAlphaSample[],
  currentSignals: AlphaSignal[],
): Map<string, number> {
  const sums = new Map<string, { sumSquares: number; count: number }>();
  const add = (factor: string, value: number) => {
    if (value === 0 || !Number.isFinite(value)) return;
    const entry = sums.get(factor) ?? { sumSquares: 0, count: 0 };
    entry.sumSquares += value * value;
    entry.count += 1;
    sums.set(factor, entry);
  };
  for (const sample of history) add(sample.factor, sample.predicted);
  for (const signal of currentSignals) if (signal.confidence > 0) add(signal.factor, signal.value);
  return new Map(
    [...sums].map(([factor, { sumSquares, count }]) => [factor, Math.sqrt(sumSquares / count)]),
  );
}

export function standardizeSignals(
  signals: AlphaSignal[],
  scaleByFactor: Map<string, number>,
  policy: SignalStandardizationPolicy,
): AlphaSignal[] {
  return signals.map((signal) => {
    const scale = scaleByFactor.get(signal.factor);
    if (scale === undefined || scale === 0) return { ...signal, value: 0 };
    const units = Math.max(-policy.clip, Math.min(policy.clip, signal.value / scale));
    return { ...signal, value: units * policy.expectedReturnPerUnit };
  });
}
