import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * A domain's news/research watchlist — which ticker symbols its News Feed tab fetches Google News
 * for (see `apps/stock-market-4-api`'s `routes/news.ts`). Deliberately NOT part of the
 * `ResearchDataset` schema (`@thunderdome/research-core`'s public, domain-agnostic type) — a
 * watchlist is app-level configuration ("what do I want to read news about"), not research
 * content, and unlike entities/relationships/etc. it has no point-in-time visibility semantics: a
 * ticker is either currently tracked or it isn't, so add/remove are direct row mutations (still
 * each its own migration, per this package's usual "never edit the past" rule) rather than an
 * append-only history.
 *
 * `company_name` is the search term used to query Google News, not necessarily this ticker's
 * research-core entity name — a matching entity is resolved by name at the point a headline is
 * actually turned into evidence (see `ResearchUpdateModal.tsx`), not stored here, so tracking a
 * ticker never requires a research entity for it to already exist.
 */
export const migration0009TrackedTickersTable: Migration = {
  id: 'research-store/0009_tracked_tickers_table',
  sql: `
CREATE TABLE IF NOT EXISTS tracked_tickers (
  dataset_id   TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  company_name TEXT NOT NULL,
  added_at     TEXT NOT NULL,
  PRIMARY KEY (dataset_id, ticker),
  FOREIGN KEY (dataset_id) REFERENCES research_datasets (dataset_id)
);
`,
};
