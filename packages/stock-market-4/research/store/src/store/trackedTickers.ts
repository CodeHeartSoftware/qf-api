import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

export interface TrackedTicker {
  ticker: string;
  companyName: string;
  addedAt: string;
}

interface TrackedTickerRow {
  ticker: string;
  company_name: string;
  added_at: string;
}

/** A domain's news watchlist — see `migrations/0009_tracked_tickers_table.ts`'s own doc comment
 * for why this is separate from `getResearchDataset`'s reconstructed `ResearchDataset`. */
export function listTrackedTickers(store: ResearchStore, datasetId: string): TrackedTicker[] {
  const rows = store.db
    .prepare(
      'SELECT ticker, company_name, added_at FROM tracked_tickers WHERE dataset_id = ? ORDER BY added_at ASC',
    )
    .all(datasetId) as unknown as TrackedTickerRow[];
  return rows.map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name,
    addedAt: row.added_at,
  }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Renders the ONE migration statement that adds a ticker to `datasetId`'s watchlist. Refuses
 * (`Result`) rather than emitting a doomed INSERT if the ticker is already tracked — the SQL
 * itself would also fail on the table's primary key, but checking here gives a clean error
 * message instead of a raw SQLite constraint failure. */
export function renderAddTrackedTickerSql(
  store: ResearchStore,
  datasetId: string,
  ticker: string,
  companyName: string,
  now: string,
): Result<string> {
  const trimmedTicker = ticker.trim();
  const trimmedName = companyName.trim();
  if (trimmedTicker === '') return err('ticker must be a non-empty string');
  if (trimmedName === '') return err('companyName must be a non-empty string');

  const existing = listTrackedTickers(store, datasetId);
  if (existing.some((t) => t.ticker.toUpperCase() === trimmedTicker.toUpperCase())) {
    return err(`ticker "${trimmedTicker}" is already tracked for this domain`);
  }

  return ok(
    'INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) ' +
      `VALUES (${sqlString(datasetId)}, ${sqlString(trimmedTicker)}, ${sqlString(trimmedName)}, ${sqlString(now)});`,
  );
}

/** Renders the ONE migration statement that removes a ticker from `datasetId`'s watchlist.
 * Removing a ticker never touches any research entity/evidence already citing it — a watchlist
 * entry is just "fetch news for this," not the research content itself (see this file's own
 * table's doc comment). */
export function renderRemoveTrackedTickerSql(
  store: ResearchStore,
  datasetId: string,
  ticker: string,
): Result<string> {
  const trimmedTicker = ticker.trim();
  const existing = listTrackedTickers(store, datasetId);
  const match = existing.find((t) => t.ticker.toUpperCase() === trimmedTicker.toUpperCase());
  if (match === undefined) {
    return err(`ticker "${trimmedTicker}" is not currently tracked for this domain`);
  }

  return ok(
    `DELETE FROM tracked_tickers WHERE dataset_id = ${sqlString(datasetId)} AND ticker = ${sqlString(match.ticker)};`,
  );
}
