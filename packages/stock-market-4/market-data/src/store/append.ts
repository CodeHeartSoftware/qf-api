import type { CalendarDate, DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import { err, ok, type Result } from '../result.js';
import type { MarketDataStore } from './db.js';
import { datasetVersionExists, queryLatestKnownDate } from './queries.js';

/**
 * Everything one `appendBars` call adds — keyed by ticker, same shape as `DatasetVersionInput`'s
 * own `bars` field.
 */
export interface AppendBarsInput {
  bars: Record<string, readonly DailyBar[]>;
}

/**
 * Grows an ALREADY-published `(id, version)` with rows for dates strictly AFTER each ticker's
 * current `latestKnownDate()` in that version — the incremental-growth counterpart to
 * `publishDatasetVersion`'s one-shot, all-at-once publish (roadmap Phase 3: a forward/live match's
 * dataset needs to grow day by day while its `config.marketDataset.version` stays pinned for the
 * whole match's life, rather than publishing a new version per day).
 *
 * Deliberately never allows backfilling a date at or before what's already known for a ticker in
 * this version — that would violate ADR-0010's "a version's rows are never mutated or deleted"
 * invariant only in spirit, not in the letter (no EXISTING row would be touched), but it would
 * still silently change what a match that already played through an earlier date would see if
 * re-derived later (a previously-genuine data gap would retroactively fill in). A real correction
 * to already-published data still must go through a new dataset version, exactly as before; this
 * function only ever extends the frontier forward. Fails closed (a `Result`, matching every other
 * write in this package) if `identity` was never published at all — `appendBars` grows an existing
 * version, it never creates one (call `publishDatasetVersion` first, even with empty `bars`, to
 * establish it).
 *
 * Transactional and all-or-nothing, same as `publishDatasetVersion`: one violating bar anywhere in
 * the batch rolls back every row this call would otherwise have inserted, so a caller never has to
 * reason about a partially-applied append.
 */
export function appendBars(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
  input: AppendBarsInput,
): Result<void> {
  if (!datasetVersionExists(store, identity)) {
    return err(
      `cannot append to dataset "${identity.id}" version "${identity.version}" — it has never ` +
        `been published; call publishDatasetVersion first`,
    );
  }

  const { db } = store;
  db.exec('BEGIN');
  try {
    const insertBar = db.prepare(
      `INSERT INTO daily_bars (dataset_id, dataset_version, ticker, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [ticker, bars] of Object.entries(input.bars)) {
      let cursor: CalendarDate | null = queryLatestKnownDate(store, identity, ticker);
      for (const bar of bars) {
        if (cursor !== null && bar.date <= cursor) {
          throw new Error(
            `"${ticker}" is already known through ${cursor} in dataset "${identity.id}" version ` +
              `"${identity.version}" — cannot append a bar dated ${bar.date} at or before that; ` +
              `publish a corrected NEW dataset version instead of backfilling`,
          );
        }
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
        cursor = bar.date;
      }
    }
    db.exec('COMMIT');
    return ok(undefined);
  } catch (error) {
    db.exec('ROLLBACK');
    return err(
      `failed to append bars to dataset "${identity.id}" version "${identity.version}": ${String(error)}`,
    );
  }
}
