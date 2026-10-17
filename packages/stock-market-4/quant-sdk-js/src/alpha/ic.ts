import type { AlphaSignal } from './types.js';

/** The sample count at which a factor's own measured IC crosses HALF trust against the
 * cross-sectional prior — see `shrinkageIntensity`/`computeEnsembleWeights`. Not a hard cutoff (a
 * factor below this still gets a proportionally-shrunk share of its own measured IC, never zero
 * once it has at least one real sample); configurable via
 * `AlphaEnsemblePolicy.minSamplesForMeasuredIC` in `../config.ts` for callers/tests that want to
 * vary it. */
export const DEFAULT_MIN_SAMPLES_FOR_MEASURED_IC = 10;

/**
 * How much a factor's OWN measured IC should be trusted, in `[0, 1)`, given `sampleSize` realized
 * (predicted, actual) observations — `n / (n + minSamples)`, the standard "pseudo-count"
 * empirical-Bayes shrinkage form: `minSamples` acts as how many real observations the
 * cross-sectional prior is worth, so trust crosses 50% exactly at `sampleSize === minSamples` (a
 * strict generalization of the OLD binary cutoff this replaced, not an unrelated new number) and
 * keeps climbing asymptotically toward (never reaching) 1 as more samples accumulate — never
 * fully trusting a measured IC at any FINITE sample size, unlike the old all-or-nothing gate. A
 * fixed blend constant (this codebase's `AlphaEnsemblePolicy.rollingBlendWeight` — a completely
 * different, VALUATION-model concept; see `valuation/rollingBaseValue.ts`) is the wrong shape for
 * THIS problem specifically because trust in a measured correlation genuinely depends on how much
 * evidence has accumulated, not a single number applied uniformly regardless of sample size.
 * `minSamples <= 0` means "trust real data immediately" (the prior is worth zero pseudo-samples).
 */
function shrinkageIntensity(sampleSize: number, minSamples: number): number {
  if (minSamples <= 0) return 1;
  return sampleSize / (sampleSize + minSamples);
}

/** One realized (predicted-vs-actual) observation for one alpha factor — the raw material for
 * `measureAlphaIC`. `predicted` is that factor's own `AlphaSignal.value` from some earlier round;
 * `realizedForwardReturn` is the security's ACTUAL subsequent return over the same horizon the
 * prediction was made for. Never includes anything from AFTER the return window closed — see
 * `../decision.ts`'s bookkeeping of `pendingAlphaByTicker` for how this is assembled without
 * look-ahead. */
export interface RealizedAlphaSample {
  factor: string;
  predicted: number;
  realizedForwardReturn: number;
}

/** Generic Pearson correlation between two equal-length numeric series — the same formula
 * `../correlation.ts`'s `computePearsonCorrelation` uses for price-return series, generalized here
 * to any two paired series (predicted alpha values vs. realized returns). `undefined` for fewer
 * than 2 pairs or a degenerate (zero-variance) series, same as that function. */
export function pearsonCorrelation(xs: number[], ys: number[]): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return undefined;
  const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) continue; // unreachable given n = min(xs.length, ys.length); satisfies noUncheckedIndexedAccess
    const dx = x - meanX;
    const dy = y - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return undefined;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Fractional (average-tie) ranks, ascending — the standard input transform for a Spearman rank
 * correlation. Tied values get the mean of the ranks they would otherwise occupy. */
function fractionalRanks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    const current = indexed[i];
    if (current === undefined) break; // unreachable given the loop condition; satisfies noUncheckedIndexedAccess
    let j = i;
    while (j + 1 < indexed.length) {
      const next = indexed[j + 1];
      if (next?.value !== current.value) break;
      j++;
    }
    const averageRank = (i + j) / 2 + 1; // 1-indexed rank, averaged across the tied block
    for (let k = i; k <= j; k++) {
      const entry = indexed[k];
      if (entry === undefined) continue; // unreachable given i <= k <= j < indexed.length
      ranks[entry.index] = averageRank;
    }
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation — Pearson correlation of the two series' own ranks. Rank-based
 * (rather than plain Pearson alone) is the more standard "information coefficient" in quant
 * practice specifically because it's robust to a few extreme-return outliers dominating the
 * measurement, which real single-day stock returns are prone to. */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number | undefined {
  if (Math.min(xs.length, ys.length) < 2) return undefined;
  return pearsonCorrelation(fractionalRanks(xs), fractionalRanks(ys));
}

export interface AlphaICStats {
  factor: string;
  sampleSize: number;
  pearsonIC: number | undefined;
  rankIC: number | undefined;
}

/** Measures each factor's historical information coefficient — both plain Pearson and rank
 * (Spearman) — against realized forward returns. Grouped by `factor` only (pooled across every
 * ticker/date that produced a sample), since with ~11 securities and ~2 months of real history,
 * measuring a SEPARATE IC per ticker would starve every one of them of sample size; see this
 * bot's own plan doc for the explicit caveat that these numbers stay statistically thin until
 * `fetch:append-bars` accumulates materially more real history.
 */
export function measureAlphaIC(samples: RealizedAlphaSample[]): Map<string, AlphaICStats> {
  const byFactor = new Map<string, RealizedAlphaSample[]>();
  for (const sample of samples) {
    const group = byFactor.get(sample.factor);
    if (group === undefined) byFactor.set(sample.factor, [sample]);
    else group.push(sample);
  }

  const stats = new Map<string, AlphaICStats>();
  for (const [factor, group] of byFactor) {
    const predicted = group.map((s) => s.predicted);
    const realized = group.map((s) => s.realizedForwardReturn);
    stats.set(factor, {
      factor,
      sampleSize: group.length,
      pearsonIC: pearsonCorrelation(predicted, realized),
      rankIC: spearmanRankCorrelation(predicted, realized),
    });
  }
  return stats;
}

