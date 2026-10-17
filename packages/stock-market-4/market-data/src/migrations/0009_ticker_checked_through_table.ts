import type { Migration } from '@quant-fusion/sqlite-migrations';

/** A per-ticker watermark, separate from `daily_bars` itself: the latest date a fetch has
 * POSITIVELY CONFIRMED has no bar for this ticker (as opposed to "we just haven't checked yet" or
 * "the bar hasn't been published yet"). Lets a forward match's round-advancement cutoff
 * (`games/stock-market-4`'s `forwardShadowCutoffDateFor`) distinguish a real, confirmed gap in a
 * ticker's OWN trading calendar (e.g. a Japanese market holiday) from ordinary ingestion lag —
 * without this table both look identical (`daily_bars` simply has no row), which is what stalled
 * a whole match's other tickers behind one ticker's holiday. See
 * `scripts/fetchAndAppendBars.ts`'s own doc comment for how this gets populated and why it's
 * deliberately conservative (never trusts a same-day absence, only a date strictly in the past
 * relative to when the check ran). `checked_through_date` only ever advances (see
 * `store/sqlGen.ts`'s `renderCheckedThroughSql` — its `ON CONFLICT ... WHERE` guard refuses to
 * regress it), which is why plain `INSERT ... ON CONFLICT DO UPDATE` in a migration is safe to run
 * repeatedly across many later migrations, unlike `daily_bars`' append-only rows. */
export const migration0009TickerCheckedThroughTable: Migration = {
  id: 'market-data/0009_ticker_checked_through_table',
  sql: `
CREATE TABLE IF NOT EXISTS ticker_checked_through (
  dataset_id           TEXT NOT NULL,
  dataset_version      TEXT NOT NULL,
  ticker               TEXT NOT NULL,
  checked_through_date TEXT NOT NULL,
  checked_at           TEXT NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, ticker),
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
`,
};
