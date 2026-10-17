import type { ResearchDelta } from './delta.js';
import type { Evidence, ResearchHypothesis, ResearchState } from './types.js';

/**
 * A single, inspectable strategy-relevant effect derived from a research change (spec §8).
 * `magnitude`/`confidence` are always sourced from something research actually recorded — a
 * relationship state's own `confidence`, or a hypothesis's own assessed confidence — never an
 * invented number. `direction: 'neutral'` with `magnitude: 0` is how this bot represents "we
 * explicitly checked, and this stays unchanged" — a real, reportable effect in its own right, not
 * the absence of one (see the anti-inference confirmation below).
 */
export interface ModelEffect {
  factor: string;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: number;
  confidence: number;
  rationale: string;
  /** The hypothesis this effect came from, if any — lets a decision loop pull that hypothesis's
   * own `falsifiers` into the trading decision's explanation (spec §16) without re-parsing
   * `factor`'s string form. */
  sourceHypothesisId?: string;
  /** Whether the fact driving this effect is a direct portfolio-company relationship/fact
   * ('portfolio' — every entity involved besides `targetEntityId` is itself one of the domain's
   * OWN tracked securities, see `interpretResearchDelta`'s `trackedEntityIds` parameter) or draws
   * on the broader research causal graph ('ecosystem' — an untracked counterparty, institution, or
   * program is involved). Purely descriptive: never adjusts `magnitude`/`confidence` itself, which
   * must only ever come from what research actually recorded (see this file's own module doc
   * comment) — a downstream consumer (e.g. `../valuation/companyValue.ts`) can weight by it
   * explicitly if it chooses to. Optional (rather than required) so hand-constructed `ModelEffect`
   * fixtures elsewhere (e.g. valuation/alpha tests exercising downstream logic in isolation,
   * unrelated to research scope) don't need one — every effect `interpretResearchDelta` itself
   * produces always sets it. */
  scope?: 'portfolio' | 'ecosystem';
}

/** An effect's scope is 'ecosystem' the moment ANY involved entity id (besides the target itself)
 * falls outside `trackedEntityIds` — one non-tracked party is enough to mean the fact draws on the
 * broader causal graph, not a purely portfolio-internal relationship. */
function scopeOf(
  entityIds: readonly string[],
  trackedEntityIds: ReadonlySet<string>,
): 'portfolio' | 'ecosystem' {
  return entityIds.every((id) => trackedEntityIds.has(id)) ? 'portfolio' : 'ecosystem';
}

/** Relationship types this interpreter recognizes as "our target company acquired something" —
 * domain-defined by a research package's own vocabulary, not enumerated by research-core itself.
 * Extend this set to support a later acquisition/event; the matching logic below never
 * special-cases a specific company, date, or acquisition. */
const ACQUISITION_RELATIONSHIP_TYPES = new Set(['acquires']);

/** A relationship status matching this indicates a DOWNGRADE/loss (cancelled, terminated, lost,
 * ended, ...) — checked BEFORE treating any supplier-type status change as positive. Without
 * this, a real downgrade (e.g. "production contract" -> "cancelled") would be misread as bullish
 * capture evidence purely because "the status changed," which is exactly the kind of
 * directionless reading spec §6/§39 warns against. */
const NEGATIVE_STATUS_PATTERN =
  /cancel|terminat|lost|ended|discontinu|lapsed|withdrawn|declined|reject/i;

/** Relationship types this interpreter treats as "a specific fusion-program supplier
 * relationship" — the ones that must NEVER be silently upgraded just because a company's
 * manufacturing capability increased (spec §5/§19's core anti-inference requirement). */
const SUPPLIER_RELATIONSHIP_TYPE_PATTERN = /customer|qualification|supplies|supplier/i;

function indexEvidenceById(state: ResearchState): Map<string, Evidence> {
  return new Map(state.evidence.map((evidence) => [evidence.id, evidence]));
}

/**
 * A hypothesis "relates to" `entityId` if its most recent assessment cites supporting evidence
 * that itself names that entity — research-core's `ResearchHypothesis` has no direct entity link
 * of its own (only `ResearchQuestion` does), so evidence is the one real bridge between "a belief"
 * and "the thing that belief is about."
 */
