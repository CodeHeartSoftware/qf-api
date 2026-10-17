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
  selectCollection,
  VARIABLES,
} from './collections.js';
import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

interface ResearchDatasetRow {
  dataset_id: string;
  domain: string;
  name: string;
  version: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  priority: number;
}

/**
 * Reconstructs a full `ResearchDataset` from `store` and re-validates it via
 * `validateResearchDataset` before returning — defense in depth against a hand-edited or
 * otherwise corrupted row, the same "never trust storage blindly" posture
 * `@quant-fusion/market-data` and `@quant-fusion/forward-match-store` both take.
 *
 * Unlike `@quant-fusion/market-data`'s `barsAsOf` (scoped by an exact, pinned dataset version),
 * this always returns the CURRENT cumulative dataset for `datasetId` — see
 * `migrations/0001_init.ts`'s doc comment for why research data has no per-version pinning.
 */
export function getResearchDataset(
  store: ResearchStore,
  datasetId: string,
): Result<ResearchDataset> {
  const { db } = store;
  const row = db.prepare('SELECT * FROM research_datasets WHERE dataset_id = ?').get(datasetId) as
    ResearchDatasetRow | undefined;

  if (!row) {
    return err(`research dataset "${datasetId}" not found`);
  }

  const raw = {
    id: row.dataset_id,
    version: row.version,
    domain: row.domain,
    name: row.name,
    createdAt: row.created_at,
    metadata: row.metadata !== null ? (JSON.parse(row.metadata) as unknown) : undefined,
    entities: selectCollection(db, ENTITIES, datasetId),
    relationships: selectCollection(db, RELATIONSHIPS, datasetId),
    evidence: selectCollection(db, EVIDENCE, datasetId),
    assertions: selectCollection(db, ASSERTIONS, datasetId),
    hypotheses: selectCollection(db, HYPOTHESES, datasetId),
    assumptions: selectCollection(db, ASSUMPTIONS, datasetId),
    variables: selectCollection(db, VARIABLES, datasetId),
    models: selectCollection(db, MODELS, datasetId),
    scenarios: selectCollection(db, SCENARIOS, datasetId),
    events: selectCollection(db, EVENTS, datasetId),
    questions: selectCollection(db, QUESTIONS, datasetId),
  };

  const validated = validateResearchDataset(raw);
  if (!validated.ok) {
    return err(
      `research dataset "${datasetId}" is corrupt: ${formatValidationIssues(validated.issues)}`,
    );
  }
  return ok(validated.value);
}

export interface ResearchDatasetSummary {
  datasetId: string;
  domain: string;
  name: string;
  version: string;
  /** Sidebar display order — higher shown first (see `migrations/0011_research_domain_priority.ts`'s
   * own doc comment for why this lives here and not on `ResearchDataset` itself). */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every registered research domain — one row per `research_datasets` entry, bare (no collection
 * contents; call `getResearchDataset` per row for that), sorted by `priority` (highest first,
 * ties broken by creation order) — this IS the domain sidebar's own display order, not something
 * a caller re-sorts afterward. This is the generic domain REGISTRY: a domain is nothing more than
 * a row here, so "which domains exist, and in what order" is a plain query, not a hardcoded list
 * a consumer has to keep in sync with which domain packages happen to exist (see
 * `scripts/createResearchDomain.ts`, which is the one thing that ever adds a row here).
 */
export function listResearchDatasets(store: ResearchStore): ResearchDatasetSummary[] {
  const rows = store.db
    .prepare('SELECT * FROM research_datasets ORDER BY priority DESC, created_at ASC')
    .all() as unknown as ResearchDatasetRow[];
  return rows.map((row) => ({
    datasetId: row.dataset_id,
    domain: row.domain,
    name: row.name,
    version: row.version,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
