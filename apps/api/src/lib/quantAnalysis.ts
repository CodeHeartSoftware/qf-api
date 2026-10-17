import {
  computeResearchStateAt,
  type ResearchDataset,
  type ResearchState as CoreResearchState,
} from '@quant-fusion/research-core';
import {
  computeCausalOverlap,
  computeExposureMap,
  computeResearchDelta,
  exposureFootprint,
  groupByThesisOverlap,
  interpretResearchDelta,
  type ExposureMap,
  type ModelEffect,
  type ResearchDelta,
  type ResearchState as QuantResearchState,
} from '@quant-fusion/quant-sdk-js';
import {
  listRelationshipTypeCategoryAssignments,
  listTrackedTickers,
  loadResearchDataset,
  type RelationshipTypeCategory,
} from './researchStore.js';

/** `@quant-fusion/quant-sdk-js` hand-declares its own copy of `ResearchState` (documented as
 * "field-for-field" identical to research-core's real one — `bots/**` isn't a workspace member,
 * so it can't import research-core's types directly; see that package's own `research/types.ts`
 * doc comment). The two are structurally the same at runtime; the only mismatch is a stricter
 * `exactOptionalPropertyTypes` distinction TypeScript draws between research-core's Zod-inferred
 * `description?: string | undefined` and quant-sdk-js's plain `description?: string` — a type
 * dialect difference, not a real shape divergence. This is the one place that gap is bridged. */
function toQuantResearchState(state: CoreResearchState): QuantResearchState {
  return state as unknown as QuantResearchState;
}

/**
 * These three analyses are exactly what `@quant-fusion/quant-sdk-js` (the real quant bot's own
 * "bones" — see its README) computes internally every round: a security's multi-hop research
 * EXPOSURE, what changed (and what that means) between two points in time, and which tracked
 * securities the risk engine would treat as one correlated bet. Surfacing them here — as plain
 * reads over the SAME pure functions the bot itself calls, not a re-implementation — lets a
 * person inspect the bot's own reasoning about a domain's research without needing to run a real
 * match. Unlike `apply:research-update`/`create:domain`, none of this reads or writes a
 * migration, so it's a direct in-process import (`@quant-fusion/quant-sdk-js` is a real workspace
 * package, unlike the bots that vendor it — `bots/**` isn't a workspace member, this package is),
 * not a subprocess call.
 */

async function loadEntityCheckedDataset(
  domain: string,
  entityId: string,
): Promise<{ ok: true; dataset: ResearchDataset } | { ok: false; error: string }> {
  const result = await loadResearchDataset(domain);
  if (!result.ok) return result;
  if (!result.dataset.entities.some((e) => e.id === entityId)) {
    return { ok: false, error: `no entity "${entityId}" in domain "${domain}"` };
  }
  return { ok: true, dataset: result.dataset };
}

/** An entity that now represents more than one formerly-separate company (e.g. after a
 * duplicate/merged entity gets consolidated — see `research-store`'s own delete-entity migrations)
 * gets a `"A/B"`-joined name, e.g. `"Sumitomo/A.L.M.T"`. Every rule in `findMatchingEntity` checks
 * a ticker's company name against each `/`-separated part individually (as well as the whole,
 * unsplit name) — still an exact/prefix comparison per part, never fuzzy, so "Sumitomo Electric"
 * still correctly resolves to that merged entity via part "Sumitomo" the same way it would have
 * matched a standalone "Sumitomo" entity before the merge. */
function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [];
  const parts = trimmed
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 1 ? [trimmed, ...parts] : [trimmed];
}

