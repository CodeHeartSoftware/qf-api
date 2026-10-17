import {
  effectiveCorrelationKey,
  type PortfolioConstructionInput,
  type PortfolioConstructionPolicy,
  type PortfolioConstructionResult,
  type PortfolioStrategy,
} from './types.js';
import { selectActiveAlphas } from './selection.js';

/** How strongly average effective correlation with the REST of the active book penalizes a
 * security's risk-parity weight — illustrative starting point (not swept/tuned), same shape as
 * `fusion-fundamental-v7`'s own `CorrelationSizingPolicy.concentrationPenalty`. */
export const DEFAULT_RISK_PARITY_CORRELATION_PENALTY = 0.5;

/**
 * A HEURISTIC risk-parity APPROXIMATION, not an exact numerical risk-parity solve (true risk parity
 * — equalizing each asset's marginal contribution to total portfolio variance — needs solving a
 * nonlinear system against a full covariance matrix, which with ~11 securities and ~2 months of
 * real history would be exactly the "manufactured precision" the plan rejects mean-variance for).
 * Instead: an active security's "risk contribution proxy" is its own trailing daily volatility,
 * INFLATED by how correlated it is (via `../correlation/blended.ts`'s effective correlation) with
 * the rest of the active book — a security that's both volatile AND redundant with everything else
 * held gets scaled down the most; weight is then allocated inversely to that proxy. Falls back the
 * same way `inverseVolatility.ts` does when a volatility reading is missing.
 */
export const riskParityStrategy: PortfolioStrategy = {
  name: 'risk_parity',
  construct(
    input: PortfolioConstructionInput,
    policy: PortfolioConstructionPolicy,
  ): PortfolioConstructionResult {
    // Long-only in Phase 1 — see PortfolioConstructionPolicy.activationThreshold's own doc comment.
    const active = selectActiveAlphas(input.alphas, policy);
    const weightByTicker = new Map<string, number>();
    for (const a of input.alphas) weightByTicker.set(a.ticker, 0);

    if (active.length === 0) {
      return {
        weightByTicker,
        note: 'No security was selected (see ./selection.ts); fully in cash.',
      };
    }

    const knownVols = active
      .map((a) => a.dailyVolatility)
      .filter((v): v is number => v !== undefined && v > 0);
    const fallbackVol =
      knownVols.length > 0 ? knownVols.reduce((sum, v) => sum + v, 0) / knownVols.length : 0.02;

    const volByTicker = new Map(
      active.map((a) => [
        a.ticker,
        a.dailyVolatility && a.dailyVolatility > 0 ? a.dailyVolatility : fallbackVol,
      ]),
    );

    const avgCorrelationByTicker = new Map<string, number>();
    for (const a of active) {
      const others = active.filter((b) => b.ticker !== a.ticker);
      if (others.length === 0) {
        avgCorrelationByTicker.set(a.ticker, 0);
        continue;
      }
      const correlations = others.map(
        (b) =>
          input.effectiveCorrelationByPair.get(effectiveCorrelationKey(a.ticker, b.ticker)) ?? 0,
      );
      avgCorrelationByTicker.set(
        a.ticker,
        correlations.reduce((sum, c) => sum + Math.max(0, c), 0) / others.length,
      );
    }

    const inverseRiskByTicker = new Map<string, number>();
    for (const a of active) {
      const vol = volByTicker.get(a.ticker) ?? fallbackVol;
      const avgCorrelation = avgCorrelationByTicker.get(a.ticker) ?? 0;
      const riskProxy = vol * (1 + avgCorrelation * DEFAULT_RISK_PARITY_CORRELATION_PENALTY);
      inverseRiskByTicker.set(a.ticker, 1 / riskProxy);
    }
    const totalInverseRisk = [...inverseRiskByTicker.values()].reduce((sum, v) => sum + v, 0);

    for (const a of active) {
      const inverseRisk = inverseRiskByTicker.get(a.ticker);
      if (inverseRisk === undefined) continue; // unreachable: inverseRiskByTicker is built from `active` itself
      const share = (inverseRisk / totalInverseRisk) * policy.totalGrossBudgetPct;
      weightByTicker.set(a.ticker, Math.min(policy.maxPositionWeight, share));
    }

    return {
      weightByTicker,
      note:
        `risk_parity (heuristic approximation, not an exact numerical solve): ${String(active.length)} of ` +
        `${String(input.alphas.length)} securities active, sized inversely to volatility scaled up by average ` +
        `effective correlation with the rest of the active book.`,
    };
  },
};