/**
 * Ensemble weight per factor — MEASURED from `icStatsByFactor`, never hand-picked (the plan's
 * central requirement). Every factor with at least one realized observation gets a weight that's
 * a SHRINKAGE BLEND of its own positive-clipped `max(0, rankIC)` (falling back to `pearsonIC`
 * when rank IC itself is undefined, e.g. degenerate ranks) and the cross-sectional PRIOR (the
 * average clipped IC across every factor with at least one sample). Clipped, not `|IC|`: a
 * factor's raw signal is combined with its own sign, so weighting a reliably NEGATIVE predictor by
 * its magnitude would push trades the wrong way (2026-09 audit — momentum measured anti-predictive
 * here yet held ~20% of the ensemble); a zero weight simply ignores it — never the raw measured value outright, and never the flat prior outright either,
 * except in the limits `sampleSize → ∞` and `sampleSize === 0` respectively (see
 * `shrinkageIntensity`). A factor with ZERO samples at all gets exactly the prior (trust = 0),
 * and if NO factor has any samples yet, every factor falls back to plain equal weight — the same
 * "no invented number" floor this always had, just reached continuously now instead of by a
 * sampleSize < minSamples cutoff with a discontinuous jump at the threshold. When measured
 * factors exist but NONE shows positive predictive power, every weight is zero — the ensemble
 * then combines to "no view" (cash), rather than an equal-weight vote for signals shown not to work.
 */
export function computeEnsembleWeights(
  icStatsByFactor: Map<string, AlphaICStats>,
  presentFactors: string[],
  minSamples: number = DEFAULT_MIN_SAMPLES_FOR_MEASURED_IC,
): Map<string, number> {
  if (presentFactors.length === 0) return new Map();

  const measuredByFactor = new Map<string, { sampleSize: number; ic: number }>();
  for (const factor of presentFactors) {
    const stat = icStatsByFactor.get(factor);
    if (stat === undefined) continue;
    const ic = stat.rankIC ?? stat.pearsonIC;
    if (ic !== undefined)
      measuredByFactor.set(factor, { sampleSize: stat.sampleSize, ic: Math.max(0, ic) });
  }

  if (measuredByFactor.size === 0) {
    const equal = 1 / presentFactors.length;
    return new Map(presentFactors.map((factor) => [factor, equal]));
  }

  const prior =
    [...measuredByFactor.values()].reduce((sum, m) => sum + m.ic, 0) / measuredByFactor.size;
  const rawWeight = new Map(
    presentFactors.map((factor) => {
      const measured = measuredByFactor.get(factor);
      if (measured === undefined) return [factor, prior] as const;
      const trust = shrinkageIntensity(measured.sampleSize, minSamples);
      return [factor, trust * measured.ic + (1 - trust) * prior] as const;
    }),
  );

  const total = [...rawWeight.values()].reduce((sum, w) => sum + w, 0);
  if (total === 0) return new Map(presentFactors.map((factor) => [factor, 0]));
  return new Map([...rawWeight.entries()].map(([factor, w]) => [factor, w / total]));
}

/**
 * Combines this round's per-factor `AlphaSignal`s into one expected-return/confidence pair, using
 * `weightByFactor` (from `computeEnsembleWeights`) — a plain weighted average of
 * `value * confidence`, normalized by total weight actually present this round (a factor absent
 * from `signals`, e.g. dropped by `../ablation.ts`, contributes neither numerator nor denominator,
 * rather than being treated as a confident zero). Returns `{ expectedReturn: 0, confidence: 0,
 * contributionByFactor: {} }` when no signal carries any weight at all (e.g. every alpha ablated
 * away).
 *
 * `contributionByFactor` is an EXACT decomposition, not an approximation: each factor's own term
 * in the same weighted average (`weight * value * confidence / totalWeight`), so
 * `Object.values(contributionByFactor).reduce(sum) === expectedReturn` up to floating-point
 * rounding — this is what lets a caller say "of this security's expected return, X came from
 * valuation_gap, Y came from momentum" without re-deriving the math independently (see
 * `TradingDecision.alphaContribution` and `quant-v0`'s `backtest/returnAttribution.ts`, the return-
 * attribution decomposition the bot's own README lists as not yet built).
 */
export function combineAlphaEnsemble(
  signals: AlphaSignal[],
  weightByFactor: Map<string, number>,
): { expectedReturn: number; confidence: number; contributionByFactor: Record<string, number> } {
  let weightedValue = 0;
  let weightedConfidence = 0;
  let totalWeight = 0;
  const rawContribution = new Map<string, number>();
  for (const signal of signals) {
    const weight = weightByFactor.get(signal.factor) ?? 0;
    if (weight === 0) continue;
    const term = weight * signal.value * signal.confidence;
    weightedValue += term;
    weightedConfidence += weight * signal.confidence;
    totalWeight += weight;
    rawContribution.set(signal.factor, (rawContribution.get(signal.factor) ?? 0) + term);
  }
  if (totalWeight === 0) return { expectedReturn: 0, confidence: 0, contributionByFactor: {} };
  const contributionByFactor = Object.fromEntries(
    [...rawContribution].map(([factor, term]) => [factor, term / totalWeight]),
  );
  return {
    expectedReturn: weightedValue / totalWeight,
    confidence: weightedConfidence / totalWeight,
    contributionByFactor,
  };
}
