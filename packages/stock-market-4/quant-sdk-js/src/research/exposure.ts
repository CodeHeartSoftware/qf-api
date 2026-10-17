import type { ResearchState } from './types.js';

/** One thing this security has SOME exposure to, within one dimension — never a bare number on
 * its own; always traceable back to a real entity/hypothesis id and a real name. `weight` is
 * always derived from something research actually recorded (a hop distance in the graph, or a
 * hypothesis's own assessed confidence) — never invented. */
export interface ExposureEntry {
  id: string;
  name: string;
  weight: number;
}

/**
 * A security's exposure, kept in SEPARATE dimensions rather than collapsed into one "fusion
 * score" (spec §3) — a company can simultaneously have tokamak exposure, HTS exposure, and
 * tungsten exposure, and mixing those into one number would hide exactly the distinctions spec
 * §17/§36 ask this bot to preserve. Every dimension defaults to `[]`, never `undefined` — "no
 * exposure found" is itself a real, reportable finding (spec §43: KMT/AMSC's rejection needs to
 * be explainable as "low exposure across every dimension," not silently absent data).
 */
export interface ExposureMap {
  targetEntityId: string;
  /** Reactor/program-type entities reached within `MAX_HOPS` of the target, via ANY relationship
   * (in either direction) — e.g. "ARC requires tungsten" + "target manufactures tungsten" gives
   * the target ARC architecture exposure at 2 hops, even with no direct target->ARC relationship. */
  architecture: ExposureEntry[];
  /** Material-type entities reached the same way. */
  material: ExposureEntry[];
  /** Component-type entities reached the same way. */
  component: ExposureEntry[];
  /** Relationships FROM the target whose type indicates it manufactures/has a capability
   * (`manufactures`, `has_capability`, `produces`, ...) — hop-1 only; a capability is a fact ABOUT
   * the target, not something to traverse further. */
  manufacturing: ExposureEntry[];
  /** Hypotheses that relate to the target (via supporting evidence naming it) — the bottleneck-
   * relevant research literature for this security, weighted by each hypothesis's own latest
   * assessed confidence. This is deliberately the SAME "relates via evidence" test
   * `interpretEvents.ts` already uses for hypothesis effects — not a second, looser definition. */
  bottleneck: ExposureEntry[];
  /** Relationships FROM the target matching a supplier/customer/qualification/contract type,
   * bucketed by the relationship's own LATEST recorded status text — never inferred, only what's
   * actually on record. A relationship whose status doesn't clearly indicate a tier still shows up
   * here (bucket `'program'`), so nothing with a real relationship silently disappears. */
  qualification: ExposureEntry[];
  contract: ExposureEntry[];
  program: ExposureEntry[];
}

const MAX_HOPS = 2;
const MANUFACTURING_TYPE_PATTERN = /manufactures|has_capability|produces/i;
const SUPPLIER_TYPE_PATTERN = /customer|qualification|supplies|supplier|contract/i;
const CONTRACT_STATUS_PATTERN = /contract/i;
const QUALIFICATION_STATUS_PATTERN = /qualif/i;

function entryFor(id: string, state: ResearchState, weight: number): ExposureEntry {
  const entity = state.entities.find((e) => e.id === id);
  return { id, name: entity?.name ?? id, weight };
}

/** Every OTHER entity reachable from `targetEntityId` within `MAX_HOPS`, via relationships in
 * EITHER direction (a "requires" edge points reactor->material, so finding "does this material
 * feed into that reactor" means walking edges backwards too) — mapped to the shortest hop
 * distance found. Two entities are never double-counted at different distances; the closer one
 * wins, since a shorter causal path is the more defensible one to weight higher. */
function reachableEntities(targetEntityId: string, state: ResearchState): Map<string, number> {
  const distanceById = new Map<string, number>([[targetEntityId, 0]]);
  let frontier = [targetEntityId];
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const relationship of state.relationships) {
        const neighbor =
          relationship.fromEntityId === id
            ? relationship.toEntityId
            : relationship.toEntityId === id
              ? relationship.fromEntityId
              : undefined;
        if (neighbor === undefined || distanceById.has(neighbor)) continue;
        distanceById.set(neighbor, hop);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  distanceById.delete(targetEntityId);
  return distanceById;
}

