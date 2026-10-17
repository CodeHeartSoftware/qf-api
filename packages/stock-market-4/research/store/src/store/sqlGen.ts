import {
  formatValidationIssues,
  validateResearchDataset,
  type ResearchDataset,
} from '@quant-fusion/research-core';
import {
  ASSERTIONS,
  ASSUMPTIONS,
  ENTITIES,
  EVENTS,
  EVIDENCE,
  HYPOTHESES,
  MODELS,
  QUESTIONS,
  RELATIONSHIPS,
  SCENARIOS,
  VARIABLES,
  type CollectionConfig,
} from './collections.js';
import {
  bumpDatasetVersion,
  mergeResearchUpdate,
  type MergeSummary,
  type ResearchUpdate,
} from './merge.js';
import { err, ok, type Result } from '../result.js';

/**
 * Renders migration-file-ready, literal SQL — used both by the one-time seed generator (a full
 * dataset -> one big migration) and by update generation (a partial dataset -> an incremental
 * migration). No parameterized statements here deliberately: a `Migration.sql` string
 * (`@quant-fusion/sqlite-migrations`) is executed verbatim via `db.exec`, not through a prepared
 * statement, so values must be inlined as SQL literals.
 */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlInt(value: number): string {
  return String(Math.trunc(value));
}

