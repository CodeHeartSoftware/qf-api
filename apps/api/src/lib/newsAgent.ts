import { fetchGoogleNews } from './googleNewsRss.js';
import {
  listTrackedTickers,
  loadResearchDataset,
  listEventTypes,
  listRelationshipTypes,
} from './researchStore.js';
import { chat, type LlmProvider } from './llm/index.js';

const ITEMS_PER_TICKER = 6; // matches routes/news.ts's own feed size
const MAX_ARTICLE_CHARS = 6000;
const USER_AGENT = 'Mozilla/5.0 (compatible; QuantFusionNewsAgent/1.0)';

const HYPOTHESIS_STATUSES = [
  'proposed',
  'active',
  'supported',
  'weakened',
  'falsified',
  'accepted',
  'rejected',
  'retired',
];

// --- Id-building helpers, ported 1:1 from `quant-fusion-ui`'s
// `researchFormShared.tsx` (that file's own comment explains why: the browser bundle can't
// import this Node-side module, so the same formulas are kept in sync by hand rather than
// shared) — an id minted here for the same input must match what a human using the manual
// "Add to Research" flow would have produced. ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36).slice(0, 6);
}

function buildEntityId(name: string): string {
  return `entity-${slugify(name)}`;
}

function buildEvidenceId(topic: string, publishedDate: string, link: string): string {
  return `evidence-${slugify(topic)}-${publishedDate}-${shortHash(link)}`;
}

function buildNewsEventId(ticker: string, eventType: string, link: string): string {
  return `event-${slugify(ticker)}-${slugify(eventType)}-${shortHash(link)}`;
}

function buildNewsRelationshipId(primaryTicker: string, counterpartyName: string): string {
  return `rel-${slugify(primaryTicker)}-${slugify(counterpartyName)}`;
}

function buildNewsHypothesisId(nameOrTicker: string, link: string): string {
  return `hypothesis-${slugify(nameOrTicker)}-${shortHash(link)}`;
}

function normalizeEventType(rawType: string): string {
  return rawType.trim().toUpperCase().replace(/\s+/g, '_');
}

// Relationship types are literal lowercase words in this dataset's own convention
// (`"supplies"`, `"customer"`, `"qualification"`, `"acquires"`) — unlike event types, never
// SCREAMING_SNAKE_CASE.
function normalizeRelationshipType(rawType: string): string {
  return rawType.trim().toLowerCase();
}

function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [];
  const parts = trimmed
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 1 ? [trimmed, ...parts] : [trimmed];
}

function findMatchingEntity(
  entities: { id: string; name: string }[],
  companyName: string,
  ticker?: string,
): { id: string; name: string } | undefined {
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

  if (ticker === undefined) return undefined;
  const normalizedTicker = ticker.trim().toLowerCase();
  return entities.find((e) =>
    nameVariants(e.name).some((variant) => variant.toLowerCase() === normalizedTicker),
  );
}

// --- Plain-text article extraction: a regex tag-strip, not an HTML parser dependency — see
// this feature's plan for why (only run on the handful of articles triage actually picked, on
// mostly server-rendered publisher pages; a JS-rendered or paywalled page just yields thin/empty
// text, which each `buildXCandidate` treats the same as "not enough to go on" and skips). ---