/**
 * Resolves a tracked ticker's company name to a research entity, trying progressively looser
 * rules — never a fuzzy/approximate match beyond these three explicit ones, since a wrong guess
 * here would misattribute a company's news/research to the wrong entity:
 *   1. Exact name match (case/whitespace-insensitive) — against the entity's whole name, or any
 *      one of its `/`-joined parts if it's a merged entity (see `nameVariants`).
 *   2. One name is a leading-word prefix of the other, e.g. "Fujikura" vs "Fujikura Ltd." or
 *      "Sumitomo" vs "Sumitomo Electric" — handles a shortened/formal-suffix variant without
 *      maintaining a list of corporate suffixes (Inc./Ltd./Corp./...) to strip. Same per-part
 *      check as rule 1 for a merged entity.
 *   3. The entity's own name (or a `/`-joined part of it) equals the ticker symbol itself, e.g.
 *      entity "AMSC" for ticker AMSC — for when the tracked ticker's company name ("American
 *      Superconductor") shares no text with the entity name at all, so rule 2 can never bridge
 *      them.
 *
 * The SAME three rules `ResearchUpdateModal.tsx` applies client-side for a news item's own
 * company (a second implementation, `researchFormShared.tsx`'s own `findMatchingEntity` — this is
 * a browser bundle with no dependency on this Node package; see
 * `docs/adr/0015-quant-fusion-ui-read-api.md`). Change one, change both.
 */
export function findMatchingEntity<T extends { name: string }>(
  entities: T[],
  companyName: string,
  ticker: string,
): T | undefined {
  const normalizedCompany = companyName.trim().toLowerCase();
  const byExactName = entities.find((e) =>
    nameVariants(e.name).some((variant) => variant.toLowerCase() === normalizedCompany),
  );
  if (byExactName !== undefined) return byExactName;

  const byNamePrefix = entities.find((e) =>
    nameVariants(e.name).some((variant) => {
      const normalizedEntity = variant.toLowerCase();
      if (normalizedEntity.length === 0) return false;
      return (
        normalizedCompany.startsWith(`${normalizedEntity} `) ||
        normalizedEntity.startsWith(`${normalizedCompany} `)
      );
    }),
  );
  if (byNamePrefix !== undefined) return byNamePrefix;

  const normalizedTicker = ticker.trim().toLowerCase();
  return entities.find((e) =>
    nameVariants(e.name).some((variant) => variant.toLowerCase() === normalizedTicker),
  );
}

/** Resolves each tracked ticker to a research entity — see `findMatchingEntity`'s own doc
 * comment for the match rules. A ticker with no matching entity yet just can't be analyzed — not
 * an error, it's simply excluded (see `tracked_tickers`'s own doc comment on why a ticker never
 * requires a research entity to already exist). */
function resolveTrackedEntityIds(
  dataset: ResearchDataset,
  tickers: { ticker: string; companyName: string }[],
): { entityIdByTicker: Map<string, string>; trackedEntityIds: Set<string> } {
  const entityIdByTicker = new Map<string, string>();
  for (const ticker of tickers) {
    const match = findMatchingEntity(dataset.entities, ticker.companyName, ticker.ticker);
    if (match !== undefined) entityIdByTicker.set(ticker.ticker, match.id);
  }
  return { entityIdByTicker, trackedEntityIds: new Set(entityIdByTicker.values()) };
}

const RELATIONSHIP_TYPE_CATEGORY_DIMENSIONS = [
  'manufacturing',
  'qualification',
  'contract',
  'program',
] as const satisfies readonly (keyof ExposureMap)[];

/**
 * Re-sorts `exposure`'s manufacturing/qualification/contract/program entries according to
 * `categoryByType` — a person's own explicit "this relationship type belongs under Contract"
 * calls from the Manage Relationship Types modal, made because `computeExposureMap`'s own regex
 * classification (`MANUFACTURING_TYPE_PATTERN`/`SUPPLIER_TYPE_PATTERN`, bucketed further by the
 * relationship's own status text) sometimes gets it wrong or misses a type entirely — e.g. a
 * `customer_contract`-typed relationship lands in "program" instead of "contract" whenever its
 * recorded status text doesn't happen to contain the word "contract". This walks the SAME hop-1,
 * from-the-target-only relationships `computeExposureMap`'s own manufacturing/qualification/
 * contract/program buckets use ("a capability is a fact ABOUT the target, not something to
 * traverse further" — see that function's own doc comment) and, for any relationship whose type
 * has an explicit category, moves its entry into that category — removing it from wherever the
 * real regex classification put it (if anywhere) first, so it never counts toward two categories
 * at once. A relationship type with NO override is left exactly as `computeExposureMap` already
 * classified it.
 *
 * Deliberately NOT inside `@quant-fusion/quant-sdk-js` and NEVER used by `getThesisGroups`
 * (real portfolio risk grouping stays on the bot's own unmodified classification) — this only
 * reshapes what `getExposureMap` shows a person in the Quant tab. Returns a NEW object; `exposure`
 * itself (and the array references quant-sdk-js handed back) are never mutated.
 *
 * Known limitation: two different relationships FROM the same target TO the same other entity
 * (one overridden, one not) can't be told apart by id alone, so moving the overridden one could
 * also pull out the other's entry. Rare in practice, and an acceptable simplification rather than
 * re-deriving quant-sdk-js's own regex here a second time.
 */
