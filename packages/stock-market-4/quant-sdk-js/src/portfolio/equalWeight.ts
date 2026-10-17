import type {
  PortfolioConstructionInput,
  PortfolioConstructionPolicy,
  PortfolioConstructionResult,
  PortfolioStrategy,
} from './types.js';
import { describeSelection, selectActiveAlphas } from './selection.js';

/** The simplest baseline strategy: every ACTIVE security (see `PortfolioConstructionPolicy.
 * activationThreshold`) gets an equal share of `totalGrossBudgetPct`, signed by its own expected
 * return's direction. Deliberately naive — the point of keeping this alongside `inverseVolatility`/
 * `riskParity` is to have a real, un-clever control every fancier strategy has to actually beat in
 * the walk-forward harness, not assume it will. */
export const equalWeightStrategy: PortfolioStrategy = {
  name: 'equal_weight',
  construct(
    input: PortfolioConstructionInput,
    policy: PortfolioConstructionPolicy,
  ): PortfolioConstructionResult {
    // Long-only in Phase 1 (see PortfolioConstructionPolicy.activationThreshold's own doc comment)
    // — only a POSITIVE combined signal activates a position.
    const active = selectActiveAlphas(input.alphas, policy);
    const weightByTicker = new Map<string, number>();
    for (const a of input.alphas) weightByTicker.set(a.ticker, 0);

    if (active.length === 0) {
      return {
        weightByTicker,
        note: 'No security was selected (see ./selection.ts); fully in cash.',
      };
    }

    const share = policy.totalGrossBudgetPct / active.length;
    for (const a of active) {
      weightByTicker.set(a.ticker, Math.min(policy.maxPositionWeight, share));
    }

    return {
      weightByTicker,
      note:
        `equal_weight: ${String(active.length)} of ${String(input.alphas.length)} securities active ` +
        `(${describeSelection(policy)}), each allocated ` +
        `${(share * 100).toFixed(1)}% of equity (before the ${(policy.maxPositionWeight * 100).toFixed(1)}% per-name cap).`,
    };
  },
};