const NOISE_TAG_REGEX = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&mdash;': '—',
  '&ndash;': '–',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&[a-z0-9#]+;/gi, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function stripHtml(html: string): string {
  const withoutNoise = html.replace(NOISE_TAG_REGEX, ' ');
  const withoutTags = withoutNoise.replace(HTML_TAG_REGEX, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

const ARTICLE_FETCH_TIMEOUT_MS = 15_000;

/** A hard timeout, not just a slow-but-eventually-ok wait — these links point at arbitrary
 * third-party publisher sites this app doesn't control, and a single one hanging (or a slow
 * redirect chain) would otherwise stall the whole run indefinitely; each candidate-building step's
 * own try/catch already treats a failed fetch as "skip this one," not a fatal error. */
async function fetchArticleText(link: string): Promise<string> {
  const res = await fetch(link, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`article fetch failed with status ${String(res.status)}`);
  }
  const html = await res.text();
  return stripHtml(html).slice(0, MAX_ARTICLE_CHARS);
}

// --- Types ---

export interface HeadlineRef {
  ticker: string;
  companyName: string;
  title: string;
  source: string;
  publishedAt: string;
  link: string;
}

interface EntityDraft {
  id: string;
  type: string;
  name: string;
  recordedAt: string;
}

interface EvidenceDraft {
  id: string;
  observedAt: string;
  publishedAt: string;
  source: { name: string; uri: string };
  description: string;
  entityIds: string[];
}

interface CandidateBase {
  ticker: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  rationale: string;
  proposedEntities: EntityDraft[];
  proposedEvidence: EvidenceDraft;
}

export type NewsAgentCandidate =
  | (CandidateBase & {
      kind: 'event';
      isNewEventType: boolean;
      proposedEvent: {
        id: string;
        timestamp: string;
        type: string;
        entityIds: string[];
        payload: Record<string, unknown>;
        evidenceIds: string[];
      };
    })
  | (CandidateBase & {
      kind: 'relationship';
      isNewRelationshipType: boolean;
      isNewRelationship: boolean;
      proposedRelationship: {
        id: string;
        type: string;
        fromEntityId: string;
        toEntityId: string;
        states: {
          status: string;
          recordedAt: string;
          effectiveFrom: string;
          evidenceIds: string[];
          confidence: { value: number };
        }[];
      };
    })
  | (CandidateBase & {
      kind: 'hypothesis';
      isNewHypothesis: boolean;
      proposedHypothesis: {
        id: string;
        name: string;
        statement: string;
        status: string;
        createdAt: string;
        assessments: {
          timestamp: string;
          confidence: { value: number };
          supportingEvidenceIds: string[];
          contradictingEvidenceIds: string[];
          rationale?: string;
          status?: string;
        }[];
      };
    });

export interface NewsAgentRunResult {
  candidates: NewsAgentCandidate[];
  skippedCount: number;
  model: string;
  /** How many headlines the feed actually had this run, and how many of those triage picked to
   * read in full — surfaced so "found nothing" is never a black box: a `articlesRead` of 0 with
   * `headlineCount` > 0 means triage itself judged everything routine (a real, honest outcome,
   * distinct from `triageError`'s "couldn't even judge"); a nonzero `articlesRead` with 0
   * candidates means it DID read some articles and concluded none were schema-worthy. */
  headlineCount: number;
  articlesRead: number;
  /** Set only when triage itself failed outright after every retry (an Ollama-side error, not
   * "the model read everything and found nothing new") — the UI shows this distinctly instead of
   * a misleading "N articles skipped as routine," since no article was actually read this run. */
  triageError?: string;
}

interface DomainEntity {
  id: string;
  name: string;
}
interface DomainRelationship {
  id: string;
  type: string;
  fromEntityId: string;
  toEntityId: string;
  status: string;
}
interface DomainHypothesis {
  id: string;
  name: string;
  statement: string;
  status: string;
  createdAt: string;
}

interface DomainContext {
  entities: DomainEntity[];
  eventTypes: string[];
  relationshipTypes: string[];
  relationships: DomainRelationship[];
  hypotheses: DomainHypothesis[];
}

/** Every tracked ticker's own recent headlines, gathered the same way `GET /api/news/:domain`
 * already does — a ticker whose feed fails to fetch just contributes nothing, same as that
 * route's own per-ticker error handling. */
async function gatherHeadlines(domain: string): Promise<HeadlineRef[]> {
  const tickersResult = await listTrackedTickers(domain);
  if (!tickersResult.ok) {
    throw new Error(tickersResult.error);
  }
  const perTicker = await Promise.all(
    tickersResult.tickers.map(async (tracked): Promise<HeadlineRef[]> => {
      try {
        const items = await fetchGoogleNews(`"${tracked.companyName}"`, ITEMS_PER_TICKER);
        return items.map((item) => ({
          ticker: tracked.ticker,
          companyName: tracked.companyName,
          ...item,
        }));
      } catch {
        return [];
      }
    }),
  );
  return perTicker.flat();
}

const TRIAGE_SYSTEM_PROMPT = `You are a financial news triage assistant for an investment research system.
You will be given a numbered list of news headlines about companies in an investor's tracked universe.
Decide which headlines describe a genuine, discrete news event (an announcement, contract, earnings result, leadership change, litigation, regulatory action, partnership, acquisition, etc.) worth reading in full — as opposed to routine noise that is NOT real news:
- A stock-price/market summary ("XYZ shares close up 3%", "why is XYZ stock up today", a "top movers" roundup).
- A pure technical-analysis or price-target opinion piece with no new underlying fact.
- A near-duplicate of another headline already in the list.

Return ONLY a JSON object of this exact shape, nothing else — a flat array of the worth-reading indices, omitting every routine/noise headline:
{ "worthReading": [<index>, <index>, ...] }
If none are worth reading, return { "worthReading": [] }.`;

const EXCLUDE_KEY_HINT = /exclud|skip|reject|omit|drop|noise|discard|irrelevant/i;
const INCLUDE_KEY_HINT = /select|worth|read|includ|keep|relevant/i;

/** Pulls indices out of whatever shape the model actually returned — a small local model
 * reliably produces syntactically valid JSON (`format: 'json'` guarantees that much) but not
 * always the exact requested field name/shape (observed with `qwen3:latest`: one run substituted
 * its own `selected_indices` key for the requested `worthReading`). Scans every top-level array-
 * valued field for one that yields valid indices, accepting either a bare number or an
 * `{index}`-shaped object per entry, rather than trusting one hardcoded key name.
 *
 * Also observed: the model sometimes returns BOTH a "keep these" list AND an "excluded/skip
 * these" list side by side (its own extra work showing its reasoning) — both are equally
 * "the first array with valid indices" to a naive scan, and picking whichever happened to come
 * first in the model's own key order would silently invert the result on a run where the
 * excluded list came first (every headline it correctly rejected would get "read," and the ones
 * actually worth reading would never be touched — indistinguishable from "found nothing" without
 * this fix). A key name is judged by what it MEANS: an include-shaped name wins outright; an
 * exclude-shaped name is skipped in favor of any other candidate array; only when every array's
 * name is ambiguous does the first one win. */
function extractIndices(parsed: unknown, max: number): number[] {
  if (typeof parsed !== 'object' || parsed === null) return [];

  const candidates = Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, value]) => ({
      key,
      indices: value
        .map((entry) =>
          typeof entry === 'number' ? entry : (entry as { index?: unknown } | null)?.index,
        )
        .filter(
          (index): index is number =>
            typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < max,
        ),
    }))
    .filter((c) => c.indices.length > 0);

  const included = candidates.find(
    (c) => INCLUDE_KEY_HINT.test(c.key) && !EXCLUDE_KEY_HINT.test(c.key),
  );
  if (included !== undefined) return [...new Set(included.indices)];

  const notExcluded = candidates.find((c) => !EXCLUDE_KEY_HINT.test(c.key));
  const chosen = notExcluded ?? candidates[0];
  return chosen !== undefined ? [...new Set(chosen.indices)] : [];
}

