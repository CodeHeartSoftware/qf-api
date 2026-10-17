/** Thin re-export: the statistical half of `blended.ts`'s correlation blend reuses
 * `fusion-fundamental-v7`'s own real trailing-price-return correlation math (`../correlation.ts`,
 * unchanged in this bot) rather than re-deriving it. */
export { computePearsonCorrelation, computeReturnsSeries } from '../correlation.js';
