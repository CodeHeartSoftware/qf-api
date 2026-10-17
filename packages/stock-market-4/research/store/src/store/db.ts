import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations } from '@quant-fusion/sqlite-migrations';
import { researchStoreMigrations } from '../migrations/index.js';
import { err, ok, type Result } from '../result.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for the full explanation of why `node:sqlite`
// is loaded via `createRequire` rather than a static `import` here.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Wraps a `node:sqlite` `DatabaseSync` handle for one research domain's file (one file per
 * domain — e.g. `fusion.sqlite`, `quantum.sqlite` — mirroring `@quant-fusion/market-data`'s
 * one-file-per-dataset-id convention). Opaque deliberately: nothing outside this package's own
 * `store/` modules should touch the raw handle.
 */
export interface ResearchStore {
  readonly db: DatabaseSyncType;
  readonly path: string;
}

/** Creates (or opens, if it already exists) a research domain's SQLite file and ensures its
 * schema is up to date via `@quant-fusion/sqlite-migrations`. Safe to call repeatedly. */
export function createResearchStore(dbPath: string): ResearchStore {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const result = applyMigrations(db, researchStoreMigrations);
  if (!result.ok) {
    throw new Error(`failed to apply research-store migrations to "${dbPath}": ${result.reason}`);
  }
  return { db, path: dbPath };
}

/** Opens an EXISTING research domain file for reading. Fails closed (a `Result`, never a thrown
 * exception) when the file doesn't exist, matching `@quant-fusion/market-data`'s
 * `openMarketDataStore` convention. Deliberately does NOT apply migrations — the handle is
 * read-only; a store file must already be current via `createResearchStore`. */
export function openResearchStore(dbPath: string): Result<ResearchStore> {
  if (!existsSync(dbPath)) {
    return err(`research dataset store not found at "${dbPath}"`);
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA foreign_keys = ON;');
    return ok({ db, path: dbPath });
  } catch (error) {
    return err(`failed to open research dataset store at "${dbPath}": ${String(error)}`);
  }
}

/** Explicit close — see `@quant-fusion/market-data`'s own `closeMarketDataStore` for the one
 * known limitation this shares (no automatic teardown hook yet). */
export function closeResearchStore(store: ResearchStore): void {
  store.db.close();
}
