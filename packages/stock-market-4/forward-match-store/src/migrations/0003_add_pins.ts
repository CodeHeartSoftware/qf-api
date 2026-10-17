import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Adds `pins` — what a forward match was pinned to at creation (each bot's build-input hash and
 * image id, the config hash, the market dataset) — so a later run can refuse to resume on code
 * that has since changed. JSON text; NULL for every match created before pinning existed. */
export const migration0003AddPins: Migration = {
  id: 'forward-match-store/0003_add_pins',
  sql: `ALTER TABLE forward_matches ADD COLUMN pins TEXT;`,
};
