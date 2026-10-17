import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type {
  ResearchAssertion,
  ResearchAssumption,
  ResearchEntity,
  ResearchEvent,
  ResearchHypothesis,
  ResearchModel,
  ResearchQuestion,
  ResearchRelationship,
  ResearchScenario,
  ResearchVariable,
  Evidence,
} from '@quant-fusion/research-core';

/**
 * Every `ResearchDataset` collection is stored the same way: one row per item, keyed by
 * `(dataset_id, id)`, a handful of extra columns worth indexing/filtering on, and the item's full
 * JSON in `data` (the read path's actual source of truth — see `migrations/0001_init.ts`'s doc
 * comment for why). This config drives both `sqlGen.ts` (rendering literal INSERT statements for
 * migration files) and `read.ts` (selecting rows back out) so the 11 collections don't each
 * hand-roll their own SQL.
 */
export interface CollectionConfig<T extends { id: string }> {
  readonly table: string;
  readonly extraColumns: readonly string[];
  // Every extra column across all 11 collections happens to be a plain string (a type/status
  // discriminator, an id reference, or an ISO timestamp) — narrower than `node:sqlite`'s general
  // `SQLInputValue`, but exact for what these tables actually need.
  readonly extraValues: (item: T) => readonly string[];
}

export const ENTITIES: CollectionConfig<ResearchEntity> = {
  table: 'entities',
  extraColumns: ['type', 'name', 'recorded_at'],
  extraValues: (item) => [item.type, item.name, item.recordedAt],
};

export const RELATIONSHIPS: CollectionConfig<ResearchRelationship> = {
  table: 'relationships',
  extraColumns: ['type', 'from_entity_id', 'to_entity_id'],
  extraValues: (item) => [item.type, item.fromEntityId, item.toEntityId],
};

export const EVIDENCE: CollectionConfig<Evidence> = {
  table: 'evidence',
  extraColumns: ['observed_at'],
  extraValues: (item) => [item.observedAt],
};

export const ASSERTIONS: CollectionConfig<ResearchAssertion> = {
  table: 'assertions',
  extraColumns: ['status', 'created_at'],
  extraValues: (item) => [item.status, item.createdAt],
};

export const HYPOTHESES: CollectionConfig<ResearchHypothesis> = {
  table: 'hypotheses',
  extraColumns: ['name', 'status', 'created_at'],
  extraValues: (item) => [item.name, item.status, item.createdAt],
};

export const ASSUMPTIONS: CollectionConfig<ResearchAssumption> = {
  table: 'assumptions',
  extraColumns: ['name', 'recorded_at'],
  extraValues: (item) => [item.name, item.recordedAt],
};

export const VARIABLES: CollectionConfig<ResearchVariable> = {
  table: 'variables',
  extraColumns: ['name', 'origin', 'recorded_at'],
  extraValues: (item) => [item.name, item.origin, item.recordedAt],
};

export const MODELS: CollectionConfig<ResearchModel> = {
  table: 'models',
  extraColumns: ['name', 'created_at'],
  extraValues: (item) => [item.name, item.createdAt],
};

export const SCENARIOS: CollectionConfig<ResearchScenario> = {
  table: 'scenarios',
  extraColumns: ['name', 'recorded_at'],
  extraValues: (item) => [item.name, item.recordedAt],
};

export const EVENTS: CollectionConfig<ResearchEvent> = {
  table: 'events',
  extraColumns: ['type', 'timestamp'],
  extraValues: (item) => [item.type, item.timestamp],
};

export const QUESTIONS: CollectionConfig<ResearchQuestion> = {
  table: 'questions',
  extraColumns: ['status', 'created_at'],
  extraValues: (item) => [item.status, item.createdAt],
};

/** Ordered by `ordinal`, not `id` — see `migrations/0001_init.ts`'s doc comment for why: a
 * dataset's array order is part of what must round-trip exactly. */
export function selectCollection<T>(
  db: DatabaseSyncType,
  config: CollectionConfig<T & { id: string }>,
  datasetId: string,
): T[] {
  const rows = db
    .prepare(`SELECT data FROM ${config.table} WHERE dataset_id = ? ORDER BY ordinal`)
    .all(datasetId) as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as T);
}

/** The current highest `ordinal` used for `datasetId` in this table, or `-1` if it has no rows
 * yet — a later migration appending new items to a collection continues numbering from here
 * rather than renumbering (or colliding with) what's already there. */
export function currentMaxOrdinal(
  db: DatabaseSyncType,
  config: CollectionConfig<{ id: string }>,
  datasetId: string,
): number {
  const row = db
    .prepare(`SELECT MAX(ordinal) as maxOrdinal FROM ${config.table} WHERE dataset_id = ?`)
    .get(datasetId) as { maxOrdinal: number | null };
  return row.maxOrdinal ?? -1;
}
