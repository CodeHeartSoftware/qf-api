/**
 * @quant-fusion/market-data — a SQLite-backed, versioned market-data store, sitting behind a
 * generic `MarketDataProvider` abstraction. See README.md and
 * `docs/adr/0010-sqlite-market-data-store.md` for why this package exists and how it fits the
 * repo's otherwise-standing "no database" constraint.
 *
 * Populated incrementally; this barrel is the only import surface consumers should use.
 */
export * from './result.js';
export * from './migrations/index.js';
export * from './schema/dailyBar.js';
export * from './schema/corporateAction.js';
export * from './dataset/identity.js';
export * from './store/db.js';
export * from './store/ingest.js';
export * from './store/append.js';
export * from './store/queries.js';
export * from './store/sqlGen.js';
export * from './store/provisional.js';
export * from './provider/provider.js';
export * from './provider/provisionalFallback.js';
export * from './provider/yahooFinance.js';
export * from './snapshot/snapshot.js';