function hypothesisRelatesToEntity(
  hypothesis: ResearchHypothesis,
  entityId: string,
  evidenceById: Map<string, Evidence>,
): boolean {
  const latest = hypothesis.assessments.at(-1);
  if (latest === undefined) return false;
  return latest.supportingEvidenceIds.some((id) =>
    evidenceById.get(id)?.entityIds.includes(entityId),
  );
}

/**
 * Transforms a `ResearchDelta` into explicit `ModelEffect`s for `targetEntityId` (spec §8) — the
 * whole point of keeping this a separate step from valuation: every economic assumption downstream
 * traces back to one of these, each with its own rationale, rather than research changes feeding
 * a black-box valuation update directly.
 *
 * Three families of effect, all driven entirely by what's actually in `currentState`:
 *
 * 1. **Acquisition-type relationship changes** where `targetEntityId` is the acquirer: a positive
 *    capability effect (magnitude/confidence from the relationship's own recorded `confidence`,
 *    defaulting to full confidence for an unqualified recorded fact) — immediately followed by an
 *    explicit NEUTRAL effect for every supplier/customer/qualification-type relationship already
 *    on record for the acquired entity, confirming each one stays exactly as recorded. This is
 *    what actually enforces "capability increasing must never imply a supplier relationship
 *    increasing" — not an absence of code, a present, inspectable effect saying so.
 * 2. **A supplier/customer/qualification/contract-type relationship change** FROM
 *    `targetEntityId` (new, or a status transition) — magnitude/confidence from the relationship's
 *    own recorded confidence. Kept as its own factor (`supplier_capture`), distinct from and
 *    stronger-weighted downstream than a generic hypothesis effect (see
 *    `../valuation/companyValue.ts`), since qualification/contract evidence is a materially higher
 *    tier than capability/geographic/historical evidence (spec §10).
 * 3. **Hypothesis confidence changes** that relate to `targetEntityId` (via evidence, see above):
 *    one positive effect per changed hypothesis, magnitude and confidence both taken directly from
 *    the hypothesis's own latest assessed confidence — never re-derived or rescaled.
 *
 * `trackedEntityIds` is this domain's own tracked-security universe (every `ModelEffect.scope`
 * classification is computed against it) — a caller normally derives it from its own config's
 * securities list (`new Set(config.securities.map(s => s.targetEntityId))`), never a hardcoded
 * constant, so this stays correct for any domain's universe automatically.
 */