function insertRowSql<T extends { id: string }>(
  config: CollectionConfig<T>,
  datasetId: string,
  item: T,
  ordinal: number,
): string {
  const columns = ['dataset_id', 'id', 'ordinal', ...config.extraColumns, 'data'];
  const values = [
    sqlString(datasetId),
    sqlString(item.id),
    sqlInt(ordinal),
    ...config.extraValues(item).map(sqlString),
    sqlString(JSON.stringify(item)),
  ];
  return `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

function appendCollectionInserts<T extends { id: string }>(
  statements: string[],
  config: CollectionConfig<T>,
  datasetId: string,
  items: readonly T[],
  startOrdinal: number,
): void {
  items.forEach((item, index) => {
    statements.push(insertRowSql(config, datasetId, item, startOrdinal + index));
  });
}

function updateEntityDataSql(
  datasetId: string,
  entity: ResearchDataset['entities'][number],
): string {
  return (
    `UPDATE entities SET type = ${sqlString(entity.type)}, name = ${sqlString(entity.name)}, ` +
    `data = ${sqlString(JSON.stringify(entity))} ` +
    `WHERE dataset_id = ${sqlString(datasetId)} AND id = ${sqlString(entity.id)};`
  );
}

function updateRelationshipDataSql(
  datasetId: string,
  relationship: ResearchDataset['relationships'][number],
): string {
  return (
    `UPDATE relationships SET data = ${sqlString(JSON.stringify(relationship))} ` +
    `WHERE dataset_id = ${sqlString(datasetId)} AND id = ${sqlString(relationship.id)};`
  );
}

function updateHypothesisDataSql(
  datasetId: string,
  hypothesis: ResearchDataset['hypotheses'][number],
): string {
  return (
    `UPDATE hypotheses SET name = ${sqlString(hypothesis.name)}, ` +
    `status = ${sqlString(hypothesis.status)}, ` +
    `data = ${sqlString(JSON.stringify(hypothesis))} ` +
    `WHERE dataset_id = ${sqlString(datasetId)} AND id = ${sqlString(hypothesis.id)};`
  );
}

/**
 * Renders the ONE migration that recreates a whole `ResearchDataset` from nothing — the seed
 * migration for a brand-new `dataset_id` (e.g. `research-store/0002_fusion_seed`). Refuses
 * (`Result`) rather than emitting invalid SQL if `dataset` itself fails validation.
 */
export function renderSeedSql(dataset: ResearchDataset): Result<string> {
  const validated = validateResearchDataset(dataset);
  if (!validated.ok) {
    return err(
      `refusing to seed an invalid research dataset: ${formatValidationIssues(validated.issues)}`,
    );
  }

  const statements: string[] = [
    'INSERT INTO research_datasets (dataset_id, domain, name, version, created_at, updated_at, metadata) ' +
      `VALUES (${sqlString(dataset.id)}, ${sqlString(dataset.domain)}, ${sqlString(dataset.name)}, ` +
      `${sqlString(dataset.version)}, ${sqlString(dataset.createdAt)}, ${sqlString(dataset.createdAt)}, ` +
      `${dataset.metadata !== undefined ? sqlString(JSON.stringify(dataset.metadata)) : 'NULL'});`,
  ];

  appendCollectionInserts(statements, ENTITIES, dataset.id, dataset.entities, 0);
  appendCollectionInserts(statements, RELATIONSHIPS, dataset.id, dataset.relationships, 0);
  appendCollectionInserts(statements, EVIDENCE, dataset.id, dataset.evidence, 0);
  appendCollectionInserts(statements, ASSERTIONS, dataset.id, dataset.assertions, 0);
  appendCollectionInserts(statements, HYPOTHESES, dataset.id, dataset.hypotheses, 0);
  appendCollectionInserts(statements, ASSUMPTIONS, dataset.id, dataset.assumptions, 0);
  appendCollectionInserts(statements, VARIABLES, dataset.id, dataset.variables, 0);
  appendCollectionInserts(statements, MODELS, dataset.id, dataset.models, 0);
  appendCollectionInserts(statements, SCENARIOS, dataset.id, dataset.scenarios, 0);
  appendCollectionInserts(statements, EVENTS, dataset.id, dataset.events, 0);
  appendCollectionInserts(statements, QUESTIONS, dataset.id, dataset.questions, 0);

  return ok(statements.join('\n'));
}

export interface RenderUpdateResult {
  sql: string;
  newVersion: string;
  summary: MergeSummary;
}

/**
 * Renders an INCREMENTAL migration — only the new rows a `ResearchUpdate` contributes, plus one
 * `UPDATE` per relationship gaining new states and one `UPDATE` bumping `research_datasets`'
 * version/updated_at label. This is the migration-time equivalent of what
 * `research/fusion/scripts/applyResearchUpdate.ts` used to do by rewriting the whole
 * `data/dataset.json` file.
 */
export function renderUpdateSql(
  current: ResearchDataset,
  update: ResearchUpdate,
  now: string,
): Result<RenderUpdateResult> {
  const mergeResult = mergeResearchUpdate(current, update);
  if (!mergeResult.ok) {
    return err(mergeResult.reason);
  }

  const newVersion = bumpDatasetVersion(current.version);
  const bumped: ResearchDataset = { ...mergeResult.dataset, version: newVersion };
  const validated = validateResearchDataset(bumped);
  if (!validated.ok) {
    return err(
      `merged dataset fails validation, no migration generated:\n${formatValidationIssues(validated.issues)}`,
    );
  }

  const statements: string[] = [];

  if (update.entities !== undefined) {
    const existingIds = new Set(current.entities.map((e) => e.id));
    const newEntities = update.entities.filter((e) => !existingIds.has(e.id));
    appendCollectionInserts(statements, ENTITIES, current.id, newEntities, current.entities.length);

    for (const entityId of mergeResult.summary.updatedEntityIds) {
      const mergedEntity = bumped.entities.find((e) => e.id === entityId);
      if (mergedEntity === undefined) continue; // unreachable: this id was just merged above
      statements.push(updateEntityDataSql(current.id, mergedEntity));
    }
  }

  appendCollectionInserts(
    statements,
    EVIDENCE,
    current.id,
    update.evidence ?? [],
    current.evidence.length,
  );
  appendCollectionInserts(
    statements,
    ASSERTIONS,
    current.id,
    update.assertions ?? [],
    current.assertions.length,
  );
  appendCollectionInserts(
    statements,
    ASSUMPTIONS,
    current.id,
    update.assumptions ?? [],
    current.assumptions.length,
  );
  appendCollectionInserts(
    statements,
    VARIABLES,
    current.id,
    update.variables ?? [],
    current.variables.length,
  );
  appendCollectionInserts(
    statements,
    MODELS,
    current.id,
    update.models ?? [],
    current.models.length,
  );
  appendCollectionInserts(
    statements,
    SCENARIOS,
    current.id,
    update.scenarios ?? [],
    current.scenarios.length,
  );
  appendCollectionInserts(
    statements,
    EVENTS,
    current.id,
    update.events ?? [],
    current.events.length,
  );
  appendCollectionInserts(
    statements,
    QUESTIONS,
    current.id,
    update.questions ?? [],
    current.questions.length,
  );

  if (update.relationships !== undefined) {
    const existingIds = new Set(current.relationships.map((r) => r.id));
    const newRelationships = update.relationships.filter((r) => !existingIds.has(r.id));
    appendCollectionInserts(
      statements,
      RELATIONSHIPS,
      current.id,
      newRelationships,
      current.relationships.length,
    );

    for (const relationshipId of Object.keys(mergeResult.summary.appendedRelationshipStates)) {
      const mergedRelationship = bumped.relationships.find((r) => r.id === relationshipId);
      if (mergedRelationship === undefined) continue; // unreachable: this id was just merged above
      statements.push(updateRelationshipDataSql(current.id, mergedRelationship));
    }
  }

  if (update.hypotheses !== undefined) {
    const existingIds = new Set(current.hypotheses.map((h) => h.id));
    const newHypotheses = update.hypotheses.filter((h) => !existingIds.has(h.id));
    appendCollectionInserts(
      statements,
      HYPOTHESES,
      current.id,
      newHypotheses,
      current.hypotheses.length,
    );

    for (const hypothesisId of new Set(mergeResult.summary.updatedHypothesisIds)) {
      const mergedHypothesis = bumped.hypotheses.find((h) => h.id === hypothesisId);
      if (mergedHypothesis === undefined) continue; // unreachable: this id was just merged above
      statements.push(updateHypothesisDataSql(current.id, mergedHypothesis));
    }
  }

  statements.push(
    `UPDATE research_datasets SET version = ${sqlString(newVersion)}, updated_at = ${sqlString(now)} ` +
      `WHERE dataset_id = ${sqlString(current.id)};`,
  );

  return ok({ sql: statements.join('\n'), newVersion, summary: mergeResult.summary });
}

/** The three collections a caller may delete a single record from — see `renderDeleteSql`'s own
 * doc comment for why this list is deliberately narrower than every collection a dataset has. */
export const DELETABLE_COLLECTION_KEYS = ['entities', 'relationships', 'hypotheses'] as const;
export type DeletableCollectionKey = (typeof DELETABLE_COLLECTION_KEYS)[number];

/** Picking the config with a switch (rather than a `Record<DeletableCollectionKey, ...>` lookup
 * table) sidesteps `CollectionConfig`'s contravariant `extraValues` making the three configs'
 * concrete types not all assignable to one shared `CollectionConfig<{ id: string }>`. */
function deletableCollectionTable(collectionKey: DeletableCollectionKey): string {
  switch (collectionKey) {
    case 'entities':
      return ENTITIES.table;
    case 'relationships':
      return RELATIONSHIPS.table;
    case 'hypotheses':
      return HYPOTHESES.table;
  }
}

export interface RenderDeleteResult {
  sql: string;
  newVersion: string;
}

/**
 * Renders an INCREMENTAL migration that removes ONE record by id — a real `DELETE`, not a
 * retraction/soft-delete, since none of the three deletable collections has an evidenced-history
 * concept a retraction would need to preserve (unlike, say, a relationship's own `states[]`,
 * which already IS the append-only record of a status changing over time — see
 * `0005_walter_tosto_production_contract_retraction.ts` for that pattern, which stays the right
 * tool for correcting a relationship/hypothesis's recorded history without erasing it; deleting
 * the WHOLE record is a different, coarser operation, for "this shouldn't have existed at all").
 * Evidence/events/assertions/etc. are deliberately NOT deletable through this path — this repo
 * has no precedent yet for what "delete" should mean for something itself cited as evidence.
 *
 * Safety net: the resulting dataset (with the record removed) is run back through
 * `validateResearchDataset` before any SQL is emitted, exactly like `renderUpdateSql` does for an
 * add/edit — a relationship still pointing at a deleted entity, or an event/evidence still citing
 * a deleted entity, fails that validation and the whole delete is refused with the same
 * missing-reference issue a human reviewer would want to see, rather than silently corrupting
 * every future read of this dataset.
 */
export function renderDeleteSql(
  current: ResearchDataset,
  collectionKey: DeletableCollectionKey,
  id: string,
  now: string,
): Result<RenderDeleteResult> {
  const items = current[collectionKey] as readonly { id: string }[];
  if (!items.some((item) => item.id === id)) {
    return err(`no "${id}" in ${collectionKey} of dataset "${current.id}" — nothing to delete.`);
  }

  const newVersion = bumpDatasetVersion(current.version);
  const resulting = {
    ...current,
    version: newVersion,
    [collectionKey]: items.filter((item) => item.id !== id),
  };
  const validated = validateResearchDataset(resulting);
  if (!validated.ok) {
    return err(
      `cannot delete "${id}" from ${collectionKey} — still referenced elsewhere in the dataset:\n` +
        formatValidationIssues(validated.issues),
    );
  }

  const table = deletableCollectionTable(collectionKey);
  const sql = [
    `DELETE FROM ${table} WHERE dataset_id = ${sqlString(current.id)} AND id = ${sqlString(id)};`,
    `UPDATE research_datasets SET version = ${sqlString(newVersion)}, updated_at = ${sqlString(now)} ` +
      `WHERE dataset_id = ${sqlString(current.id)};`,
  ].join('\n');

  return ok({ sql, newVersion });
}
