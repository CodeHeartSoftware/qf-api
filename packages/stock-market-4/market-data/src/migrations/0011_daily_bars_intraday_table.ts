import type { Migration } from '@quant-fusion/sqlite-migrations';

/** A per-ticker PROVISIONAL bar — today's price while its exchange's regular session is still
 * open, before there's a real, final close to append to `daily_bars`. Deliberately NOT
 * migration-tracked content, unlike everything else in this package: a provisional snapshot is
 * explicitly throwaway (superseded by the next fetch, or by the real final bar once the session
 * ends), the opposite of what a migration is for. This table's SCHEMA comes from this migration
 * (once, like any other table here), but its ROWS are ordinary runtime writes — the same
 * "schema from a migration, rows are plain writes" split `forward-match-store`'s own
 * `forward_matches` table already uses for the same reason (a match's live state isn't reviewable
 * curated content either). See `store/provisional.ts` for the read/write functions, never
 * `store/sqlGen.ts` (that module is specifically for migration-file SQL, which this is not). */
export const migration0011DailyBarsIntradayTable: Migration = {
  id: 'market-data/0011_daily_bars_intraday_table',
  sql: `
CREATE TABLE IF NOT EXISTS daily_bars_intraday (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,
  open       REAL NOT NULL,
  high       REAL NOT NULL,
  low        REAL NOT NULL,
  close      REAL NOT NULL,
  volume     REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, ticker, date),
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
`,
};