export function interpretResearchDelta(
  delta: ResearchDelta,
  currentState: ResearchState,
  targetEntityId: string,
  trackedEntityIds: ReadonlySet<string>,
): ModelEffect[] {
  const effects: ModelEffect[] = [];
  const entitiesById = new Map(currentState.entities.map((entity) => [entity.id, entity]));
  const relationshipsById = new Map(currentState.relationships.map((r) => [r.id, r]));
  const evidenceLookup = indexEvidenceById(currentState);

  for (const change of delta.changedRelationships) {
    if (change.fromEntityId !== targetEntityId) continue;
    if (!ACQUISITION_RELATIONSHIP_TYPES.has(change.type)) continue;

    const acquirerName = entitiesById.get(change.fromEntityId)?.name ?? change.fromEntityId;
    const acquiredName = entitiesById.get(change.toEntityId)?.name ?? change.toEntityId;
    const relationshipConfidence =
      relationshipsById.get(change.relationshipId)?.states.at(-1)?.confidence?.value ?? 1;

    effects.push({
      factor: 'manufacturing_capability',
      direction: 'positive',
      magnitude: relationshipConfidence,
      confidence: relationshipConfidence,
      rationale: `${acquirerName} recorded a new "${change.type}" relationship (status "${change.currentStatus}") with ${acquiredName} — increases manufacturing breadth/capability.`,
      scope: scopeOf([change.toEntityId], trackedEntityIds),
    });

    // The anti-inference confirmation: every supplier/qualification/customer relationship
    // already on record FROM the acquired entity is reported here, unmodified, so "capability up"
    // never silently reads as "supplier relationship up" — see this function's own doc comment.
    for (const relationship of currentState.relationships) {
      if (relationship.fromEntityId !== change.toEntityId) continue;
      if (!SUPPLIER_RELATIONSHIP_TYPE_PATTERN.test(relationship.type)) continue;
      const latestState = relationship.states.at(-1);
      if (latestState === undefined) continue;

      const counterpartyName =
        entitiesById.get(relationship.toEntityId)?.name ?? relationship.toEntityId;
      effects.push({
        factor: `relationship:${relationship.type}:${relationship.toEntityId}`,
        direction: 'neutral',
        magnitude: 0,
        confidence: 1,
        rationale: `${acquiredName} -> ${counterpartyName} "${relationship.type}" stays "${latestState.status}" — capability alone never establishes a customer relationship, qualification, or contract.`,
        scope: scopeOf([change.toEntityId, relationship.toEntityId], trackedEntityIds),
      });
    }
  }

  // Supplier-capture effect: a qualification/customer/supplier/contract-type relationship FROM
  // the target entity whose status genuinely CHANGED (new, or transitioned — e.g. "qualification
  // track" -> "production contract") is materially stronger evidence than a generic hypothesis
  // confidence bump (spec §6/§10 — qualification/contract evidence outranks capability/geographic/
  // historical evidence). Distinct from the acquisition branch above: this is the target entity's
  // OWN supplier relationship changing, not something it acquired. Still never invents anything —
  // `delta.changedRelationships` only ever reports a status that research-core itself recorded.
  for (const change of delta.changedRelationships) {
    if (change.fromEntityId !== targetEntityId) continue;
    if (ACQUISITION_RELATIONSHIP_TYPES.has(change.type)) continue; // already handled above
    if (!SUPPLIER_RELATIONSHIP_TYPE_PATTERN.test(change.type)) continue;

    const counterpartyName = entitiesById.get(change.toEntityId)?.name ?? change.toEntityId;
    const relationshipConfidence =
      relationshipsById.get(change.relationshipId)?.states.at(-1)?.confidence?.value ?? 1;
    const isDowngrade = NEGATIVE_STATUS_PATTERN.test(change.currentStatus);

    effects.push({
      factor: 'supplier_capture',
      direction: isDowngrade ? 'negative' : 'positive',
      magnitude: relationshipConfidence,
      confidence: relationshipConfidence,
      rationale: `${entitiesById.get(targetEntityId)?.name ?? targetEntityId} -> ${counterpartyName} "${change.type}" changed ${change.previousStatus === null ? '(new relationship)' : `from "${change.previousStatus}"`} to "${change.currentStatus}" — a supplier/customer/qualification-tier change (${isDowngrade ? 'a downgrade' : 'an upgrade'}), stronger evidence than a generic hypothesis shift.`,
      scope: scopeOf([change.toEntityId], trackedEntityIds),
    });
  }

  for (const change of delta.changedHypotheses) {
    const hypothesis = currentState.hypotheses.find((h) => h.id === change.hypothesisId);
    if (hypothesis === undefined) continue;
    if (!hypothesisRelatesToEntity(hypothesis, targetEntityId, evidenceLookup)) continue;

    // Scope is drawn from the latest assessment's own supporting evidence — the same evidence
    // `hypothesisRelatesToEntity` just checked — so a hypothesis grounded ENTIRELY in facts about
    // tracked companies is 'portfolio', while one that also cites an untracked counterparty or
    // institution (the actual "causal research graph" the ecosystem layer exists to capture) is
    // 'ecosystem'.
    const supportingEntityIds = (
      hypothesis.assessments.at(-1)?.supportingEvidenceIds ?? []
    ).flatMap((id) => evidenceLookup.get(id)?.entityIds ?? []);

    effects.push({
      factor: `hypothesis:${hypothesis.name}`,
      direction: 'positive',
      magnitude: change.currentConfidence,
      confidence: change.currentConfidence,
      rationale: change.rationale ?? hypothesis.statement,
      sourceHypothesisId: hypothesis.id,
      scope: scopeOf(
        supportingEntityIds.length > 0 ? supportingEntityIds : [targetEntityId],
        trackedEntityIds,
      ),
    });
  }

  return effects;
}