export function applyRelationshipTypeCategories(
  exposure: ExposureMap,
  state: QuantResearchState,
  targetEntityId: string,
  categoryByType: Map<string, RelationshipTypeCategory>,
): ExposureMap {
  if (categoryByType.size === 0) return exposure;

  const result: ExposureMap = { ...exposure };
  for (const dimension of RELATIONSHIP_TYPE_CATEGORY_DIMENSIONS) {
    result[dimension] = [...exposure[dimension]];
  }

  for (const relationship of state.relationships) {
    if (relationship.fromEntityId !== targetEntityId) continue;
    const category = categoryByType.get(relationship.type);
    if (category === undefined) continue;

    const latest = relationship.states.at(-1);
    if (latest === undefined) continue;
    const entity = state.entities.find((e) => e.id === relationship.toEntityId);

    for (const dimension of RELATIONSHIP_TYPE_CATEGORY_DIMENSIONS) {
      result[dimension] = result[dimension].filter((e) => e.id !== relationship.toEntityId);
    }
    result[category] = [
      ...result[category],
      {
        id: relationship.toEntityId,
        name: entity?.name ?? relationship.toEntityId,
        weight: latest.confidence?.value ?? 1,
      },
    ];
  }

  return result;
}

export type ExposureResult = { ok: true; exposure: ExposureMap } | { ok: false; error: string };

/** One security's `ExposureMap` (see `quant-sdk-js/src/research/exposure.ts`) as of `asOf`
 * (defaults to now) — architecture/material/component reached within 2 hops, plus its own direct
 * manufacturing/qualification/contract/program relationships and related hypotheses, with any
 * person-assigned relationship-type categories applied on top (see
 * `applyRelationshipTypeCategories`'s own doc comment for why that's a separate pass rather than
 * something inside `computeExposureMap` itself). */
export async function getExposureMap(
  domain: string,
  entityId: string,
  asOf?: string,
): Promise<ExposureResult> {
  const datasetResult = await loadEntityCheckedDataset(domain, entityId);
  if (!datasetResult.ok) return datasetResult;
  const timestamp = asOf ?? new Date().toISOString();
  const state = toQuantResearchState(computeResearchStateAt(datasetResult.dataset, timestamp));
  const exposure = computeExposureMap(state, entityId);

  const assignmentsResult = await listRelationshipTypeCategoryAssignments(domain);
  const categoryByType = assignmentsResult.ok
    ? assignmentsResult.categoryByType
    : new Map<string, RelationshipTypeCategory>();

  return {
    ok: true,
    exposure: applyRelationshipTypeCategories(exposure, state, entityId, categoryByType),
  };
}

export type ResearchDeltaResult =
  { ok: true; delta: ResearchDelta; effects: ModelEffect[] } | { ok: false; error: string };

/** What changed for `targetEntityId` between `from` and `to` (both `ResearchTimestamp`s), and
 * what `interpretResearchDelta` — the SAME anti-inference-guarded interpretation the bot itself
 * runs every round — makes of it. `trackedEntityIds` (for the portfolio/ecosystem scope on each
 * effect) is resolved from this domain's own current tracked-ticker watchlist. */
