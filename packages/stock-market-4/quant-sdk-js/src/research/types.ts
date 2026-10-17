/**
 * A hand-declared local copy of the parts of `@quant-fusion/research-core`'s schema
 * (packages/stock-market-4/research/core/src/**) this bot actually reads — not imported, for the same reason
 * `../marketTypes.ts` doesn't import `@quant-fusion/game-stock-market-4`: `bots/**` isn't a Yarn
 * workspace member. This is also the architectural boundary the task requires: the GAME
 * (`stock-market-4`) never knows this shape exists — `observation.research` is `unknown` to it —
 * but a bot is explicitly allowed to know and interpret the research schema. A real match's
 * `config.researchTimeline[].payload` is produced by calling research-core's own
 * `createResearchSnapshot(dataset, timestamp)` outside the game entirely; what lands in
 * `observation.research` is exactly that function's return value, field-for-field as declared
 * in packages/stock-market-4/research/core/src/snapshot/snapshot.ts and state/state.ts.
 */

export type ResearchTimestamp = string;
export type ResearchId = string;

export interface Confidence {
  value: number;
  basis?: string;
}

export interface ResearchEntity {
  id: ResearchId;
  type: string;
  name: string;
  description?: string;
  recordedAt: ResearchTimestamp;
  validFrom?: ResearchTimestamp;
  validTo?: ResearchTimestamp;
  metadata?: Record<string, unknown>;
}

export interface RelationshipState {
  status: string;
  recordedAt: ResearchTimestamp;
  effectiveFrom: ResearchTimestamp;
  effectiveTo?: ResearchTimestamp;
  evidenceIds: ResearchId[];
  confidence?: Confidence;
  metadata?: Record<string, unknown>;
}

export interface ResearchRelationship {
  id: ResearchId;
  type: string;
  fromEntityId: ResearchId;
  toEntityId: ResearchId;
  states: RelationshipState[];
  metadata?: Record<string, unknown>;
}

export interface EvidenceSource {
  name: string;
  url?: string;
  [key: string]: unknown;
}

export interface Evidence {
  id: ResearchId;
  observedAt: ResearchTimestamp;
  publishedAt?: ResearchTimestamp;
  availableAt?: ResearchTimestamp;
  source: EvidenceSource;
  description: string;
  entityIds: ResearchId[];
  metadata?: Record<string, unknown>;
}

export interface HypothesisAssessment {
  timestamp: ResearchTimestamp;
  confidence: Confidence;
  supportingEvidenceIds: ResearchId[];
  contradictingEvidenceIds: ResearchId[];
  rationale?: string;
}

export interface ResearchHypothesis {
  id: ResearchId;
  name: string;
  statement: string;
  status: string;
  createdAt: ResearchTimestamp;
  assessments: HypothesisAssessment[];
  falsifiers?: { description: string; evidenceIds?: ResearchId[] }[];
  metadata?: Record<string, unknown>;
}

export interface ResearchEvent {
  id: ResearchId;
  timestamp: ResearchTimestamp;
  type: string;
  entityIds: ResearchId[];
  payload: Record<string, unknown>;
  evidenceIds: ResearchId[];
}

export interface ResearchQuestion {
  id: ResearchId;
  code?: string;
  question: string;
  status: 'open' | 'answered' | 'retired';
  createdAt: ResearchTimestamp;
  relatedEntityIds?: ResearchId[];
  relatedHypothesisIds?: ResearchId[];
  metadata?: Record<string, unknown>;
}

export interface ResearchAssertion {
  id: ResearchId;
  statement: string;
  status: string;
  createdAt: ResearchTimestamp;
  evidenceIds: ResearchId[];
  entityIds?: ResearchId[];
  relationshipIds?: ResearchId[];
  confidence?: Confidence;
}

/** What was knowable as of `timestamp` — see packages/stock-market-4/research/core/src/state/state.ts. This
 * bot only reads entities/relationships/evidence/hypotheses/events/questions; assumptions/
 * variables/models/scenarios exist in the real schema but nothing in v0.1 needs them yet. */
export interface ResearchState {
  timestamp: ResearchTimestamp;
  entities: ResearchEntity[];
  relationships: ResearchRelationship[];
  evidence: Evidence[];
  assertions: ResearchAssertion[];
  hypotheses: ResearchHypothesis[];
  events: ResearchEvent[];
  questions: ResearchQuestion[];
}

/** The self-contained, opaque-to-the-game payload a real match puts in
 * `config.researchTimeline[].payload` — see packages/stock-market-4/research/core/src/snapshot/snapshot.ts. */
export interface ResearchSnapshot {
  datasetId: string;
  datasetVersion: string;
  timestamp: ResearchTimestamp;
  state: ResearchState;
}

/**
 * Narrows `observation.research` (genuinely `unknown` to the game) to a `ResearchSnapshot` this
 * bot can reason about — a structural sanity check, not full schema validation (this bot doesn't
 * own that schema, research-core does). Returns `undefined` for anything that doesn't look like a
 * snapshot, e.g. before the match's first research entry (see `../marketTypes.ts`'s
 * `StockMarket4Observation.research`), rather than throwing.
 */
export function asResearchSnapshot(research: unknown): ResearchSnapshot | undefined {
  if (research === null || typeof research !== 'object') return undefined;
  // `Record<string, unknown>`, not `Partial<ResearchSnapshot>` — `research` is genuinely
  // untrusted here, and casting straight to `Partial<ResearchSnapshot>` would tell TypeScript
  // `.state` can only ever be `ResearchState | undefined`, silently hiding the very real
  // `typeof null === 'object'` case a malformed payload could still contain.
  const candidate = research as Record<string, unknown>;
  if (
    typeof candidate.datasetId !== 'string' ||
    typeof candidate.timestamp !== 'string' ||
    candidate.state === null ||
    typeof candidate.state !== 'object'
  ) {
    return undefined;
  }
  return candidate as unknown as ResearchSnapshot;
}
