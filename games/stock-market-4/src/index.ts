export * from './types.js';
export * from './game.js';
export * from './execution/orders.js';
export * from './market/calendar.js';
export * from './market/corporateActions.js';
export * from './market/historicalPrices.js';
export * from './market/security.js';
export * from './metrics/performance.js';
export * from './money.js';
export * from './portfolio/accounting.js';
export * from './portfolio/borrow.js';
export * from './portfolio/liquidation.js';
export * from './research/timeline.js';

// The registry-driven CLI (@quant-fusion/registry + apps/cli) resolves a game manifest's
// `entryPackage` and dynamically imports it — it can't statically know each game's own export
// name (`stockMarket4` here), so every game's entrypoint must also export its GameDefinition under
// this fixed name (games/rock-paper-scissors/src/index.ts established the convention).
export { stockMarket4 as game } from './game.js';