function hypothesisRelatesToEntity(
  hypothesis: ResearchState['hypotheses'][number],
  entityId: string,
  evidenceById: Map<string, ResearchState['evidence'][number]>,
): boolean {
  const latest = hypothesis.assessments.at(-1);
  if (latest === undefined) return false;
  return latest.supportingEvidenceIds.some((id) =>
    evidenceById.get(id)?.entityIds.includes(entityId),
  );
}

/**
 * Builds a security's full multi-dimensional `ExposureMap` (spec §3) by traversing
 * `currentState`'s relationship graph outward from `targetEntityId` and classifying what's found —
 * never a single collapsed score, and every entry traces back to a real graph edge or hypothesis.
 */
export function computeExposureMap(state: ResearchState, targetEntityId: string): ExposureMap {
  const reachable = reachableEntities(targetEntityId, state);
  const entitiesById = new Map(state.entities.map((e) => [e.id, e]));

  const architecture: ExposureEntry[] = [];
  const material: ExposureEntry[] = [];
  const component: ExposureEntry[] = [];
  for (const [id, hops] of reachable) {
    const entity = entitiesById.get(id);
    if (entity === undefined) continue;
    const weight = 1 / hops;
    if (entity.type === 'reactor') architecture.push(entryFor(id, state, weight));
    else if (entity.type === 'material') material.push(entryFor(id, state, weight));
    else if (entity.type === 'component') component.push(entryFor(id, state, weight));
  }

  const manufacturing: ExposureEntry[] = [];
  const qualification: ExposureEntry[] = [];
  const contract: ExposureEntry[] = [];
  const program: ExposureEntry[] = [];
  for (const relationship of state.relationships) {
    if (relationship.fromEntityId !== targetEntityId) continue;
    const latest = relationship.states.at(-1);
    if (latest === undefined) continue;
    const weight = latest.confidence?.value ?? 1;

    if (MANUFACTURING_TYPE_PATTERN.test(relationship.type)) {
      manufacturing.push(entryFor(relationship.toEntityId, state, weight));
      continue;
    }
    if (!SUPPLIER_TYPE_PATTERN.test(relationship.type)) continue;

    const entry = entryFor(relationship.toEntityId, state, weight);
    if (CONTRACT_STATUS_PATTERN.test(latest.status)) contract.push(entry);
    else if (QUALIFICATION_STATUS_PATTERN.test(latest.status)) qualification.push(entry);
    else program.push(entry);
  }

  const evidenceById = new Map(state.evidence.map((e) => [e.id, e]));
  const bottleneck: ExposureEntry[] = [];
  for (const hypothesis of state.hypotheses) {
    if (!hypothesisRelatesToEntity(hypothesis, targetEntityId, evidenceById)) continue;
    const latest = hypothesis.assessments.at(-1);
    if (latest === undefined) continue;
    bottleneck.push({ id: hypothesis.id, name: hypothesis.name, weight: latest.confidence.value });
  }

  return {
    targetEntityId,
    architecture,
    material,
    component,
    manufacturing,
    bottleneck,
    qualification,
    contract,
    program,
  };
}

/** Every entity/hypothesis id this exposure map touches, across every dimension — the shared
 * "footprint" used to detect two securities betting on the same underlying commercialization
 * pathway (spec §20/§42) without needing a second, separate representation. */
export function exposureFootprint(exposure: ExposureMap): Set<string> {
  const ids = new Set<string>();
  for (const dimension of [
    exposure.architecture,
    exposure.material,
    exposure.component,
    exposure.manufacturing,
    exposure.bottleneck,
    exposure.qualification,
    exposure.contract,
    exposure.program,
  ]) {
    for (const entry of dimension) ids.add(entry.id);
  }
  return ids;
}
