import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Registers "equity stake acquisition" as a relationship type for the "fusion" domain, generated
 * by `research-store/scripts/manageRelationshipTypes.ts` — never hand-edit this file; a
 * correction is always a NEW migration. */
export const migration0090RelationshipTypeAddEquityStakeAcquisition: Migration = {
  id: "research-store/0090_relationship_type_add_equity-stake-acquisition",
  sql: `
INSERT INTO relationship_types (dataset_id, type, added_at) VALUES ('dataset-fusion-2026-09', 'equity stake acquisition', '2026-09-24T22:15:01.543Z');
`,
};
