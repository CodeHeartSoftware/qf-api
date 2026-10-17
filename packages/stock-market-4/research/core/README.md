# @quant-fusion/research-core

A domain-neutral representation of structured research over time: what is known, believed,
assumed, and modeled, and how that changes as new evidence arrives. It exists so that a
domain-specific research package (`research/fusion`, `research/quantum`, ...) and, eventually, a
game-playing bot, can share one temporal/evidentiary substrate without either side needing to
understand the other's business.

```ts
import { validateResearchDataset, createResearchSnapshot } from '@quant-fusion/research-core';
```

## What this is

This package answers one question:

> What did the research system know or believe at a given point in time?

It gives you the vocabulary to represent that precisely:

- **Evidence** — an observation, distinct from anyone's interpretation of it.
- **Assertions** and **hypotheses** — conclusions and testable beliefs, each citing the evidence
  that backs them, with their confidence tracked as an append-only history rather than a single
  mutable number.
- **Entities** and **relationships** — the things research reasons about, and typed, evolving
  connections between them.
- **Variables**, **assumptions**, **calculations**, and **models** — the machinery of a
  quantitative research model, kept explicit rather than implicit.
- **Scenarios** — alternative assumption sets, not required to carry a probability.
- **Events** — modeled occurrences, distinct from the evidence that supports them.
- A **dataset** bundling all of the above into one immutable, versioned unit, and a **state
  provider** that reconstructs exactly what was knowable as of any timestamp.

The motivating shape of reasoning this is built to carry — without ever encoding it — looks like:

```text
Scientific Evidence → Technical Claim → Technology → Commercialization Constraint
    → Component → Material → Manufacturing Capability → Supplier → Qualification
    → Contract → Deployment → Revenue → EBIT/FCF → Valuation → Security → Trade
```