const TRIAGE_ATTEMPTS = 2;

/** Returns `indices: undefined` (never `[]`) specifically when every attempt failed outright —
 * distinct from a real, successful "nothing worth reading today" — so the caller can tell a
 * transient failure apart from a genuinely quiet news day instead of both looking like "0
 * candidates, everything skipped." A real, observed failure mode this retries past: Ollama's own
 * decode guard can abort mid-generation on a long prompt (66 headlines at once) with "prediction
 * aborted, token repeat limit reached" — a known quantized-small-model artifact, not a real error
 * about the request itself, and often just doesn't recur on a fresh attempt (different sampling
 * draw). `chat()` itself throwing (this) and a malformed/unparseable response (`extractIndices`
 * returning cleanly) are both retried the same way. */
async function triage(
  rootDir: string,
  provider: LlmProvider,
  model: string,
  headlines: HeadlineRef[],
): Promise<{ indices: number[] | undefined; error: string | undefined }> {
  if (headlines.length === 0) return { indices: [], error: undefined };
  const listing = headlines
    .map(
      (h, i) =>
        `${String(i)}. [${h.ticker}] ${h.title} — ${h.source} (${h.publishedAt.slice(0, 10)})`,
    )
    .join('\n');

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= TRIAGE_ATTEMPTS; attempt++) {
    try {
      const raw = await chat(rootDir, provider, model, TRIAGE_SYSTEM_PROMPT, listing);
      return { indices: extractIndices(JSON.parse(raw), headlines.length), error: undefined };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(
        `news-agent: triage attempt ${String(attempt)}/${String(TRIAGE_ATTEMPTS)} failed: ${lastError}`,
      );
    }
  }
  return { indices: undefined, error: lastError };
}

