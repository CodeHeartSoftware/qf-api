import type { ResearchDataset } from '@quant-fusion/research-core';

/** Every array-valued collection on `ResearchDataset` an update may populate. */
export const COLLECTION_KEYS = [
  'entities',
  'relationships',
  'evidence',
  'assertions',
  'hypotheses',
  'assumptions',
  'variables',
  'models',
  'scenarios',
  'events',
  'questions',
] as const;
export type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** A partial `ResearchDataset` — only the collections an update actually touches, each optional. */
export type ResearchUpdate = Partial<Pick<ResearchDataset, CollectionKey>>;

export interface MergeSummary {
  /** Collection name -> count of brand-new records appended. */
  addedCounts: Partial<Record<CollectionKey, number>>;
  /** Ids of EXISTING entities whose mutable fields (type/name/description/validFrom/validTo/
   * metadata) an update deliberately overwrote — an explicit edit, not an append. */
  updatedEntityIds: string[];
  /** Relationship id -> count of new states appended to that EXISTING relationship. */
  appendedRelationshipStates: Record<string, number>;
  /** Hypothesis id -> count of new assessments appended to that EXISTING hypothesis. */
  appendedHypothesisAssessments: Record<string, number>;
  /** Ids of EXISTING hypotheses this update touched at all — a superset of
   * `appendedHypothesisAssessments`'s keys, since a deliberate name/statement/status edit with
   * NO new assessment still needs its row rewritten (see `sqlGen.ts`'s own use of this: without
   * it, an assessment-less edit would merge correctly in memory but never generate the `UPDATE`
   * that persists it). */
  updatedHypothesisIds: string[];
}

export type MergeResult =
  { ok: true; dataset: ResearchDataset; summary: MergeSummary } | { ok: false; reason: string };

type RelationshipState = ResearchDataset['relationships'][number]['states'][number];

/**
 * A relationship's states must never overlap, and only the chronologically LAST one may be
 * open-ended (`research-core`'s own `findOverlappingRelationshipStates` enforces this on every
 * parse). An update only ever supplies the NEW state(s) being appended, so this fills in the one
 * derived field an appended state implies — `effectiveTo` on every state except the last — rather
 * than asking every update to re-supply it. This is NOT an edit to a state's substantive content
 * (status/confidence/evidence are never touched); it only closes the validity window a later
 * state has, by construction, already superseded.
 */
function closeOutIntermediateStates(states: RelationshipState[]): RelationshipState[] {
  return states.map((state, index) => {
    const next = states[index + 1];
    if (next === undefined || state.effectiveTo !== undefined) return state;
    return { ...state, effectiveTo: next.effectiveFrom };
  });
}

/**
 * Pure merge function — no I/O — so it's directly testable and reusable both for generating a new
 * migration file's SQL (`sqlGen.ts`) and for validating an update before that. Refuses (returns
 * `ok: false`) rather than guessing whenever an update is ambiguous or a no-op: a relationship
 * whose type/fromEntityId/toEntityId don't match the existing record it's trying to add states
 * to, or any id collision (entity/relationship/hypothesis included) that changes nothing at all.
 * An id collision otherwise means "edit this existing record": entities and hypotheses take the
 * incoming object's mutable fields as authoritative outright; relationships/hypotheses ALSO
 * accept new states/assessments to append. Every other collection still refuses any id collision
 * outright — those have no defined "edit" semantics yet.
 *
 * Ported from `research/fusion/scripts/applyResearchUpdate.ts`'s original `mergeResearchUpdate` —
 * domain-neutral (no fusion-specific ids), moved here since it's now this package's job to decide
 * what a "research update" produces, not an individual domain package's.
 */
