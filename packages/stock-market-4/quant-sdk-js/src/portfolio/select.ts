import { equalWeightStrategy } from './equalWeight.js';
import { inverseVolatilityStrategy } from './inverseVolatility.js';
import { riskParityStrategy } from './riskParity.js';
import type { PortfolioStrategy } from './types.js';

export type PortfolioStrategyName = 'equal_weight' | 'inverse_volatility' | 'risk_parity';

/** Config-driven strategy selection (plan Phase 1, item 5) — the walk-forward harness
 * (`../../backtest/walkForward.ts`) runs every one of these against the identical alpha/risk/
 * execution pipeline so they're empirically comparable, rather than the bot committing to one. */
export function selectPortfolioStrategy(name: PortfolioStrategyName): PortfolioStrategy {
  switch (name) {
    case 'equal_weight':
      return equalWeightStrategy;
    case 'inverse_volatility':
      return inverseVolatilityStrategy;
    case 'risk_parity':
      return riskParityStrategy;
  }
}

export const ALL_PORTFOLIO_STRATEGY_NAMES: PortfolioStrategyName[] = [
  'equal_weight',
  'inverse_volatility',
  'risk_parity',
];