// --- Per-article extraction: one LLM call proposes up to three independent candidates (an
// event, a relationship, and a hypothesis update are NOT mutually exclusive for one article —
// e.g. a new supply contract article can warrant all three at once), each its own Go/No-Go. ---

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
}

function readSection(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function buildExtractionSystemPrompt(domainContext: DomainContext): string {
  const entityLines =
    domainContext.entities.length > 0
      ? domainContext.entities.map((e) => `- ${e.id} — ${e.name}`).join('\n')
      : '(none recorded yet)';
  const eventTypeLines =
    domainContext.eventTypes.length > 0
      ? domainContext.eventTypes.join(', ')
      : '(none registered yet)';
  const relationshipTypeLines =
    domainContext.relationshipTypes.length > 0
      ? domainContext.relationshipTypes.join(', ')
      : '(none registered yet)';
  const relationshipLines =
    domainContext.relationships.length > 0
      ? domainContext.relationships
          .map((r) => `- ${r.id}: ${r.fromEntityId} —(${r.type}, ${r.status})→ ${r.toEntityId}`)
          .join('\n')
      : '(none recorded yet)';
  const hypothesisLines =
    domainContext.hypotheses.length > 0
      ? domainContext.hypotheses
          .map((h) => `- ${h.id} — "${h.name}" (${h.status}): ${h.statement}`)
          .join('\n')
      : '(none recorded yet)';

  return `You are a research analyst for an investment research system. You will be given ONE news article about a company in a tracked investment universe, plus the system's current state. Propose up to three INDEPENDENT updates this article might warrant — an event, a relationship, and a hypothesis update are not mutually exclusive; propose whichever of these the article genuinely supports, and null for the rest.

Entities already known to the research system (reuse an existing one's exact name if this article is about it; only propose a brand-new company name if it's genuinely not one of these):
${entityLines}

Event types already registered — STRONGLY PREFER reusing one of these if the article's occurrence matches it; only propose a new type as a last resort, phrased as SCREAMING_SNAKE_CASE:
${eventTypeLines}

Relationship types already registered — STRONGLY PREFER reusing one of these (lowercase words like "supplies", "customer", "qualification", "acquires"); only propose a new one as a last resort:
${relationshipTypeLines}

Relationships already on record (counterparty entity, type, current status):
${relationshipLines}

Hypotheses already on record (id, name, current status, statement):
${hypothesisLines}

Rules (violating any of these for a given section means you must return null for that section):
- Evidence, not interpretation: describe only what the article actually says, never what you conclude from it.
- Only report if the tracked company itself (or a named counterparty in a contract/relationship WITH the tracked company) is a direct party — general industry background does not count.
- Never invent facts, dates, or precision the article doesn't state.
- Capability does NOT establish qualification. Qualification does NOT establish a customer relationship. A customer relationship does NOT establish a contract. Only propose a relationship (new or a status change) when the article ITSELF states that specific tier — never round up a framework agreement or qualification-in-progress to a firm contract.
- Only propose a hypothesis update when the article provides a genuinely new, material fact bearing on an EXISTING hypothesis's confidence (cite its exact id from the list above), or suggests a well-formed brand-new hypothesis — not a vague, low-confidence guess.

Return ONLY a JSON object of this exact shape, nothing else:
{
  "skip": <true if NONE of the three sections below apply>,
  "primaryEntityName": "<the tracked company's name, exactly as it should be recorded>",
  "event": null | { "eventType": "...", "description": "...", "rationale": "..." },
  "relationship": null | {
    "counterpartyName": "...",
    "relationshipType": "...",
    "status": "<e.g. 'qualification track', 'framework agreement', 'production contract' — must match what the article itself states>",
    "confidence": <0-1>,
    "description": "...",
    "rationale": "..."
  },
  "hypothesis": null | {
    "existingHypothesisId": "<an exact id from the list above, or null>",
    "name": "<short handle, only for a brand-new hypothesis, else null>",
    "statement": "<one-sentence testable claim, only for a brand-new hypothesis, else null>",
    "statusChange": "<one of proposed/active/supported/weakened/falsified/accepted/rejected/retired, or null for no change>",
    "confidence": <0-1>,
    "description": "...",
    "rationale": "..."
  }
}`;
}

function buildEventCandidate(
  headline: HeadlineRef,
  section: Record<string, unknown>,
  primaryEntityId: string,
  domainContext: DomainContext,
): NewsAgentCandidate | undefined {
  const eventType = readString(section, 'eventType');
  const description = readString(section, 'description');
  if (eventType === undefined || description === undefined) return undefined;
  const rationale = readString(section, 'rationale') ?? '';

  const normalizedType = normalizeEventType(eventType);
  const isNewEventType = !domainContext.eventTypes.includes(normalizedType);
  const publishedDate = headline.publishedAt.slice(0, 10);
  const evidenceId = buildEvidenceId(headline.ticker, publishedDate, headline.link);

  return {
    kind: 'event',
    ticker: headline.ticker,
    title: headline.title,
    link: headline.link,
    source: headline.source,
    publishedAt: headline.publishedAt,
    rationale,
    proposedEntities: [],
    isNewEventType,
    proposedEvidence: {
      id: evidenceId,
      observedAt: `${publishedDate}T00:00:00Z`,
      publishedAt: `${publishedDate}T00:00:00Z`,
      source: { name: headline.source, uri: headline.link },
      description,
      entityIds: [primaryEntityId],
    },
    proposedEvent: {
      id: buildNewsEventId(headline.ticker, normalizedType, headline.link),
      timestamp: `${publishedDate}T00:00:00Z`,
      type: normalizedType,
      entityIds: [primaryEntityId],
      payload: {},
      evidenceIds: [evidenceId],
    },
  };
}

function buildRelationshipCandidate(
  headline: HeadlineRef,
  section: Record<string, unknown>,
  primaryEntityId: string,
  domainContext: DomainContext,
): NewsAgentCandidate | undefined {
  const counterpartyName = readString(section, 'counterpartyName');
  const relationshipType = readString(section, 'relationshipType');
  const status = readString(section, 'status');
  const description = readString(section, 'description');
  if (
    counterpartyName === undefined ||
    relationshipType === undefined ||
    status === undefined ||
    description === undefined
  ) {
    return undefined;
  }
  const rationale = readString(section, 'rationale') ?? '';
  const confidence = readNumber(section, 'confidence') ?? 0.7;

  const existingCounterparty = findMatchingEntity(domainContext.entities, counterpartyName);
  const counterpartyEntityId = existingCounterparty?.id ?? buildEntityId(counterpartyName);
  const existingRelationship = domainContext.relationships.find(
    (r) =>
      (r.fromEntityId === primaryEntityId && r.toEntityId === counterpartyEntityId) ||
      (r.fromEntityId === counterpartyEntityId && r.toEntityId === primaryEntityId),
  );

  const normalizedType = normalizeRelationshipType(relationshipType);
  const finalType = existingRelationship?.type ?? normalizedType;
  const isNewRelationshipType =
    existingRelationship === undefined && !domainContext.relationshipTypes.includes(finalType);

  const publishedDate = headline.publishedAt.slice(0, 10);
  const evidenceId = buildEvidenceId(`${headline.ticker}-rel`, publishedDate, headline.link);

  return {
    kind: 'relationship',
    ticker: headline.ticker,
    title: headline.title,
    link: headline.link,
    source: headline.source,
    publishedAt: headline.publishedAt,
    rationale,
    isNewRelationshipType,
    isNewRelationship: existingRelationship === undefined,
    proposedEntities:
      existingCounterparty === undefined
        ? [
            {
              id: counterpartyEntityId,
              type: 'company',
              name: counterpartyName,
              recordedAt: `${publishedDate}T00:00:00Z`,
            },
          ]
        : [],
    proposedEvidence: {
      id: evidenceId,
      observedAt: `${publishedDate}T00:00:00Z`,
      publishedAt: `${publishedDate}T00:00:00Z`,
      source: { name: headline.source, uri: headline.link },
      description,
      entityIds: [primaryEntityId, counterpartyEntityId],
    },
    proposedRelationship: {
      id: existingRelationship?.id ?? buildNewsRelationshipId(headline.ticker, counterpartyName),
      type: finalType,
      fromEntityId: existingRelationship?.fromEntityId ?? primaryEntityId,
      toEntityId: existingRelationship?.toEntityId ?? counterpartyEntityId,
      states: [
        {
          status,
          recordedAt: `${publishedDate}T00:00:00Z`,
          effectiveFrom: `${publishedDate}T00:00:00Z`,
          evidenceIds: [evidenceId],
          confidence: { value: confidence },
        },
      ],
    },
  };
}

function buildHypothesisCandidate(
  headline: HeadlineRef,
  section: Record<string, unknown>,
  primaryEntityId: string,
  domainContext: DomainContext,
): NewsAgentCandidate | undefined {
  const description = readString(section, 'description');
  if (description === undefined) return undefined;
  const rationale = readString(section, 'rationale') ?? '';
  const confidence = readNumber(section, 'confidence') ?? 0.6;

  const existingId = readString(section, 'existingHypothesisId');
  const existing =
    existingId !== undefined
      ? domainContext.hypotheses.find((h) => h.id === existingId)
      : undefined;
  const name = readString(section, 'name');
  const statement = readString(section, 'statement');
  if (existing === undefined && (name === undefined || statement === undefined)) return undefined;

  const rawStatusChange = readString(section, 'statusChange');
  const statusChange =
    rawStatusChange !== undefined && HYPOTHESIS_STATUSES.includes(rawStatusChange)
      ? rawStatusChange
      : undefined;

  const publishedDate = headline.publishedAt.slice(0, 10);
  const evidenceId = buildEvidenceId(`${headline.ticker}-hyp`, publishedDate, headline.link);

  const assessment = {
    timestamp: `${publishedDate}T00:00:00Z`,
    confidence: { value: confidence },
    supportingEvidenceIds: [evidenceId],
    contradictingEvidenceIds: [],
    rationale,
    ...(statusChange !== undefined ? { status: statusChange } : {}),
  };

  const proposedHypothesis =
    existing !== undefined
      ? {
          id: existing.id,
          name: existing.name,
          statement: existing.statement,
          status: statusChange ?? existing.status,
          createdAt: existing.createdAt,
          assessments: [assessment],
        }
      : {
          id: buildNewsHypothesisId(name ?? headline.ticker, headline.link),
          name: name ?? headline.ticker,
          statement: statement ?? description,
          status: statusChange ?? 'proposed',
          createdAt: `${publishedDate}T00:00:00Z`,
          assessments: [{ ...assessment, status: assessment.status ?? statusChange ?? 'proposed' }],
        };

  return {
    kind: 'hypothesis',
    ticker: headline.ticker,
    title: headline.title,
    link: headline.link,
    source: headline.source,
    publishedAt: headline.publishedAt,
    rationale,
    isNewHypothesis: existing === undefined,
    proposedEntities: [],
    proposedEvidence: {
      id: evidenceId,
      observedAt: `${publishedDate}T00:00:00Z`,
      publishedAt: `${publishedDate}T00:00:00Z`,
      source: { name: headline.source, uri: headline.link },
      description,
      entityIds: [primaryEntityId],
    },
    proposedHypothesis,
  };
}

async function extractCandidates(
  rootDir: string,
  provider: LlmProvider,
  model: string,
  headline: HeadlineRef,
  articleText: string,
  domainContext: DomainContext,
): Promise<NewsAgentCandidate[]> {
  const systemPrompt = buildExtractionSystemPrompt(domainContext);
  const userPrompt = `Ticker: ${headline.ticker}
Company: ${headline.companyName}
Headline: ${headline.title}
Source: ${headline.source}
Published: ${headline.publishedAt}
Article text:
${articleText}`;

  const raw = await chat(rootDir, provider, model, systemPrompt, userPrompt);
  let parsed: Record<string, unknown>;
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return [];
    parsed = json as Record<string, unknown>;
  } catch {
    return [];
  }
  if (parsed.skip === true) return [];

  const primaryEntityName = readString(parsed, 'primaryEntityName') ?? headline.companyName;
  const existingPrimary = findMatchingEntity(
    domainContext.entities,
    primaryEntityName,
    headline.ticker,
  );
  const primaryEntityId = existingPrimary?.id ?? buildEntityId(primaryEntityName);
  const publishedDate = headline.publishedAt.slice(0, 10);
  const primaryEntityDraft: EntityDraft | undefined =
    existingPrimary === undefined
      ? {
          id: primaryEntityId,
          type: 'company',
          name: primaryEntityName,
          recordedAt: `${publishedDate}T00:00:00Z`,
        }
      : undefined;

  const candidates: NewsAgentCandidate[] = [];

  const eventSection = readSection(parsed, 'event');
  if (eventSection !== undefined) {
    const candidate = buildEventCandidate(headline, eventSection, primaryEntityId, domainContext);
    if (candidate !== undefined) {
      if (primaryEntityDraft !== undefined) candidate.proposedEntities.push(primaryEntityDraft);
      candidates.push(candidate);
    }
  }

  const relationshipSection = readSection(parsed, 'relationship');
  if (relationshipSection !== undefined) {
    const candidate = buildRelationshipCandidate(
      headline,
      relationshipSection,
      primaryEntityId,
      domainContext,
    );
    if (candidate !== undefined) {
      if (primaryEntityDraft !== undefined) candidate.proposedEntities.push(primaryEntityDraft);
      candidates.push(candidate);
    }
  }

  const hypothesisSection = readSection(parsed, 'hypothesis');
  if (hypothesisSection !== undefined) {
    const candidate = buildHypothesisCandidate(
      headline,
      hypothesisSection,
      primaryEntityId,
      domainContext,
    );
    if (candidate !== undefined) {
      if (primaryEntityDraft !== undefined) candidate.proposedEntities.push(primaryEntityDraft);
      candidates.push(candidate);
    }
  }

  return candidates;
}