export async function getResearchDelta(
  domain: string,
  targetEntityId: string,
  from: string,
  to: string,
): Promise<ResearchDeltaResult> {
  const datasetResult = await loadEntityCheckedDataset(domain, targetEntityId);
  if (!datasetResult.ok) return datasetResult;
  const dataset = datasetResult.dataset;

  const tickersResult = await listTrackedTickers(domain);
  const tickers = tickersResult.ok ? tickersResult.tickers : [];
  const { trackedEntityIds } = resolveTrackedEntityIds(dataset, tickers);

  const previousState = toQuantResearchState(computeResearchStateAt(dataset, from));
  const currentState = toQuantResearchState(computeResearchStateAt(dataset, to));
  const delta = computeResearchDelta(previousState, currentState);
  const effects = interpretResearchDelta(delta, currentState, targetEntityId, trackedEntityIds);
  return { ok: true, delta, effects };
}

export interface ThesisGroupsPairwiseOverlap {
  tickerA: string;
  tickerB: string;
  overlap: number;
}

export interface ThesisGroupsValue {
  groups: string[][];
  pairwiseOverlap: ThesisGroupsPairwiseOverlap[];
  /** Tracked tickers with no matching research entity yet — excluded from `groups`/
   * `pairwiseOverlap` rather than silently misrepresented as having zero exposure. */
  unresolvedTickers: string[];
}

export type ThesisGroupsResult =
  { ok: true; value: ThesisGroupsValue } | { ok: false; error: string };

/** Groups this domain's tracked tickers by shared research exposure footprint — the SAME
 * `groupByThesisOverlap` the risk engine's `applyThesisGroupCaps` uses to avoid double-counting
 * one underlying commercialization bet as several independent positions — plus every pair's own
 * causal overlap score for a fuller picture than just the final groups. `minSharedIds` defaults
 * to 1, matching `quant-v0`'s own real `thesisGroupCap.minSharedExposureIds`. */
export async function getThesisGroups(
  domain: string,
  minSharedIds = 1,
  asOf?: string,
): Promise<ThesisGroupsResult> {
  const datasetResult = await loadResearchDataset(domain);
  if (!datasetResult.ok) return datasetResult;
  const dataset = datasetResult.dataset;

  const tickersResult = await listTrackedTickers(domain);
  if (!tickersResult.ok) return tickersResult;

  const { entityIdByTicker } = resolveTrackedEntityIds(dataset, tickersResult.tickers);
  const unresolvedTickers = tickersResult.tickers
    .map((t) => t.ticker)
    .filter((ticker) => !entityIdByTicker.has(ticker));

  const timestamp = asOf ?? new Date().toISOString();
  const state = toQuantResearchState(computeResearchStateAt(dataset, timestamp));

  const exposureByTicker = new Map<string, ExposureMap>();
  for (const [ticker, entityId] of entityIdByTicker) {
    exposureByTicker.set(ticker, computeExposureMap(state, entityId));
  }
  const footprintByTicker = new Map(
    [...exposureByTicker].map(([ticker, exposure]) => [ticker, exposureFootprint(exposure)]),
  );

  const groups = groupByThesisOverlap(footprintByTicker, minSharedIds);

  const tickers = [...exposureByTicker.keys()];
  const pairwiseOverlap: ThesisGroupsPairwiseOverlap[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const tickerA = tickers[i];
      const tickerB = tickers[j];
      if (tickerA === undefined || tickerB === undefined) continue; // unreachable given the loop bounds
      const exposureA = exposureByTicker.get(tickerA);
      const exposureB = exposureByTicker.get(tickerB);
      if (exposureA === undefined || exposureB === undefined) continue; // unreachable — built from the same keys
      const overlap = computeCausalOverlap(exposureA, exposureB);
      if (overlap > 0) pairwiseOverlap.push({ tickerA, tickerB, overlap });
    }
  }
  pairwiseOverlap.sort((a, b) => b.overlap - a.overlap);

  return { ok: true, value: { groups, pairwiseOverlap, unresolvedTickers } };
}
