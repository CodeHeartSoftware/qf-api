import type { CorporateAction } from '../schema/corporateAction.js';
import type { CalendarDate, DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import { err, ok, type Result } from '../result.js';
import type { MarketDataStore } from './db.js';

/**
 * Everything one published dataset version needs to record. `bars` is keyed by ticker, matching
 * `games/stock-market-4`'s own `config.historicalPrices` shape.
 */
export interface DatasetVersionInput {
  description?: string;
  bars: Record<string, readonly DailyBar[]>;
  corporateActions?: readonly CorporateAction[];
  tradingHolidays?: readonly CalendarDate[];
}

/**
 * Publishes a NEW, complete `(id, version)` — every row for this version is written here, in one
 * call, and this version's rows are never touched again by any later call (see
 * `dataset/identity.ts`'s doc comment on why versions are immutable). Fails, rather than
 * overwriting, if `identity` already exists: a correction must publish a new version, never
 * mutate an existing one — the whole point of keeping every historical competition reproducible
 * against the exact dataset it ran against.
 */
export function publishDatasetVersion(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  input: DatasetVersionInput,
): Result<void> {
  const { db } = store;
  const existing = db
    .prepare('SELECT 1 FROM dataset_versions WHERE dataset_id = ? AND dataset_version = ?')
    .get(identity.id, identity.version);
  if (existing !== undefined) {
    return err(
      `dataset "${identity.id}" version "${identity.version}" already exists — publish a new version instead of overwriting one`,
    );
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO dataset_versions (dataset_id, dataset_version, created_at, description) VALUES (?, ?, ?, ?)',
    ).run(identity.id, identity.version, new Date().toISOString(), input.description ?? null);

    const insertBar = db.prepare(
      `INSERT INTO daily_bars (dataset_id, dataset_version, ticker, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [ticker, bars] of Object.entries(input.bars)) {
      for (const bar of bars) {
        insertBar.run(
          identity.id,
          identity.version,
          ticker,
          bar.date,
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume,
        );
      }
    }

    const insertAction = db.prepare(
      `INSERT INTO corporate_actions
         (dataset_id, dataset_version, ticker, type, date, announced_date,
          per_share, from_shares, to_shares, shares_repurchased, cash_per_share, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const action of input.corporateActions ?? []) {
      insertAction.run(
        identity.id,
        identity.version,
        action.ticker,
        action.type,
        action.date,
        action.announcedDate ?? null,
        action.type === 'CASH_DIVIDEND' ? action.perShare : null,
        action.type === 'STOCK_SPLIT' || action.type === 'REVERSE_SPLIT' ? action.fromShares : null,
        action.type === 'STOCK_SPLIT' || action.type === 'REVERSE_SPLIT' ? action.toShares : null,
        action.type === 'BUYBACK' ? action.sharesRepurchased : null,
        action.type === 'ACQUISITION' ? action.cashPerShare : null,
        action.type === 'DELISTING' ? action.reason : null,
      );
    }

    const insertHoliday = db.prepare(
      'INSERT INTO trading_holidays (dataset_id, dataset_version, date) VALUES (?, ?, ?)',
    );
    for (const date of input.tradingHolidays ?? []) {
      insertHoliday.run(identity.id, identity.version, date);
    }

    db.exec('COMMIT');
    return ok(undefined);
  } catch (error) {
    db.exec('ROLLBACK');
    return err(
      `failed to publish dataset "${identity.id}" version "${identity.version}": ${String(error)}`,
    );
  }
}
