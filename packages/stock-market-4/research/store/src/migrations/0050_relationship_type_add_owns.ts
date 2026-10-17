import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Registers "owns" as a relationship type for the "fusion" domain, generated
 * by `research-store/scripts/manageRelationshipTypes.ts` — never hand-edit this file; a
 * correction is always a NEW migration. */
export const migration0050RelationshipTypeAddOwns: Migration = {
  id: "research-store/0050_relationship_type_add_owns",
  sql: `
INSERT INTO relationship_types (dataset_id, type, added_at) VALUES ('dataset-fusion-2026-09', 'owns', '2026-09-22T03:03:51.270Z');
`,
};
