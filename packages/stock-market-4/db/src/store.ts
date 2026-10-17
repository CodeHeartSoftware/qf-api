import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { forwardMatchStoreMigrations } from '@quant-fusion/forward-match-store';
import { marketDataMigrations } from '@quant-fusion/market-data';
import { researchStoreMigrations } from '@quant-fusion/research-store';
import { applyMigrations, type Migration } from '@quant-fusion/sqlite-migrations';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for the full explanation of why `node:sqlite`
// is loaded this way rather than via a static import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Every migration for the ONE shared Stock Market 4 database — market data, research data, and
 * forward-match/portfolio data all live in this single file (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). Each domain package's own migration ids are
 * namespaced (`market-data/...`, `research-store/...`, `forward-match-store/...`) specifically so
 * they can share one `_migrations` table without colliding; `applyMigrations` re-sorts this
 * combined list by id, so cross-package interleaving here is harmless — nothing depends on one
 * domain's migrations running before another's.
 */
export const stockMarket4Migrations: Migration[] = [
  ...marketDataMigrations,
  ...researchStoreMigrations,
  ...forwardMatchStoreMigrations,
];

/**
 * The shared handle every domain package's own store functions take — structurally identical to
 * `@quant-fusion/market-data`'s `MarketDataStore` and `@quant-fusion/research-store`'s
 * `ResearchStore` (`{ db, path }`), so a `StockMarket4Db` can be passed anywhere either of those is
 * expected with no conversion.
 */
export interface StockMarket4Db {
  readonly db: DatabaseSyncType;
  readonly path: string;
}

/** Opens (creating it and its parent directory if needed) `dbPath` and applies every domain's
 * migrations. This is the only function in the whole codebase that should call
 * `new DatabaseSync(...)` for Stock Market 4's persistent data — every domain package's own
 * store functions take the `StockMarket4Db` this returns rather than opening a file themselves. */
export function openStockMarket4Db(dbPath: string): StockMarket4Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const result = applyMigrations(db, stockMarket4Migrations);
  if (!result.ok) {
    throw new Error(`failed to apply Stock Market 4 migrations to "${dbPath}": ${result.reason}`);
  }
  return { db, path: dbPath };
}

/** A fresh `:memory:` database with every migration applied — zero filesystem setup. This is what
 * lets a consumer (e.g. `research/fusion`'s `fixture.ts`) get "the current dataset" by replaying
 * migrations alone, proving the migration history is the true source of truth rather than a
 * separately-maintained file. */
export function openEphemeralStockMarket4Db(): StockMarket4Db {
  return openStockMarket4Db(':memory:');
}

/** Explicit close — see `@quant-fusion/market-data`'s own `closeMarketDataStore` for the one known
 * limitation this shares (no automatic teardown hook yet). */
export function closeStockMarket4Db(store: StockMarket4Db): void {
  store.db.close();
}
