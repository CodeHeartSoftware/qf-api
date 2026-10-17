import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * Backfills `event_types` with every distinct `type` already used by an existing event, across
 * every domain — unlike `0010_fusion_tracked_tickers_seed.ts` (which needed company names from
 * outside this database), every value this needs already lives in the `events` table by this
 * point in migration history, so this is one generic `INSERT ... SELECT`, not hand-enumerated
 * per-domain literals. Going forward, a new event can only be tagged with an already-registered
 * type (the Add Event modal's dropdown), so `event_types` and `events.type` stay in sync from
 * here on without needing another backfill.
 */
export const migration0035EventTypesSeed: Migration = {
  id: 'research-store/0035_event_types_seed',
  sql: `
INSERT INTO event_types (dataset_id, type, added_at)
SELECT DISTINCT dataset_id, type, '2026-09-20T00:00:00Z' FROM events;
`,
};
