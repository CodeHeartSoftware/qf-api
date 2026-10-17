import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Seeds the fusion domain's watchlist with the 11 real tracked securities it was already
 * (implicitly, via a hardcoded `@thunderdome/fusion-universe` import) fetching news for before
 * `tracked_tickers` existed — carrying REAL, already-established ticker/company-name pairs into
 * the new generic table, not inventing anything. Going forward, growing/shrinking this list is a
 * user action (`scripts/manageTrackedTickers.ts`, or the News Feed tab's own ticker management
 * UI), not a hardcoded constant.
 */
export const migration0010FusionTrackedTickersSeed: Migration = {
  id: 'research-store/0010_fusion_tracked_tickers_seed',
  sql: `
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'ELMT', 'ELMT', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'FURUKAWA', 'Furukawa Electric', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'VITZRONEXTECH', 'Vitzro Nextech', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'ALM', 'Almonty Industries', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'FREEM', 'Freemelt', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'OPTX', 'Syntec Optics', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'GFUZ', 'General Fusion', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'FUJIKURA', 'Fujikura Ltd.', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'SUMITOMO', 'Sumitomo Electric', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'KMT', 'Kennametal', '2026-09-19T00:00:00Z');
INSERT INTO tracked_tickers (dataset_id, ticker, company_name, added_at) VALUES ('dataset-fusion-2026-09', 'AMSC', 'American Superconductor', '2026-09-19T00:00:00Z');
`,
};
