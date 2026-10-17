import type { Migration } from '@quant-fusion/sqlite-migrations';

/** The schema this package shipped with before it adopted `@quant-fusion/sqlite-migrations`
 * (see `docs/adr/0014-sqlite-standard-and-migrations.md`) — content unchanged from the original
 * `SCHEMA_DDL` in `store/db.ts`, just moved here as migration `market-data/0001_init`. The
 * `market-data/` prefix namespaces this id against `@thunderdome/research-store`'s and
 * `@thunderdome/forward-match-store`'s own migrations once `@thunderdome/stock-market-4-db`
 * aggregates all three into the one shared database's `_migrations` table. */
export const migration0001Init: Migration = {
  id: 'market-data/0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS dataset_versions (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  description     TEXT,
  PRIMARY KEY (dataset_id, dataset_version)
);

CREATE TABLE IF NOT EXISTS daily_bars (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,
  open  REAL NOT NULL,
  high  REAL NOT NULL,
  low   REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, ticker, date),
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
CREATE INDEX IF NOT EXISTS idx_daily_bars_asof ON daily_bars (dataset_id, dataset_version, ticker, date);

CREATE TABLE IF NOT EXISTS corporate_actions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id          TEXT NOT NULL,
  dataset_version     TEXT NOT NULL,
  ticker              TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN
                        ('CASH_DIVIDEND','STOCK_SPLIT','REVERSE_SPLIT','BUYBACK','ACQUISITION','DELISTING')),
  date                TEXT NOT NULL,
  announced_date      TEXT,
  per_share           REAL,
  from_shares         INTEGER,
  to_shares           INTEGER,
  shares_repurchased  INTEGER,
  cash_per_share      REAL,
  reason              TEXT,
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_asof
  ON corporate_actions (dataset_id, dataset_version, ticker, date);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_announced
  ON corporate_actions (dataset_id, dataset_version, ticker, announced_date);

CREATE TABLE IF NOT EXISTS trading_holidays (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  date            TEXT NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, date)
);
`,
};
