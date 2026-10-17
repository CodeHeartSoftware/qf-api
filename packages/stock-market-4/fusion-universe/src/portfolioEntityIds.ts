import { TRACKED_SECURITIES } from './trackedSecurities.js';

/**
 * The 11 tracked-security entity ids, derived from `trackedSecurities.ts`'s `TRACKED_SECURITIES`
 * — split into its own file since `@quant-fusion/research-fusion`'s `scope.ts` (and everything
 * built on it: `isPortfolioEntity`, the ecosystem/portfolio research split) only ever needs this
 * entity-id-only view, never the full `TrackedSecurity` records (ticker/exchange/Yahoo symbol/
 * currency, which are `@quant-fusion/market-data`'s concern instead).
 */
export const PORTFOLIO_ENTITY_IDS: ReadonlySet<string> = new Set(
  TRACKED_SECURITIES.map((s) => s.entityId),
);
