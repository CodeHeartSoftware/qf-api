/**
 * @quant-fusion/forward-match-store — persists a resumable forward match's record as one JSON file
 * per `matchId`. See docs/adr/0013-forward-match-persistence.md for why this exists and how it
 * differs from `@quant-fusion/tournament-store`, the closest existing precedent.
 */
export * from './result.js';
export * from './types.js';
export * from './store.js';
export * from './audit.js';
export * from './migrations/index.js';
