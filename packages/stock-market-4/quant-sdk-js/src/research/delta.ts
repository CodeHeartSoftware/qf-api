import type { Evidence, ResearchEvent, ResearchState } from './types.js';

/** One hypothesis whose latest assessed confidence differs from the previous snapshot's (or is
 * entirely new this snapshot — `previousConfidence: null`). Never a bare JSON diff: this compares
 * the specific, typed field ("what did we most recently believe, and how strongly") that actually
 * matters to a strategy, and nothing else. */
export interface HypothesisChange {
  hypothesisId: string;
  name: string;
  previousConfidence: number | null;
  currentConfidence: number;
  rationale: string | undefined;
}

/** One relationship whose latest state's `status` differs from the previous snapshot's (or is
 * entirely new — `previousStatus: null`). Deliberately compares `status` only, never invents a
 * relationship or upgrades its status on its own — see `interpretEvents.ts` for why this matters:
 * a relationship going from absent to `'UNKNOWN'` is still a real, reportable change (research now
 * has an entry for it), even though `'UNKNOWN'` itself must never be treated as positive. */
export interface RelationshipChange {
  relationshipId: string;
  type: string;
  fromEntityId: string;
  toEntityId: string;
  previousStatus: string | null;
  currentStatus: string;
}

/**
 * What changed between two point-in-time research snapshots — the answer to "what changed since
 * the bot's previous decision?" (spec §7). Built entirely from research-core's own structures
 * (`ResearchState`'s typed collections), never by comparing serialized JSON. `previous` is
 * `undefined` on a bot's very first decision (nothing to compare against yet), in which case
 * every current entity is reported as "new" — a legitimate, non-empty delta on round 0, not a bug.
 */
export interface ResearchDelta {
  isEmpty: boolean;
  newEvidence: Evidence[];
  changedHypotheses: HypothesisChange[];
  changedRelationships: RelationshipChange[];
  newEvents: ResearchEvent[];
}

export function computeResearchDelta(
  previous: ResearchState | undefined,
  current: ResearchState,
): ResearchDelta {
  const previousEvidenceIds = new Set((previous?.evidence ?? []).map((evidence) => evidence.id));
  const newEvidence = current.evidence.filter((evidence) => !previousEvidenceIds.has(evidence.id));

  const previousHypothesesById = new Map(
    (previous?.hypotheses ?? []).map((hypothesis) => [hypothesis.id, hypothesis]),
  );
  const changedHypotheses: HypothesisChange[] = [];
  for (const hypothesis of current.hypotheses) {
    const currentLatest = hypothesis.assessments.at(-1);
    if (currentLatest === undefined) continue; // proposed but never assessed yet — nothing to compare

    const prior = previousHypothesesById.get(hypothesis.id);
    const priorLatest = prior?.assessments.at(-1);
    const previousConfidence = priorLatest?.confidence.value ?? null;

    if (previousConfidence === null || previousConfidence !== currentLatest.confidence.value) {
      changedHypotheses.push({
        hypothesisId: hypothesis.id,
        name: hypothesis.name,
        previousConfidence,
        currentConfidence: currentLatest.confidence.value,
        rationale: currentLatest.rationale,
      });
    }
  }

  const previousRelationshipsById = new Map(
    (previous?.relationships ?? []).map((relationship) => [relationship.id, relationship]),
  );
  const changedRelationships: RelationshipChange[] = [];
  for (const relationship of current.relationships) {
    const currentLatestState = relationship.states.at(-1);
    if (currentLatestState === undefined) continue; // no visible state yet — nothing to compare

    const prior = previousRelationshipsById.get(relationship.id);
    const priorLatestState = prior?.states.at(-1);
    const previousStatus = priorLatestState?.status ?? null;

    if (previousStatus === null || previousStatus !== currentLatestState.status) {
      changedRelationships.push({
        relationshipId: relationship.id,
        type: relationship.type,
        fromEntityId: relationship.fromEntityId,
        toEntityId: relationship.toEntityId,
        previousStatus,
        currentStatus: currentLatestState.status,
      });
    }
  }

  const previousEventIds = new Set((previous?.events ?? []).map((event) => event.id));
  const newEvents = current.events.filter((event) => !previousEventIds.has(event.id));

  return {
    isEmpty:
      newEvidence.length === 0 &&
      changedHypotheses.length === 0 &&
      changedRelationships.length === 0 &&
      newEvents.length === 0,
    newEvidence,
    changedHypotheses,
    changedRelationships,
    newEvents,
  };
}
