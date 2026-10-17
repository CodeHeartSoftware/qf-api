import path from 'node:path';

/** Same shared SQLite file `apps/cli`'s `match forward` commands read/write — see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`. Kept in sync by convention (this package has
 * no dependency on `apps/cli`, which isn't a library other packages/apps import from). */
export function defaultForwardMatchStoreDbPath(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'db.sqlite');
}

/** Where every Stock Market 4 bot submission lives — one directory per bot id, each with its own
 * `manifest.json` (see `bots/stock-market-4/*`). */
export function botsDir(rootDir: string): string {
  return path.join(rootDir, 'bots', 'stock-market-4');
}

/** The Jobs tab's run-history log (`@quant-fusion/job-run-store`) — its own file, separate from
 * `defaultForwardMatchStoreDbPath`'s combined db: an operational log of "what did this app run
 * and when" is a different concern from match/research/market state, and has no reason to share
 * a schema (or a migration history) with any of it. */
export function defaultJobRunStoreDbPath(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'job-runs.sqlite');
}

/** App-wide settings the Settings tab manages (currently just the OpenAI API key the News
 * Research Agent uses) — plain JSON, not SQLite: a handful of fields with no query/migration
 * needs of their own. Lives in the same gitignored `.quant-fusion/` tree as the other local state
 * here, never committed. See `lib/settingsStore.ts`. */
export function defaultSettingsPath(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'settings.json');
}
