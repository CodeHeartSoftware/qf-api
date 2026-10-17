import type { CorporateAction } from '../schema/corporateAction.js';
import type { CalendarDate, DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import type { MarketDataStore } from './db.js';

interface DailyBarRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CorporateActionRow {
  ticker: string;
  type: CorporateAction['type'];
  date: string;
  announced_date: string | null;
  per_share: number | null;
  from_shares: number | null;
  to_shares: number | null;
  shares_repurchased: number | null;
  cash_per_share: number | null;
  reason: string | null;
}

/** Narrows a nullable column to its non-null value, or throws — used only for a column the SQL
 * `CHECK (type IN (...))` constraint (see `store/db.ts`'s schema) already guarantees is populated
 * for this row's `type`. A thrown error here would mean the stored row itself is inconsistent
 * with its own `type`, not a normal "maybe missing" case a type assertion would paper over. */
function requireColumn<T>(value: T | null, column: string, type: string): T {
  if (value === null) {
    throw new Error(
      `corporate_actions row of type "${type}" is missing required column "${column}"`,
    );
  }
  return value;
}

function rowToCorporateAction(row: CorporateActionRow): CorporateAction {
  const base = {
    ticker: row.ticker,
    date: row.date,
    ...(row.announced_date !== null ? { announcedDate: row.announced_date } : {}),
  };
  switch (row.type) {
    case 'CASH_DIVIDEND':
      return {
        ...base,
        type: 'CASH_DIVIDEND',
        perShare: requireColumn(row.per_share, 'per_share', row.type),
      };
    case 'STOCK_SPLIT':
      return {
        ...base,
        type: 'STOCK_SPLIT',
        fromShares: requireColumn(row.from_shares, 'from_shares', row.type),
        toShares: requireColumn(row.to_shares, 'to_shares', row.type),
      };
    case 'REVERSE_SPLIT':
      return {
        ...base,
        type: 'REVERSE_SPLIT',
        fromShares: requireColumn(row.from_shares, 'from_shares', row.type),
        toShares: requireColumn(row.to_shares, 'to_shares', row.type),
      };
    case 'BUYBACK':
      return {
        ...base,
        type: 'BUYBACK',
        sharesRepurchased: requireColumn(row.shares_repurchased, 'shares_repurchased', row.type),
      };
    case 'ACQUISITION':
      return {
        ...base,
        type: 'ACQUISITION',
        cashPerShare: requireColumn(row.cash_per_share, 'cash_per_share', row.type),
      };
    case 'DELISTING':
      return { ...base, type: 'DELISTING', reason: requireColumn(row.reason, 'reason', row.type) };
  }
}

/**
 * Every bar for `ticker` at or before `asOfDate`, oldest first, capped to the trailing
 * `maxDays` — the SQL-layer counterpart to `games/stock-market-4`'s `historicalBarsAsOf`, same
 * semantics exactly: a `date <= ?` predicate (never `LIMIT n OFFSET`/index-based), safe to query
 * against the FULL series including rows dated after `asOfDate`, because the cutoff is the date
 * value itself.
 */
export function queryBarsAsOf(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
  asOfDate: CalendarDate,
  maxDays: number,
): DailyBar[] {
  const rows = store.db
    .prepare(
      `SELECT date, open, high, low, close, volume FROM daily_bars
       WHERE dataset_id = ? AND dataset_version = ? AND ticker = ? AND date <= ?
       ORDER BY date ASC`,
    )
    .all(identity.id, identity.version, ticker, asOfDate) as unknown as DailyBarRow[];
  const bars = rows.map((row): DailyBar => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
  return maxDays >= bars.length ? bars : bars.slice(-maxDays);
}

/**
 * Every corporate action already public as of `asOfDate` for `ticker` (or every ticker, when
 * `ticker` is `null`) — the SQL-layer counterpart to `visibleCorporateActions`. The
 * `COALESCE(announced_date, date) <= ?` predicate is deliberately the BROADER of what any caller
 * downstream needs (some need `announcedDate ?? date <= asOfDate` for visibility,
 * `cumulativeSplitFactor`'s stricter `date <= asOfDate` for mechanical effect): this query only
 * guarantees a row dated/announced after `asOfDate` is never even returned, never that every
 * caller's own narrower filtering is redundant.
 */
export function queryCorporateActionsAsOf(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string | null,
  asOfDate: CalendarDate,
): CorporateAction[] {
  const rows = store.db
    .prepare(
      `SELECT ticker, type, date, announced_date, per_share, from_shares, to_shares,
              shares_repurchased, cash_per_share, reason
       FROM corporate_actions
       WHERE dataset_id = ? AND dataset_version = ?
         AND (? IS NULL OR ticker = ?)
         AND COALESCE(announced_date, date) <= ?
       ORDER BY date ASC`,
    )
    .all(
      identity.id,
      identity.version,
      ticker,
      ticker,
      asOfDate,
    ) as unknown as CorporateActionRow[];
  return rows.map(rowToCorporateAction);
}

/** Every ticker with at least one bar recorded for this dataset version — used to validate a
 * match's `marketDataUniverse` against the dataset it references (see `provider/provider.ts`). */
export function queryTickers(store: MarketDataStore, identity: MarketDatasetIdentity): string[] {
  const rows = store.db
    .prepare(
      'SELECT DISTINCT ticker FROM daily_bars WHERE dataset_id = ? AND dataset_version = ? ORDER BY ticker ASC',
    )
    .all(identity.id, identity.version) as unknown as { ticker: string }[];
  return rows.map((row) => row.ticker);
}

/** Every organizer-declared non-trading date for this dataset version (see
 * `games/stock-market-4`'s `config.tradingHolidays` / `market/calendar.ts`). */
export function queryTradingHolidays(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
): CalendarDate[] {
  const rows = store.db
    .prepare(
      'SELECT date FROM trading_holidays WHERE dataset_id = ? AND dataset_version = ? ORDER BY date ASC',
    )
    .all(identity.id, identity.version) as unknown as { date: string }[];
  return rows.map((row) => row.date);
}

/** The most recent date `ticker` has a published bar for in this dataset version, or `null` if it
 * has none at all — the SQL-layer counterpart to `provider/provider.ts`'s `latestKnownDate`. An
 * index-only lookup (`idx_daily_bars_asof` already covers `(dataset_id, dataset_version, ticker,
 * date)`), so this stays cheap even for a dataset with thousands of rows per ticker. */
export function queryLatestKnownDate(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
): CalendarDate | null {
  const row = store.db
    .prepare(
      `SELECT MAX(date) AS maxDate FROM daily_bars
       WHERE dataset_id = ? AND dataset_version = ? AND ticker = ?`,
    )
    .get(identity.id, identity.version, ticker) as { maxDate: string | null } | undefined;
  return row?.maxDate ?? null;
}

/** The latest date `ticker` has been POSITIVELY CONFIRMED to have no bar for, or `null` if never
 * checked — see `migrations/0009_ticker_checked_through_table.ts`'s doc comment for why this is a
 * distinct concept from `queryLatestKnownDate`. */
export function queryCheckedThroughDate(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  ticker: string,
): CalendarDate | null {
  const row = store.db
    .prepare(
      `SELECT checked_through_date FROM ticker_checked_through
       WHERE dataset_id = ? AND dataset_version = ? AND ticker = ?`,
    )
    .get(identity.id, identity.version, ticker) as { checked_through_date: string } | undefined;
  return row?.checked_through_date ?? null;
}

/** Whether `identity` has actually been published in `store` — the fail-closed check
 * `createSqliteMarketDataProvider` uses before handing out a provider for a dataset/version that
 * doesn't exist. */
export function datasetVersionExists(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
): boolean {
  const row = store.db
    .prepare('SELECT 1 FROM dataset_versions WHERE dataset_id = ? AND dataset_version = ?')
    .get(identity.id, identity.version);
  return row !== undefined;
}
