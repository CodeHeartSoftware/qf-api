import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

export interface EventType {
  type: string;
  addedAt: string;
}

interface EventTypeRow {
  type: string;
  added_at: string;
}

/** A domain's registered event-type taxonomy — see `migrations/0034_event_types_table.ts`'s own
 * doc comment for why this is separate from the `type` values already recorded on actual events. */
export function listEventTypes(store: ResearchStore, datasetId: string): EventType[] {
  const rows = store.db
    .prepare('SELECT type, added_at FROM event_types WHERE dataset_id = ? ORDER BY type ASC')
    .all(datasetId) as unknown as EventTypeRow[];
  return rows.map((row) => ({ type: row.type, addedAt: row.added_at }));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function findByType(existing: EventType[], type: string): EventType | undefined {
  return existing.find((t) => t.type.toUpperCase() === type.toUpperCase());
}

/** Renders the ONE migration statement that registers a new event type for `datasetId`. Refuses
 * (`Result`) rather than emitting a doomed INSERT if the type is already registered (case
 * insensitively) — same posture as `renderAddTrackedTickerSql`. */
export function renderAddEventTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  now: string,
): Result<string> {
  const trimmed = type.trim();
  if (trimmed === '') return err('type must be a non-empty string');

  const existing = listEventTypes(store, datasetId);
  if (findByType(existing, trimmed) !== undefined) {
    return err(`event type "${trimmed}" is already registered for this domain`);
  }

  return ok(
    'INSERT INTO event_types (dataset_id, type, added_at) ' +
      `VALUES (${sqlString(datasetId)}, ${sqlString(trimmed)}, ${sqlString(now)});`,
  );
}

/** Renders the ONE migration statement that renames a registered event type. Never touches any
 * event already recorded with the old type string — see `migrations/0034_event_types_table.ts`'s
 * own doc comment for why; this only relabels the going-forward option a NEW event can be tagged
 * with. */
export function renderRenameEventTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
  newType: string,
): Result<string> {
  const trimmedOld = type.trim();
  const trimmedNew = newType.trim();
  if (trimmedNew === '') return err('newType must be a non-empty string');

  const existing = listEventTypes(store, datasetId);
  const match = findByType(existing, trimmedOld);
  if (match === undefined) {
    return err(`event type "${trimmedOld}" is not registered for this domain`);
  }
  if (
    trimmedOld.toUpperCase() !== trimmedNew.toUpperCase() &&
    findByType(existing, trimmedNew) !== undefined
  ) {
    return err(`event type "${trimmedNew}" is already registered for this domain`);
  }

  return ok(
    `UPDATE event_types SET type = ${sqlString(trimmedNew)} ` +
      `WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}

/** Renders the ONE migration statement that de-registers an event type. Never touches any event
 * already recorded with this type string — it simply stops being an option for a NEW event until
 * (if ever) re-added. */
export function renderDeleteEventTypeSql(
  store: ResearchStore,
  datasetId: string,
  type: string,
): Result<string> {
  const trimmed = type.trim();
  const existing = listEventTypes(store, datasetId);
  const match = findByType(existing, trimmed);
  if (match === undefined) {
    return err(`event type "${trimmed}" is not registered for this domain`);
  }

  return ok(
    `DELETE FROM event_types WHERE dataset_id = ${sqlString(datasetId)} AND type = ${sqlString(match.type)};`,
  );
}