`research-core` only owns the left-hand, domain-neutral end of that chain (evidence through
models/scenarios). The "Security"/"Trade" end is a different system's problem entirely (see
[What this is not](#what-this-is-not)).

## What this is not

- **Not domain-specific.** Nothing in this package knows what fusion, quantum computing, stocks,
  or portfolios are. A domain package like `research/fusion` supplies its own vocabulary for
  `Entity.type` (`"reactor"`, `"supplier"`, ...), `Relationship.type`
  (`"supplies"`, `"depends_on"`, ...), and `RelationshipState.status` (`"tested"`, `"qualified"`,
  ...) — this package only validates the _shape_, never the _values_, of those strings.
- **Not a database, graph store, event bus, or ingestion pipeline.** A `ResearchDataset` is an
  in-memory (or JSON-file-backed) object; there is no persistence layer, query engine, or
  crawler here.
- **Not an inference engine.** There is no Bayesian/causal inference, no formula execution engine
  (`ResearchCalculation.formula` is stored as an opaque string), no unit conversion, and no NLP.
  Confidence and uncertainty are recorded, not computed.
- **Not a bot, and not aware of one.** The output of this package is a `ResearchSnapshot` — a
  plain, serializable object. What consumes it (a portfolio-management bot, a dashboard, a test)
  is entirely outside this package's concern.
- **Not aware of games.** Nothing here depends on, or is depended on by, any Quant Fusion game
  package. `stock-market-4` is expected to treat a `ResearchSnapshot` as an opaque payload it
  merely delivers to a bot at the right time — see that package's own README once it exists.

## Core concepts

| Type                                                                | File                     | Purpose                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ResearchEntity`                                                    | `entity/entity.ts`       | A thing research reasons about.                                                                                                                  |
| `ResearchRelationship` / `RelationshipState`                        | `relationship/`          | A typed connection between two entities, whose status evolves through a sequence of non-overlapping `states`.                                    |
| `Evidence` / `EvidenceSource`                                       | `evidence/`              | An observation, with full provenance — never an interpretation.                                                                                  |
| `ResearchAssertion`                                                 | `assertion/assertion.ts` | A conclusion or generalization, not necessarily framed as a testable hypothesis.                                                                 |
| `ResearchHypothesis` / `HypothesisAssessment` / `ResearchCriterion` | `hypothesis/`            | A testable belief, whose confidence (and optionally status) history is an append-only list of assessments, plus optional falsification criteria. |
| `ResearchVariable`                                                  | `model/variable.ts`      | A quantity or value, tagged with its `origin` (observed/derived/assumed/estimated/scenario).                                                     |
| `ResearchAssumption`                                                | `model/assumption.ts`    | An input a model takes on faith, kept distinguishable from anything observed.                                                                    |
| `ResearchCalculation` / `ResearchModel`                             | `model/`                 | A named formula (stored, never executed) and the structure of variables/assumptions around it.                                                   |
| `ResearchScenario`                                                  | `model/scenario.ts`      | An alternative assumption set/possible world; `probability` is optional.                                                                         |
| `ResearchEvent`                                                     | `event/event.ts`         | A modeled occurrence (e.g. `SUPPLIER_QUALIFIED`), distinct from the evidence supporting it.                                                      |
| `ResearchQuestion`                                                  | `question/question.ts`   | An open question the research doesn't yet answer — a research agenda item, not a claim with a truth value.                                       |
| `ResearchDataset`                                                   | `dataset/dataset.ts`     | An immutable, versioned bundle of everything above.                                                                                              |
| `ResearchState` / `ResearchStateProvider`                           | `state/`                 | What was knowable as of a given timestamp, reconstructed from a dataset.                                                                         |
| `ResearchSnapshot`                                                  | `snapshot/snapshot.ts`   | A self-contained, serializable `(datasetId, datasetVersion, timestamp, state)` — the object a consumer actually receives.                        |

### Why evidence, assertions, hypotheses, assumptions, and models are kept separate

Each answers a different question, and collapsing them loses information a downstream consumer
needs:

- **Evidence** answers _"what was observed?"_ — e.g. "ELMT reported development-stage work with
  CFS involving fusion-relevant materials." It carries no judgment about what that means.
- **Assertion** answers _"what do we conclude, generally?"_ — e.g. "supplier qualification does
  not imply commercial procurement." Not every useful conclusion is framed as something to test.
- **Hypothesis** answers _"what specific, testable belief are we tracking, and how has our
  confidence (and status) in it moved over time?"_ — with an explicit, immutable history
  (`HypothesisAssessment[]`), not a single number (or a single unstamped `status` field) that
  quietly drifts.
- **Assumption** answers _"what are we taking on faith to make a model tractable?"_ — e.g. a
  constant tritium price. It is never mistakable for an observed fact.
- **Model** answers _"how do these pieces combine into a quantity we care about?"_ — structure
  around variables/assumptions/calculations, with the calculation itself left as an opaque,
  human-readable formula rather than something this package executes.
- **Question** answers _"what don't we know yet?"_ — a research agenda item with no truth value
  to assess, which is exactly what distinguishes it from a hypothesis: "what is the facility's
  annual capacity?" isn't something a `confidence` value could ever apply to.

If evidence and assertions were merged, you could no longer tell a raw observation from someone's
reading of it. If hypotheses only stored a current confidence, you'd lose the ability to answer
"what did we believe in 2027?" — which is exactly what state reconstruction (below) depends on.

## Temporal semantics

This is the most important part of the package to get right, and the easiest to get subtly
wrong: **a research snapshot at time T may contain only information available to the research
system at or before T** (spec's "critical information-leak" invariant). Getting this right
requires being precise about _which_ timestamp on each object actually gates its visibility —
several fields that look interchangeable are not:

| Field                                                                    | Means                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `observedAt` (Evidence)                                                  | When a researcher observed it. Gates Evidence's visibility — not `publishedAt`/`availableAt`.                                                          |
| `publishedAt` / `availableAt` (Evidence)                                 | When the underlying source published/became public. Informational provenance only; a private or embargoed observation may legitimately precede either. |
| `createdAt` (Assertion, Hypothesis, Model, ResearchQuestion)             | When the object was authored. Gates its visibility.                                                                                                    |
| `timestamp` (HypothesisAssessment, Event)                                | When that specific assessment/event happened. Gates its own visibility, independent of its parent object.                                              |
| `recordedAt` (Entity, RelationshipState, Variable, Assumption, Scenario) | When the object entered the research record. Gates its visibility.                                                                                     |
| `validFrom`/`validTo`, `effectiveFrom`/`effectiveTo`                     | When the underlying _fact_ was true in the world — NOT when research learned it. Never used to gate visibility.                                        |

`recordedAt` does not appear in the original spec's literal interfaces for `Entity`,
`RelationshipState`, `Variable`, `Assumption`, and `Scenario` — those five types otherwise have no
epistemic timestamp at all, only a real-world validity window. Without one, a state
reconstruction at time T could not tell whether, say, an entity "valid since 2020" was actually
entered into the dataset in 2020 or in 2029 — precisely the leak the spec calls out as the most
important invariant in the system. `recordedAt` was added as a small, deliberate deviation to
close that gap; every other object already had an unambiguous timestamp for this purpose.

`state/provider.ts`'s `computeResearchStateAt(dataset, timestamp)` is where all of this is
applied. Two collections filter _inside_ an object, not just across the array:

- A **relationship**'s `states` are trimmed to those with a visible `recordedAt`; a relationship
  with zero visible states is dropped entirely, since `ResearchRelationship` itself carries no
  epistemic timestamp — "do we know anything about this relationship yet" is entirely a function
  of its states.
- A **hypothesis**'s `assessments` are trimmed to those with a visible `timestamp`, but the
  hypothesis itself stays present (possibly with zero assessments) once its own `createdAt` is
  visible — unlike relationships, a hypothesis's `createdAt` is its own independent epistemic
  timestamp, so a proposed-but-not-yet-assessed hypothesis is still knowable.

**Known limitation:** filtering is per-collection, not transitive. `validateResearchDataset`
checks that every id-shaped reference resolves _somewhere_ in the dataset, but neither it nor
`computeResearchStateAt` currently re-verifies that a referencing object's own epistemic
timestamp is at least as late as everything it cites (e.g. that an assertion never cites evidence
recorded after the assertion itself). This is deliberately left as an authoring discipline rather
than a re-validated invariant, consistent with keeping V1 boring — a well-formed dataset simply
shouldn't cite what it doesn't have yet.

## Dataset versioning

A `ResearchDataset` is treated as immutable once published: nothing in this package exposes an
API for mutating one in place (`readonly`-shaped, plain-object construction only — see spec
§36). A correction is a new `ResearchDataset` with the same `id`, a new `version`, and whatever
`createdAt`/`recordedAt`/etc. values are appropriate for the corrected data. `version` is a
free-form string (`"1.0.0"`, `"2026-03-01"`, ...); this package does not mandate a scheme, only
that a published one doesn't change under you.

## Research snapshots

```ts
const snapshot = createResearchSnapshot(dataset, '2026-09-08T12:00:00Z');
// snapshot.datasetId, snapshot.datasetVersion, snapshot.timestamp, snapshot.state
```

A `ResearchSnapshot` is what an eventual consumer (a bot) receives — never direct access to a
dataset or a `ResearchStateProvider`. It is self-contained and JSON-serializable; see
[Serialization](#serialization) for the exact guarantees. It carries `datasetVersion` in addition
to the spec's literal `{ datasetId, timestamp, state }` — a small, deliberate addition, since a
consumer generally needs to know _which_ published version of the dataset a snapshot came from
(e.g. for a reproducibility record), and the dataset already carries that field.

## Serialization

Every type here is a plain, JSON-shaped object (no `Date`s, `Map`s, `Set`s, or class instances),
so `JSON.stringify`/`JSON.parse` is the entire serialization story — no custom format. Parsing
through this package's schemas also _normalizes_ key order to each schema's declared field order
regardless of the input's order, so two semantically-equal objects built independently serialize
to byte-identical JSON. The one place that guarantee doesn't extend is a `metadata` record's own
key order (an open-ended `Record<string, ResearchValue>` has no fixed shape to normalize against)
— it's preserved exactly as given, not reordered.

## Domain extension

A domain package (`research/fusion`, `research/quantum`, ...) does not subclass or wrap anything
here. It simply:

1. Picks its own strings for `Entity.type`, `Relationship.type`, `RelationshipState.status`, and
   `ResearchEvent.type` (e.g. fusion's `type: "reactor"`, quantum's `type: "quantum-architecture"`
   — `research-core` never inspects these values).
2. Constructs a `ResearchDataset` — usually via a small fixture/loader module of its own — out of
   plain objects matching this package's schemas.
3. Calls `validateResearchDataset` on it, and, when it needs to hand research to a consumer,
   `createResearchSnapshot`/`ResearchStateProvider`.

No change to `research-core` is required to add a new domain.

## Validation

Every constructor (`parseResearchEntity`, `parseResearchHypothesis`, `parseResearchDataset`, ...)
returns a `ValidationResult<T>`:

```ts
type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
```

Per-object schemas (built on `zod`) catch structural problems (malformed timestamps, confidence
outside `[0, 1]`, an uncertainty missing its bounds, overlapping relationship states, an
assessment predating its own hypothesis, ...). `validateResearchDataset` additionally catches
what only makes sense with the whole dataset in view:

- **Duplicate ids** (`findDuplicateIds`) — every id must be unique across the whole dataset, not
  just within its own collection.
- **Missing references** (`findMissingReferences`) — every id-shaped reference (relationship
  endpoints, evidence/entity/relationship citations, model variable/assumption references,
  scenario overrides, ...) must resolve to something real elsewhere in the dataset.
- **Temporal integrity** (`findTemporalIntegrityViolations`) — every one of those same references
  must resolve to something that was already _knowable_ at the citing object's own epistemic
  timestamp (the same timestamp `computeResearchStateAt` gates its visibility by — see the
  temporal-semantics table above). Evidence can't cite an entity research hadn't recorded yet; a
  hypothesis assessment can't cite evidence not yet observed; and so on for every reference kind
  `findMissingReferences` checks. A relationship's own timestamp for this purpose is its
  _earliest_ state's `recordedAt`, since a relationship has no epistemic timestamp of its own.
  Without this check, a dataset could pass validation yet still produce a `ResearchSnapshot` at
  some timestamp T containing a reference that only makes sense in hindsight — e.g. evidence
  observed in December citing an entity not recorded until the following January would vanish
  from view at T if you asked for a snapshot as of December, even though the evidence itself would
  still be visible, silently citing something the snapshot doesn't contain. This check rejects
  that dataset outright instead of letting it surface downstream.

## Example

```ts
import {
  validateResearchDataset,
  createResearchSnapshot,
  type ResearchDataset,
} from '@quant-fusion/research-core';

const dataset: ResearchDataset = {
  id: 'dataset-fusion-v1',
  name: 'Fusion Research',
  version: '1.0.0',
  domain: 'fusion',
  createdAt: '2026-01-01T00:00:00Z',
  entities: [
    {
      id: 'entity-walter-tosto',
      type: 'company',
      name: 'Walter Tosto',
      recordedAt: '2025-12-01T00:00:00Z',
    },
    { id: 'entity-sparc', type: 'reactor', name: 'SPARC', recordedAt: '2025-12-01T00:00:00Z' },
  ],
  relationships: [
    {
      id: 'rel-walter-tosto-sparc',
      type: 'supplies',
      fromEntityId: 'entity-walter-tosto',
      toEntityId: 'entity-sparc',
      states: [
        {
          status: 'qualified',
          recordedAt: '2026-01-01T00:00:00Z',
          effectiveFrom: '2025-06-01T00:00:00Z',
          evidenceIds: ['evidence-1'],
        },
      ],
    },
  ],
  evidence: [
    {
      id: 'evidence-1',
      observedAt: '2025-12-01T00:00:00Z',
      source: { name: 'Walter Tosto press release' },
      description: 'Walter Tosto reported vacuum-vessel qualification work for SPARC.',
      entityIds: ['entity-walter-tosto', 'entity-sparc'],
    },
  ],
  assertions: [],
  hypotheses: [],
  assumptions: [],
  variables: [],
  models: [],
  scenarios: [],
  events: [],
  questions: [],
};

const result = validateResearchDataset(dataset);
if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));

// What did research know as of mid-2025 — before the qualification was even recorded?
const early = createResearchSnapshot(dataset, '2025-07-01T00:00:00Z');
early.state.relationships.length; // 0 — the only state isn't recorded until 2026-01-01

// What did research know once the qualification had been recorded?
const later = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
later.state.relationships[0]?.states[0]?.status; // 'qualified'
```
