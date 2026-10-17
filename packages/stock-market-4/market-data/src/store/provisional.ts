import type { DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import type { MarketDataStore } from './db.js';

interface ProvisionalBarRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Live, non-migration writes/reads for `daily_bars_intraday` (see that table's own migration for
 * why this is deliberately NOT `sqlGen.ts` territory) — a ticker's provisional bar while its
 * exchange's regular session is still open. Every write here can run any number of times a day
 * with no git/migration footprint, unlike literally everything else this package persists.
 */

/** The current provisional bar for `ticker`, or `null` if none is recorded (the common case: most
 * tickers most of the time have no open-session snapshot at all). */
export function queryProvisionalBar(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
): DailyBar | null {
  const row = store.db
    .prepare(
      `SELECT date, open, high, low, close, volume FROM daily_bars_intraday
       WHERE dataset_id = ? AND dataset_version = ? AND ticker = ?`,
    )
    .get(identity.id, identity.version, ticker) as ProvisionalBarRow | undefined;
  if (row === undefined) return null;
  return {
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

/** Replaces `ticker`'s provisional bar outright — at most one row per ticker at any time (a fresh
 * fetch while the session is still open OVERWRITES whatever snapshot was there, never appends), so
 * this first clears any existing row(s) for the ticker before inserting the new one. Safe to call
 * repeatedly all day; each call is the new single source of truth. */
export function writeProvisionalBar(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
  bar: DailyBar,
  fetchedAt: string,
): void {
  store.db
    .prepare(
      'DELETE FROM daily_bars_intraday WHERE dataset_id = ? AND dataset_version = ? AND ticker = ?',
    )
    .run(identity.id, identity.version, ticker);
  store.db
    .prepare(
      `INSERT INTO daily_bars_intraday
         (dataset_id, dataset_version, ticker, date, open, high, low, close, volume, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      identity.id,
      identity.version,
      ticker,
      bar.date,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
      fetchedAt,
    );
}

/** Clears `ticker`'s provisional bar entirely — called once a real, final bar for the same date
 * has landed in `daily_bars` (see `scripts/fetchAndAppendBars.ts`), so a stale snapshot never
 * lingers alongside the now-authoritative real data. A no-op if there was nothing to clear. */
export function clearProvisionalBar(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
): void {
  store.db
    .prepare(
      'DELETE FROM daily_bars_intraday WHERE dataset_id = ? AND dataset_version = ? AND ticker = ?',
    )
    .run(identity.id, identity.version, ticker);
}

/** Every ticker with a currently-recorded provisional bar — used by a status/summary read (e.g.
 * the Jobs page) that wants to show "N tickers have a live snapshot" without querying one ticker
 * at a time. */
export function queryProvisionalTickers(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
): string[] {
  const rows = store.db
    .prepare(
      'SELECT DISTINCT ticker FROM daily_bars_intraday WHERE dataset_id = ? AND dataset_version = ?',
    )
    .all(identity.id, identity.version) as { ticker: string }[];
  return rows.map((row) => row.ticker);
}
