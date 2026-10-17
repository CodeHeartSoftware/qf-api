import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

export interface RelationshipType {
  type: string;
  addedAt: string;
  /** Which of the Quant tab's own pre-existing Exposure Map categories this type has been sorted
   * into — see `migrations/0041_relationship_types_category_column.ts`'s own doc comment. This
   * package doesn't enforce which strings are valid here (that's `apps/api`'s own
   * business rule); `undefined` means this type hasn't been sorted into one yet. */
  category?: string;
}

interface RelationshipTypeRow {
  type: string;
  added_at: string;
  category: string | null;
}

/** A domain's registered relationship-type taxonomy — see
 * `migrations/0038_relationship_types_table.ts`'s own doc comment for why this is separate from
 * the `type` values already recorded on actual relationships. */
export function listRelationshipTypes(store: ResearchStore, datasetId: string): RelationshipType[] {
  const rows = store.db
    .prepare(
      'SELECT type, added_at, category FROM relationship_types WHERE dataset_id = ? ORDER BY type ASC',
    )
    .all(datasetId) as unknown as RelationshipTypeRow[];
  return rows.map((row) => ({
    type: row.type,
    addedAt: row.added_at,
    ...(row.category !== null ? { category: row.category } : {}),
  }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function findByType(existing: RelationshipType[], type: string): RelationshipType | undefined {
  return existing.find((t) => t.type.toUpperCase() === type.toUpperCase());
}

/** Renders the ONE migration statement that registers a new relationship type for `datasetId`.
 * Refuses (`Result`) rather than emitting a doomed INSERT if the type is already registered (case
 * insensitively) — same posture as `renderAddEntityTypeSql`. */
export function renderAddRelationshipTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  now: string,
): Result<string> {
  const trimmed = type.trim();
  if (trimmed === '') return err('type must be a non-empty string');

  const existing = listRelationshipTypes(store, datasetId);
  if (findByType(existing, trimmed) !== undefined) {
    return err(`relationship type "${trimmed}" is already registered for this domain`);
  }

  return ok(
    'INSERT INTO relationship_types (dataset_id, type, added_at) ' +
      `VALUES (${sqlString(datasetId)}, ${sqlString(trimmed)}, ${sqlString(now)});`,
  );
}

/** Renders the ONE migration statement that renames a registered relationship type. Never touches
 * any relationship already recorded with the old type string — see
 * `migrations/0038_relationship_types_table.ts`'s own doc comment for why; this only relabels the
 * going-forward option a NEW relationship can be tagged with. */
export function renderRenameRelationshipTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  newType: string,
): Result<string> {
  const trimmedOld = type.trim();
  const trimmedNew = newType.trim();
  if (trimmedNew === '') return err('newType must be a non-empty string');

  const existing = listRelationshipTypes(store, datasetId);
  const match = findByType(existing, trimmedOld);
  if (match === undefined) {
    return err(`relationship type "${trimmedOld}" is not registered for this domain`);
  }
  if (
    trimmedOld.toUpperCase() !== trimmedNew.toUpperCase() &&
    findByType(existing, trimmedNew) !== undefined
  ) {
    return err(`relationship type "${trimmedNew}" is already registered for this domain`);
  }

  return ok(
    `UPDATE relationship_types SET type = ${sqlString(trimmedNew)} ` +
      `WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}

/** Renders the ONE migration statement that de-registers a relationship type. Never touches any
 * relationship already recorded with this type string — it simply stops being an option for a
 * NEW relationship until (if ever) re-added. */
export function renderDeleteRelationshipTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
): Result<string> {
  const trimmed = type.trim();
  const existing = listRelationshipTypes(store, datasetId);
  const match = findByType(existing, trimmed);
  if (match === undefined) {
    return err(`relationship type "${trimmed}" is not registered for this domain`);
  }

  return ok(
    `DELETE FROM relationship_types WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}

/** Renders the ONE migration statement that sorts a registered relationship type into a category
 * (or, with `category: null`, un-sorts it) — see
 * `migrations/0041_relationship_types_category_column.ts`'s own doc comment for what a category
 * is. Never touches any relationship already recorded with this type, and never touches
 * `@quant-fusion/quant-sdk-js`'s own exposure computation — purely UI categorization metadata.
 * Accepts any non-empty string here; the fixed set of valid category names is enforced by
 * `apps/api` before this is ever called (see this field's own doc comment on
 * `RelationshipType`). */
export function renderSetRelationshipTypeCategorySql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  category: string | null,
): Result<string> {
  const trimmed = type.trim();
  const existing = listRelationshipTypes(store, datasetId);
  const match = findByType(existing, trimmed);
  if (match === undefined) {
    return err(`relationship type "${trimmed}" is not registered for this domain`);
  }
  const trimmedCategory = category?.trim();
  if (category !== null && (trimmedCategory === undefined || trimmedCategory === '')) {
    return err('category, when given, must be a non-empty string');
  }

  return ok(
    `UPDATE relationship_types SET category = ${trimmedCategory !== undefined ? sqlString(trimmedCategory) : 'NULL'} ` +
      `WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}
