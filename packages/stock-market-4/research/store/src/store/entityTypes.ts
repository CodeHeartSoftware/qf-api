import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

export interface EntityType {
  type: string;
  addedAt: string;
}

interface EntityTypeRow {
  type: string;
  added_at: string;
}

/** A domain's registered entity-type taxonomy — see `migrations/0036_entity_types_table.ts`'s own
 * doc comment for why this is separate from the `type` values already recorded on actual
 * entities. */
export function listEntityTypes(store: ResearchStore, datasetId: string): EntityType[] {
  const rows = store.db
    .prepare('SELECT type, added_at FROM entity_types WHERE dataset_id = ? ORDER BY type ASC')
    .all(datasetId) as unknown as EntityTypeRow[];
  return rows.map((row) => ({ type: row.type, addedAt: row.added_at }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function findByType(existing: EntityType[], type: string): EntityType | undefined {
  return existing.find((t) => t.type.toUpperCase() === type.toUpperCase());
}

/** Renders the ONE migration statement that registers a new entity type for `datasetId`. Refuses
 * (`Result`) rather than emitting a doomed INSERT if the type is already registered (case
 * insensitively) — same posture as `renderAddEventTypeSql`. */
export function renderAddEntityTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  now: string,
): Result<string> {
  const trimmed = type.trim();
  if (trimmed === '') return err('type must be a non-empty string');

  const existing = listEntityTypes(store, datasetId);
  if (findByType(existing, trimmed) !== undefined) {
    return err(`entity type "${trimmed}" is already registered for this domain`);
  }

  return ok(
    'INSERT INTO entity_types (dataset_id, type, added_at) ' +
      `VALUES (${sqlString(datasetId)}, ${sqlString(trimmed)}, ${sqlString(now)});`,
  );
}

/** Renders the ONE migration statement that renames a registered entity type. Never touches any
 * entity already recorded with the old type string — see
 * `migrations/0036_entity_types_table.ts`'s own doc comment for why; this only relabels the
 * going-forward option a NEW or edited entity can be tagged with. */
export function renderRenameEntityTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  newType: string,
): Result<string> {
  const trimmedOld = type.trim();
  const trimmedNew = newType.trim();
  if (trimmedNew === '') return err('newType must be a non-empty string');

  const existing = listEntityTypes(store, datasetId);
  const match = findByType(existing, trimmedOld);
  if (match === undefined) {
    return err(`entity type "${trimmedOld}" is not registered for this domain`);
  }
  if (
    trimmedOld.toUpperCase() !== trimmedNew.toUpperCase() &&
    findByType(existing, trimmedNew) !== undefined
  ) {
    return err(`entity type "${trimmedNew}" is already registered for this domain`);
  }

  return ok(
    `UPDATE entity_types SET type = ${sqlString(trimmedNew)} ` +
      `WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}

/** Renders the ONE migration statement that de-registers an entity type. Never touches any entity
 * already recorded with this type string — it simply stops being an option for a NEW or edited
 * entity until (if ever) re-added. */
export function renderDeleteEntityTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
): Result<string> {
  const trimmed = type.trim();
  const existing = listEntityTypes(store, datasetId);
  const match = findByType(existing, trimmed);
  if (match === undefined) {
    return err(`entity type "${trimmed}" is not registered for this domain`);
  }

  return ok(
    `DELETE FROM entity_types WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}
