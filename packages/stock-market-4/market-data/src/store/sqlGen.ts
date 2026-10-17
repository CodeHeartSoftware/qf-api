import type { CorporateAction } from '../schema/corporateAction.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import { err, ok, type Result } from '../result.js';
import type { MarketDataStore } from './db.js';
import { datasetVersionExists, queryLatestKnownDate } from './queries.js';
import type { DatasetVersionInput } from './ingest.js';
import type { AppendBarsInput } from './append.js';

/**
 * Renders migration-file-ready, literal SQL for this package's writes — the same role
 * `@quant-fusion/research-store`'s `sqlGen.ts` plays for research content (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). A `Migration.sql` string
 * (`@quant-fusion/sqlite-migrations`) is executed verbatim via `db.exec`, not through a prepared
 * statement, so values must be inlined as SQL literals.
 */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringOrNull(value: string | null | undefined): string {
  return value === null || value === undefined ? 'NULL' : sqlString(value);
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot render non-finite number ${String(value)} as a SQL literal`);
  }
  return String(value);
}

function sqlNumberOrNull(value: number | null | undefined): string {
  return value === null || value === undefined ? 'NULL' : sqlNumber(value);
}

function corporateActionInsertSql(
  identity: MarketDatasetIdentity,
  action: CorporateAction,
): string {
  const perShare = action.type === 'CASH_DIVIDEND' ? action.perShare : null;
  const fromShares =
    action.type === 'STOCK_SPLIT' || action.type === 'REVERSE_SPLIT' ? action.fromShares : null;
  const toShares =
    action.type === 'STOCK_SPLIT' || action.type === 'REVERSE_SPLIT' ? action.toShares : null;
  const sharesRepurchased = action.type === 'BUYBACK' ? action.sharesRepurchased : null;
  const cashPerShare = action.type === 'ACQUISITION' ? action.cashPerShare : null;
  const reason = action.type === 'DELISTING' ? action.reason : null;

  const columns = [
    'dataset_id',
    'dataset_version',
    'ticker',
    'type',
    'date',
    'announced_date',
    'per_share',
    'from_shares',
    'to_shares',
    'shares_repurchased',
    'cash_per_share',
    'reason',
  ];
  const values = [
    sqlString(identity.id),
    sqlString(identity.version),
    sqlString(action.ticker),
    sqlString(action.type),
    sqlString(action.date),
    sqlStringOrNull(action.announcedDate),
    sqlNumberOrNull(perShare),
    sqlNumberOrNull(fromShares),
    sqlNumberOrNull(toShares),
    sqlNumberOrNull(sharesRepurchased),
    sqlNumberOrNull(cashPerShare),
    sqlStringOrNull(reason),
  ];
  return `INSERT INTO corporate_actions (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

/**
 * Renders the migration that publishes a brand-new `(id, version)` — the migration-time
 * equivalent of `publishDatasetVersion` (`store/ingest.ts`). Deliberately does NOT check whether
 * `identity` already exists: `dataset_versions`' own `PRIMARY KEY (dataset_id, dataset_version)`
 * already refuses a duplicate publish at migration-APPLY time (caught and rolled back by
 * `applyMigrations`), the same "let the constraint do the checking" restraint
 * `@quant-fusion/research-store`'s `renderSeedSql` takes for its own dataset id.
 */
export function renderPublishDatasetVersionSql(
  identity: MarketDatasetIdentity,
  input: DatasetVersionInput,
  createdAt: string,
): string {
  const statements: string[] = [
    'INSERT INTO dataset_versions (dataset_id, dataset_version, created_at, description) ' +
      `VALUES (${sqlString(identity.id)}, ${sqlString(identity.version)}, ${sqlString(createdAt)}, ` +
      `${sqlStringOrNull(input.description)});`,
  ];

  for (const [ticker, bars] of Object.entries(input.bars)) {
    for (const bar of bars) {
      statements.push(
        'INSERT INTO daily_bars (dataset_id, dataset_version, ticker, date, open, high, low, close, volume) ' +
          `VALUES (${sqlString(identity.id)}, ${sqlString(identity.version)}, ${sqlString(ticker)}, ` +
          `${sqlString(bar.date)}, ${sqlNumber(bar.open)}, ${sqlNumber(bar.high)}, ${sqlNumber(bar.low)}, ` +
          `${sqlNumber(bar.close)}, ${sqlNumber(bar.volume)});`,
      );
    }
  }

  for (const action of input.corporateActions ?? []) {
    statements.push(corporateActionInsertSql(identity, action));
  }

  for (const date of input.tradingHolidays ?? []) {
    statements.push(
      'INSERT INTO trading_holidays (dataset_id, dataset_version, date) ' +
        `VALUES (${sqlString(identity.id)}, ${sqlString(identity.version)}, ${sqlString(date)});`,
    );
  }

  return statements.join('\n');
}

/**
 * Renders the migration that grows an ALREADY-published `(id, version)` with new bars — the
 * migration-time equivalent of `appendBars` (`store/append.ts`), including its same "never
 * backfill a ticker's frontier" refusal. Needs a real `store` (unlike `renderPublishDatasetVersionSql`)
 * because that refusal depends on each ticker's CURRENT latest known date, which no SQL
 * constraint alone can express — `store` should be built by replaying every existing migration
 * (see this package's ingestion scripts), so the check is against the true current state.
 */
export function renderAppendBarsSql(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  input: AppendBarsInput,
): Result<string> {
  if (!datasetVersionExists(store, identity)) {
    return err(
      `cannot append to dataset "${identity.id}" version "${identity.version}" — it has never ` +
        `been published; publish it first`,
    );
  }

  const statements: string[] = [];
  for (const [ticker, bars] of Object.entries(input.bars)) {
    let cursor = queryLatestKnownDate(store, identity, ticker);
    for (const bar of bars) {
      if (cursor !== null && bar.date <= cursor) {
        return err(
          `"${ticker}" is already known through ${cursor} in dataset "${identity.id}" version ` +
            `"${identity.version}" — cannot append a bar dated ${bar.date} at or before that; ` +
            `publish a corrected NEW dataset version instead of backfilling`,
        );
      }
      statements.push(
        'INSERT INTO daily_bars (dataset_id, dataset_version, ticker, date, open, high, low, close, volume) ' +
          `VALUES (${sqlString(identity.id)}, ${sqlString(identity.version)}, ${sqlString(ticker)}, ` +
          `${sqlString(bar.date)}, ${sqlNumber(bar.open)}, ${sqlNumber(bar.high)}, ${sqlNumber(bar.low)}, ` +
          `${sqlNumber(bar.close)}, ${sqlNumber(bar.volume)});`,
      );
      cursor = bar.date;
    }
  }

  return ok(statements.join('\n'));
}

/** One confirmed-checked-through watermark to render, per ticker — see `queryCheckedThroughDate`'s
 * doc comment for what this represents. */
export interface CheckedThroughUpdate {
  ticker: string;
  checkedThroughDate: string;
  checkedAt: string;
}

/**
 * Renders the migration that advances `ticker_checked_through`'s watermarks — the migration-time
 * counterpart to `queryCheckedThroughDate`. The `ON CONFLICT ... WHERE` guard makes each statement
 * safe to apply even if a LATER migration's watermark somehow ends up earlier than an EARLIER
 * one's (it simply becomes a no-op), so this never needs the same "read current state first"
 * validation `renderAppendBarsSql` does for `daily_bars`.
 */
export function renderCheckedThroughSql(
  identity: MarketDatasetIdentity,
  updates: readonly CheckedThroughUpdate[],
): string {
  return updates
    .map(
      (update) =>
        'INSERT INTO ticker_checked_through ' +
        '(dataset_id, dataset_version, ticker, checked_through_date, checked_at) VALUES ' +
        `(${sqlString(identity.id)}, ${sqlString(identity.version)}, ${sqlString(update.ticker)}, ` +
        `${sqlString(update.checkedThroughDate)}, ${sqlString(update.checkedAt)}) ` +
        'ON CONFLICT (dataset_id, dataset_version, ticker) DO UPDATE SET ' +
        'checked_through_date = excluded.checked_through_date, checked_at = excluded.checked_at ' +
        'WHERE excluded.checked_through_date > ticker_checked_through.checked_through_date;',
    )
    .join('\n');
}
