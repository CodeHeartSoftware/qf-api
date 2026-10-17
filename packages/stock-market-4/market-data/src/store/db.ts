import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations } from '@quant-fusion/sqlite-migrations';
import { marketDataMigrations } from '../migrations/index.js';
import { err, ok, type Result } from '../result.js';

// `node:sqlite` is loaded via `createRequire` rather than a static `import`, deliberately: Vite's
// (and therefore Vitest's) module resolver does not yet recognize this recently-stabilized Node
// builtin as external during its dev-time transform, and tries to load it as if it were a real
// file named "sqlite" — see this package's README for the full explanation. `createRequire` is a
// plain runtime `require()` call, invisible to Vite's static import analysis, and works
// identically under `tsc`'s compiled ESM output at real runtime (Node's own `createRequire` is
// unaffected by any of this — it's purely a build/test-tooling workaround).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Wraps a `node:sqlite` `DatabaseSync` handle for one dataset's file (one file per dataset id —
 * see `docs/adr/0010-sqlite-market-data-store.md`). Kept as an opaque type deliberately: nothing
 * outside this package's own `store/`/`provider/` modules should touch the raw handle, so a
 * consumer (a game) only ever sees the higher-level `MarketDataProvider` in `provider/provider.ts`.
 *
 * `node:sqlite`'s `DatabaseSync` is fully synchronous, matching every `GameDefinition` method
 * (`initialize`/`resolve`/`getObservation`/...) already being synchronous — no async wrapper layer
 * needed anywhere this store is used. Chosen over `better-sqlite3` specifically to avoid adding
 * this repo's first native/compiled dependency; see ADR-0010 for the full reasoning.
 */
export interface MarketDataStore {
  readonly db: DatabaseSyncType;
  readonly path: string;
}

/** Creates (or opens, if it already exists) a dataset's SQLite file and ensures its schema is
 * up to date — the write/ingest-time entry point (see `store/ingest.ts`). Safe to call
 * repeatedly: `applyMigrations` (`@quant-fusion/sqlite-migrations`) skips migrations already
 * recorded as applied (see `docs/adr/0014-sqlite-standard-and-migrations.md`). */
export function createMarketDataStore(dbPath: string): MarketDataStore {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const result = applyMigrations(db, marketDataMigrations);
  if (!result.ok) {
    throw new Error(`failed to apply market-data migrations to "${dbPath}": ${result.reason}`);
  }
  return { db, path: dbPath };
}

/** Opens an EXISTING dataset file for reading — the path a `MarketDataProvider` is built from
 * (see `provider/provider.ts`). Fails closed (a `Result`, never a thrown exception) when the file
 * doesn't exist, matching `@quant-fusion/tournament-store`'s "missing/corrupt record" convention:
 * a match that references a dataset that was never seeded should get a clear, catchable error,
 * not a fresh empty database silently created in its place. Deliberately does NOT apply
 * migrations (the handle is read-only) — a dataset file must already be current, e.g. via a seed
 * script that used `createMarketDataStore`. */
export function openMarketDataStore(dbPath: string): Result<MarketDataStore> {
  if (!existsSync(dbPath)) {
    return err(`market dataset store not found at "${dbPath}"`);
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA foreign_keys = ON;');
    return ok({ db, path: dbPath });
  } catch (error) {
    return err(`failed to open market dataset store at "${dbPath}": ${String(error)}`);
  }
}

/** Explicit close — see this package's README for the one known Phase 1 limitation: nothing in
 * `@quant-fusion/engine`'s `GameDefinition` offers a match-teardown hook to call this from
 * automatically yet, so a long-lived process (e.g. a tournament running many matches) currently
 * relies on process exit / GC rather than a guaranteed close per match. Exposed here so a CLI or
 * test that owns a store's whole lifecycle explicitly can still close it. */
export function closeMarketDataStore(store: MarketDataStore): void {
  store.db.close();
}
