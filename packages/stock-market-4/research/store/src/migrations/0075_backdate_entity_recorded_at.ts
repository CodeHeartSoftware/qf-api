import type { Migration } from '@quant-fusion/sqlite-migrations';

/** A hand-written CORRECTION to the "dataset-fusion-2026-09" dataset (version -> "2026.09+update.58"):
 * moves `recordedAt` EARLIER, to 2026-01-01, for seven entities first entered in Jul-Sep 2026 that
 * were real, public organizations/materials well before then (General Fusion, Syntec Optics,
 * Freemelt, Tokamak Energy, the U.S. Department of War, tungsten powder, 2G HTS tape). Their late
 * entry dates were an artifact of when this dataset happened to record them, and made them
 * invisible to any point-in-time replay before that date — including three tracked securities
 * (GFUZ, OPTX, FREEM) across the whole Jan-Jun 2026 market-data window (dataset v4).
 *
 * `applyResearchUpdate.ts` deliberately refuses to edit `recordedAt`, because moving it LATER could
 * retroactively invalidate a temporal-integrity check another record already passed; moving it
 * EARLIER cannot, so this one-off correction is written by hand. Only rows still dated after
 * 2026-01-01 are touched, and every other entity field is preserved via `json_set`. */
export const migration0075BackdateEntityRecordedAt: Migration = {
  id: "research-store/0075_backdate_entity_recorded_at",
  sql: `
UPDATE entities
SET recorded_at = '2026-01-01T00:00:00Z',
    data = json_set(data, '$.recordedAt', '2026-01-01T00:00:00Z')
WHERE dataset_id = 'dataset-fusion-2026-09'
  AND recorded_at > '2026-01-01T00:00:00Z'
  AND id IN (
    'entity-general-fusion',
    'entity-syntec-optics',
    'entity-freemelt',
    'entity-tokamak-energy',
    'entity-department-of-war',
    'entity-tungsten-powder',
    'entity-2g-hts-tape'
  );
UPDATE research_datasets SET version = '2026.09+update.58', updated_at = '2026-09-22T00:00:00Z' WHERE dataset_id = 'dataset-fusion-2026-09';
`,
};