export function mergeResearchUpdate(current: ResearchDataset, update: ResearchUpdate): MergeResult {
  const merged: Record<string, unknown> = { ...current };
  const addedCounts: Partial<Record<CollectionKey, number>> = {};
  const updatedEntityIds: string[] = [];
  const appendedRelationshipStates: Record<string, number> = {};
  const appendedHypothesisAssessments: Record<string, number> = {};
  const updatedHypothesisIds: string[] = [];

  for (const key of COLLECTION_KEYS) {
    const incomingItems = update[key];
    if (incomingItems === undefined || incomingItems.length === 0) continue;

    if (key === 'entities') {
      const existingEntities = current.entities;
      const existingById = new Map(existingEntities.map((e) => [e.id, e]));
      const nextEntities = [...existingEntities];
      let addedNew = 0;

      for (const incoming of incomingItems as ResearchDataset['entities']) {
        const existing = existingById.get(incoming.id);
        if (existing === undefined) {
          nextEntities.push(incoming);
          addedNew++;
          continue;
        }
        // A deliberate edit: `recordedAt` (when research first knew this entity — see
        // `entity.ts`'s own doc comment) is never client-editable, since letting it move later
        // could retroactively invalidate a temporal-integrity check something else already
        // passed by citing this entity. Everything else is fair game to overwrite outright —
        // there's no assessments/states list to append to, just one current picture of the
        // entity, unlike relationships/hypotheses below.
        const next = {
          ...existing,
          type: incoming.type,
          name: incoming.name,
          description: incoming.description,
          validFrom: incoming.validFrom,
          validTo: incoming.validTo,
          metadata: incoming.metadata,
        };
        if (JSON.stringify(next) === JSON.stringify(existing)) {
          return {
            ok: false,
            reason: `entity "${incoming.id}" already exists and the update changes nothing — refusing the no-op.`,
          };
        }
        const index = nextEntities.findIndex((e) => e.id === incoming.id);
        nextEntities[index] = next;
        updatedEntityIds.push(incoming.id);
      }

      merged.entities = nextEntities;
      if (addedNew > 0) addedCounts.entities = addedNew;
      continue;
    }

    if (key === 'hypotheses') {
      const existingHypotheses = current.hypotheses;
      const existingById = new Map(existingHypotheses.map((h) => [h.id, h]));
      const nextHypotheses = [...existingHypotheses];
      let addedNew = 0;

      for (const incoming of incomingItems as ResearchDataset['hypotheses']) {
        const existing = existingById.get(incoming.id);
        if (existing === undefined) {
          nextHypotheses.push(incoming);
          addedNew++;
          continue;
        }
        const nameChanged = incoming.name !== existing.name;
        const statementChanged = incoming.statement !== existing.statement;
        const statusChanged = incoming.status !== existing.status;
        const hasNewAssessments = incoming.assessments.length > 0;
        if (!nameChanged && !statementChanged && !statusChanged && !hasNewAssessments) {
          return {
            ok: false,
            reason:
              `hypothesis "${incoming.id}" already exists and the update changes nothing (same ` +
              `name/statement/status, no new assessments) — nothing to do, refusing the no-op.`,
          };
        }
        const index = nextHypotheses.findIndex((h) => h.id === incoming.id);
        nextHypotheses[index] = {
          ...existing,
          // A deliberate edit — the incoming object's name/statement/status are always taken as
          // authoritative, even when they differ from what's on file (an explicit "edit this
          // hypothesis" action, not just appending an assessment to an unchanged one). `status`
          // still must agree with whichever assessment is chronologically last to carry one (see
          // `ResearchHypothesisSchema`'s own consistency rule) — enforced by validation after
          // this merge, not re-derived here.
          name: incoming.name,
          statement: incoming.statement,
          status: incoming.status,
          assessments: [...existing.assessments, ...incoming.assessments],
          falsifiers: incoming.falsifiers ?? existing.falsifiers,
        };
        if (hasNewAssessments) {
          appendedHypothesisAssessments[incoming.id] =
            (appendedHypothesisAssessments[incoming.id] ?? 0) + incoming.assessments.length;
        }
        updatedHypothesisIds.push(incoming.id);
      }

      merged.hypotheses = nextHypotheses;
      if (addedNew > 0) addedCounts.hypotheses = addedNew;
      continue;
    }

    if (key === 'relationships') {
      const existingRelationships = current.relationships;
      const existingById = new Map(existingRelationships.map((r) => [r.id, r]));
      const nextRelationships = [...existingRelationships];
      let addedNew = 0;

      for (const incoming of incomingItems as ResearchDataset['relationships']) {
        const existing = existingById.get(incoming.id);
        if (existing === undefined) {
          nextRelationships.push(incoming);
          addedNew++;
          continue;
        }
        if (
          incoming.type !== existing.type ||
          incoming.fromEntityId !== existing.fromEntityId ||
          incoming.toEntityId !== existing.toEntityId
        ) {
          return {
            ok: false,
            reason:
              `relationship "${incoming.id}" already exists with a different type/fromEntityId/` +
              `toEntityId than the update provides — refusing rather than silently redefining ` +
              `it. Existing: type="${existing.type}" fromEntityId="${existing.fromEntityId}" ` +
              `toEntityId="${existing.toEntityId}"; update: type="${incoming.type}" ` +
              `fromEntityId="${incoming.fromEntityId}" toEntityId="${incoming.toEntityId}".`,
          };
        }
        if (incoming.states.length === 0) {
          return {
            ok: false,
            reason:
              `relationship "${incoming.id}" already exists and the update supplies no new ` +
              `states to append — nothing to do, refusing the no-op.`,
          };
        }
        const index = nextRelationships.findIndex((r) => r.id === incoming.id);
        const combinedStates = closeOutIntermediateStates([...existing.states, ...incoming.states]);
        nextRelationships[index] = { ...existing, states: combinedStates };
        appendedRelationshipStates[incoming.id] =
          (appendedRelationshipStates[incoming.id] ?? 0) + incoming.states.length;
      }

      merged.relationships = nextRelationships;
      if (addedNew > 0) addedCounts.relationships = addedNew;
      continue;
    }

    const existingItems = current[key] as { id: string }[];
    const existingIds = new Set(existingItems.map((item) => item.id));
    for (const incoming of incomingItems as { id: string }[]) {
      if (existingIds.has(incoming.id)) {
        return {
          ok: false,
          reason:
            `${key} id "${incoming.id}" already exists in the dataset — an update never ` +
            `overwrites an existing record. Give the new/changed record its own, distinct id.`,
        };
      }
    }
    merged[key] = [...existingItems, ...(incomingItems as { id: string }[])];
    addedCounts[key] = incomingItems.length;
  }

  return {
    ok: true,
    dataset: merged as unknown as ResearchDataset,
    summary: {
      addedCounts,
      updatedEntityIds,
      appendedRelationshipStates,
      appendedHypothesisAssessments,
      updatedHypothesisIds,
    },
  };
}

/**
 * `version` bump convention: the base snapshot version (e.g. `"2026.09"`) gets an `+update.N`
 * suffix, incremented on every successful update — distinct from a new hand-authored snapshot
 * (which would get a whole new base version), so it's always visible from the version string
 * alone whether a dataset is the original snapshot or has one or more migration-applied updates
 * layered on top.
 */
export function bumpDatasetVersion(version: string): string {
  const match = /^(.*)\+update\.(\d+)$/.exec(version);
  if (match) {
    const base = match[1] ?? '';
    const n = Number(match[2]);
    return `${base}+update.${String(n + 1)}`;
  }
  return `${version}+update.1`;
}
