import type {
  PortfolioConstructionInput,
  PortfolioConstructionPolicy,
  PortfolioConstructionResult,
  PortfolioStrategy,
} from './types.js';
import { selectActiveAlphas } from './selection.js';

/**
 * Standard risk-parity-adjacent "vol targeting" allocation: an active security's share of
 * `totalGrossBudgetPct` is proportional to its OWN inverse trailing daily volatility, so a calm
 * security and a wild one don't get identical weight just because both cleared the activation
 * threshold — the same real-world sizing practice `fusion-fundamental-v7`'s
 * `VolatilitySizingPolicy` used, applied here at the ALLOCATION stage instead of as a post-hoc
 * per-security scale factor. A security with no volatility reading yet (too little price history)
 * falls back to the average inverse-volatility of the OTHER active securities — an honest "assume
 * roughly typical risk until we know otherwise" default, never a zero (which would silently exclude
 * it) or an invented specific number.
 */
export const inverseVolatilityStrategy: PortfolioStrategy = {
  name: 'inverse_volatility',
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

    const knownInverseVols = active
      .map((a) =>
        a.dailyVolatility !== undefined && a.dailyVolatility > 0
          ? 1 / a.dailyVolatility
          : undefined,
      )
      .filter((v): v is number => v !== undefined);
    const fallbackInverseVol =
      knownInverseVols.length > 0
        ? knownInverseVols.reduce((sum, v) => sum + v, 0) / knownInverseVols.length
        : 1;

    const rawInverseVolByTicker = new Map(
      active.map((a) => [
        a.ticker,
        a.dailyVolatility !== undefined && a.dailyVolatility > 0
          ? 1 / a.dailyVolatility
          : fallbackInverseVol,
      ]),
    );
    const totalRaw = [...rawInverseVolByTicker.values()].reduce((sum, v) => sum + v, 0);

    for (const a of active) {
      const rawInverseVol = rawInverseVolByTicker.get(a.ticker);
      if (rawInverseVol === undefined) continue; // unreachable: rawInverseVolByTicker is built from `active` itself
      const share = (rawInverseVol / totalRaw) * policy.totalGrossBudgetPct;
      weightByTicker.set(a.ticker, Math.min(policy.maxPositionWeight, share));
    }

    return {
      weightByTicker,
      note:
        `inverse_volatility: ${String(active.length)} of ${String(input.alphas.length)} securities active, ` +
        `sized inversely to trailing daily volatility (${String(knownInverseVols.length)} had a measurable ` +
        `volatility; the rest used the average of those).`,
    };
  },
};