/** The News Research Agent's full pipeline: gather this domain's tracked-ticker headlines,
 * triage which are worth reading (one LLM call), then fetch + extract up to three independent
 * candidates (event/relationship/hypothesis) from each selected article (one LLM call per
 * article) — see this feature's plan for the full rationale. A single article failing to fetch
 * or parse only costs that one article's candidates, never the whole run. */
export async function runNewsAgent(
  rootDir: string,
  domain: string,
  provider: LlmProvider,
  model: string,
): Promise<NewsAgentRunResult> {
  const headlines = await gatherHeadlines(domain);
  if (headlines.length === 0) {
    return { candidates: [], skippedCount: 0, model, headlineCount: 0, articlesRead: 0 };
  }

  const [datasetResult, eventTypesResult, relationshipTypesResult] = await Promise.all([
    loadResearchDataset(domain),
    listEventTypes(domain),
    listRelationshipTypes(domain),
  ]);
  if (!datasetResult.ok) throw new Error(datasetResult.error);
  if (!eventTypesResult.ok) throw new Error(eventTypesResult.error);
  if (!relationshipTypesResult.ok) throw new Error(relationshipTypesResult.error);

  const domainContext: DomainContext = {
    entities: datasetResult.dataset.entities.map((e) => ({ id: e.id, name: e.name })),
    eventTypes: eventTypesResult.eventTypes.map((t) => t.type),
    relationshipTypes: relationshipTypesResult.relationshipTypes.map((t) => t.type),
    relationships: datasetResult.dataset.relationships.map((r) => ({
      id: r.id,
      type: r.type,
      fromEntityId: r.fromEntityId,
      toEntityId: r.toEntityId,
      status: r.states.at(-1)?.status ?? r.type,
    })),
    hypotheses: datasetResult.dataset.hypotheses.map((h) => ({
      id: h.id,
      name: h.name,
      statement: h.statement,
      status: h.status,
      createdAt: h.createdAt,
    })),
  };

  const triageResult = await triage(rootDir, provider, model, headlines);
  const worthReadingIndices = triageResult.indices ?? [];

  const candidates: NewsAgentCandidate[] = [];
  let processed = 0;
  let articlesWithCandidates = 0;
  for (const index of worthReadingIndices) {
    const headline = headlines[index];
    if (headline === undefined) continue;
    processed += 1;
    console.log(
      `news-agent: reading ${String(processed)}/${String(worthReadingIndices.length)} — "${headline.title}"`,
    );
    try {
      const articleText = await fetchArticleText(headline.link);
      const found = await extractCandidates(
        rootDir,
        provider,
        model,
        headline,
        articleText,
        domainContext,
      );
      if (found.length > 0) articlesWithCandidates += 1;
      candidates.push(...found);
    } catch (error) {
      console.error(
        `news-agent: skipping "${headline.title}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    candidates,
    // Articles gathered but never surfacing a single candidate — triaged out, or read but
    // deemed not schema-worthy — not "headlines minus candidates" (one article can now yield up
    // to three independent candidates, so that subtraction could even go negative).
    skippedCount: headlines.length - articlesWithCandidates,
    model,
    headlineCount: headlines.length,
    articlesRead: processed,
    ...(triageResult.indices === undefined && triageResult.error !== undefined
      ? { triageError: triageResult.error }
      : {}),
  };
}
