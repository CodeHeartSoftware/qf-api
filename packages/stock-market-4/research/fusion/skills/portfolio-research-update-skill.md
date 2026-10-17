# Portfolio Research Update — Operating Instructions

You research new developments about ONE specific, fixed list of companies — the actual tracked
securities in a trading simulation's universe — not the fusion industry in general. This is the
narrower of two research layers; the other is
[`ecosystem-research-update-skill.md`](ecosystem-research-update-skill.md) (the broad
fusion-ecosystem layer — reactors, supply chain, materials, regulatory, competitors, future
milestones — with no requirement that a tracked security be involved). Use THIS skill when what's
needed is "did anything happen to a company we actually trade"; use the ecosystem skill for
general industry background. Both feed the same `apply:research-update` pipeline and the same
connected dataset — see the package README's "Two research layers" section.

Return EXACTLY ONE JSON object. No markdown, commentary, explanation, or prose outside the JSON
object. This output is fed DIRECTLY into `@quant-fusion/research-store`'s
`scripts/applyResearchUpdate.ts` (run as `yarn workspace @quant-fusion/research-store run
apply:research-update -- --update-file <path> --domain fusion`) — no human or coding agent
re-transcribes it into any other format, so it must be schema-exact, not a loose summary.

## The tracked universe (report ONLY events that touch one of these)

This table is prose documentation of `@quant-fusion/fusion-universe`'s `TRACKED_SECURITIES` (also
re-exported as `src/scope.ts`'s `PORTFOLIO_ENTITY_IDS`) — the single source of truth for which
entity ids/tickers count as portfolio scope, shared with `@quant-fusion/market-data`'s own price
ingestion. If this table and that package ever disagree, the package wins.

| Ticker        | Exchange         | Company                 | What they do                                           |
| ------------- | ---------------- | ----------------------- | ------------------------------------------------------ |
| ELMT          | NASDAQ           | ELMT                    | Tungsten, molybdenum, and specialized-alloy components |
| FURUKAWA      | TYO: 5801        | Furukawa Electric       | High-temperature superconducting (HTS) wire            |
| VITZRONEXTECH | KOSDAQ: 488900   | Vitzro Nextech          | Aerospace / plasma engineering components              |
| ALM           | NASDAQ           | Almonty Industries      | Tungsten mining                                        |
| FREEM         | Nasdaq Stockholm | Freemelt                | Metal 3D-printing (additive manufacturing)             |
| OPTX          | NASDAQ           | Syntec Optics           | Precision optics, including for fusion reactors        |
| GFUZ          | NASDAQ           | General Fusion          | Builds fusion reactors directly                        |
| FUJIKURA      | TYO: 5803        | Fujikura Ltd.           | HTS wire, connectivity, and cable technology           |
| SUMITOMO      | TYO: 5802        | Sumitomo Electric       | Cable, materials, and industrial components            |
| KMT           | NYSE             | Kennametal              | Tooling and wear-resistant materials                   |
| AMSC          | NASDAQ           | American Superconductor | Grid-scale power electronics and superconductor tech   |

**Do not confuse a similarly-named but DIFFERENT company for a tracked one** — e.g. "A.L.M.T."
(a Japanese tungsten-monoblock manufacturer) is NOT "Almonty Industries" (ticker ALM) despite the
similar name; they are unrelated companies. If you're not sure an entity in a source is genuinely
one of the 11 above (not a similarly-named unrelated company), SKIP it rather than guessing at an
entity id for it.

## What counts as in-scope (report it) vs. out-of-scope (skip it)

**In scope:**

- Anything reported directly about one of the 11 companies above (earnings, contracts, orders,
  facility news, leadership, litigation, regulatory action, etc.).
- A NAMED counterparty event (a contract, acquisition, supply/customer relationship, partnership,
  license, procurement AWARD — not just a bid) where one of the 11 is explicitly one of the named
  parties, even if the other party (say, ITER, a government agency, or another company) isn't
  itself tracked. The company you're reporting FOR must be one of the 11 above.

**Out of scope (skip, don't report):**

- General fusion-industry news that doesn't name any of the 11 as a party — e.g. a construction
  milestone at a reactor project, a procurement NOTICE (not yet awarded) from an agency with no
  named bidder among the 11, industry-wide funding/policy news, or news about a competitor/peer
  company not on the list above. This is the single most common mistake: fusion news is
  interesting, but if it doesn't name one of these 11 companies as a direct party, it doesn't
  belong in this report.
- A relationship where the only connection to a tracked company is background/contextual (e.g. "a
  reactor project that some tracked companies have supplied IN THE PAST" mentioned only for
  color, with no NEW development about the actual relationship).

## Before you start: get the current known-entity list

Run (or ask to have run) `yarn workspace @quant-fusion/research-fusion run list:entities` and use
its output as your reference for existing entity ids — every one of the 11 tracked companies, plus
every counterparty/reactor/material already in the dataset, is in that list as `id — name`. **Never
hand-guess or copy-paste an id list from memory or from an earlier conversation** — it drifts as
the real dataset grows; always pull it fresh. If a company or counterparty you need ISN'T in that
list, it's genuinely new — mint a fresh id following the convention below.

## Output schema

Return a single JSON object with any subset of these four arrays (omit or leave empty any you have
nothing for — an all-empty result on a quiet day is normal and expected, not a sign to broaden
scope). Every object in every array must be schema-exact — this is a direct, un-translated feed
into `@quant-fusion/research-core`'s `ResearchDataset`, validated by `applyResearchUpdate.ts` before
anything is written; a field name or shape that doesn't match exactly gets the WHOLE update
refused, not partially applied.

```
{
  "entities":      [ /* only for a genuinely NEW company/counterparty — see below */ ],
  "relationships": [ /* new or status-changed supplier/customer/acquisition relationships */ ],
  "evidence":      [ /* every fact you report needs at least one evidence record citing it */ ],
  "events":        [ /* optional — a modeled occurrence, distinct from the evidence describing it */ ]
}
```

### `entities` — only for something genuinely new, not already in `list:entities`'s output

```json
{
  "id": "entity-<kebab-slug>",
  "type": "company",
  "name": "Full Company Name",
  "recordedAt": "2026-09-12T00:00:00Z",
  "description": "one sentence, optional"
}
```

- `id`: mint as `entity-<kebab-slug>` (e.g. `entity-saab-dynamics`) — lowercase, hyphen-separated,
  matching every existing id in `list:entities`'s output. Never reuse an id already in that list.
- `type`: almost always `"company"` for this skill's scope (a new counterparty). Use
  `"government_agency"`/`"reactor_program"` only if that's genuinely what the new entity is.
- `recordedAt`: today's date (when YOU are recording this), not the event's own date — this is
  "when research came to know about it," a separate concept from the event's real-world date (see
  `relationships`/`evidence` below, which use the event's own date).

### `relationships` — a NEW relationship, or a STATUS CHANGE on an existing one

**Use ONLY these relationship `type` values** — these are the ones a trading bot's own research
interpreter actually recognizes and reacts to (see `interpretEvents.ts`); anything else is
schema-valid but invisible to a bot, so don't invent new types for this scope:

- `"acquires"` — the tracked company acquired another entity (rare; a real M&A event).
- `"supplies"` / `"customer"` / `"qualification"` — the tracked company's supplier/customer/
  qualification relationship with a counterparty (contract awards, orders, qualification-track
  progress, etc. all go here — pick whichever word best matches the real relationship; a bot
  matches on the SUBSTRING `customer|qualification|supplies|supplier`, so any of these, or a type
  containing "supplier", works).

**A NEW relationship** (the tracked company and counterparty have no prior relationship on
record):

```json
{
  "id": "rel-<kebab-slug>",
  "type": "supplies",
  "fromEntityId": "entity-freemelt",
  "toEntityId": "entity-saab-dynamics",
  "states": [
    {
      "status": "qualification track",
      "recordedAt": "2026-09-12T00:00:00Z",
      "effectiveFrom": "2026-08-15T00:00:00Z",
      "evidenceIds": ["evidence-<kebab-slug>"],
      "confidence": { "value": 0.9, "basis": "company press release" }
    }
  ]
}
```

- `id`: mint as `rel-<kebab-slug>` (e.g. `rel-freemelt-saab-dynamics`).
- `fromEntityId`/`toEntityId`: the tracked company is normally `fromEntityId` (it supplies TO /
  has a customer relationship WITH the counterparty); both must be real ids from `list:entities`
  or a new entity you're defining in this same update's `entities` array.
- `states[0].recordedAt`: today's date (when you're recording it). `effectiveFrom`: the REAL date
  the status took effect (from the source), which may be well before `recordedAt`.
- `evidenceIds`: must reference an id you're also including in this update's `evidence` array (or
  an existing one, if you're citing something already on record).

**A STATUS CHANGE on an EXISTING relationship** (e.g. a qualification became a firm contract):
supply the relationship's EXISTING `id`, its EXISTING `type`/`fromEntityId`/`toEntityId` exactly as
they already are, and ONLY the new state(s) in `states` — do not re-list old states, and do not
try to set an `effectiveTo` on the state that used to be last; the script fills that in
automatically from the new state's own `effectiveFrom`:

```json
{
  "id": "rel-freemelt-saab-dynamics",
  "type": "supplies",
  "fromEntityId": "entity-freemelt",
  "toEntityId": "entity-saab-dynamics",
  "states": [
    {
      "status": "production contract",
      "recordedAt": "2026-09-12T00:00:00Z",
      "effectiveFrom": "2026-09-05T00:00:00Z",
      "evidenceIds": ["evidence-<kebab-slug>"]
    }
  ]
}
```

**Anti-inference discipline — this is the single most important rule in this whole document, now
that YOU are choosing the schema `type` directly (not describing a fact in prose for someone else
to classify):**

- Capability does NOT establish qualification. Qualification does NOT establish a customer
  relationship. A customer relationship does NOT establish a contract. **Only report a
  `supplies`/`customer`/`qualification` relationship (new OR a status change) when the source
  ITSELF states that specific tier** — a company merely having the general capability to make
  something is not evidence of any relationship with a specific counterparty, and does not belong
  in `relationships` at all (it may belong in `evidence`, described plainly, with no relationship
  attached).
- **Never upgrade an existing relationship's status based on an unrelated capability fact.** If
  ELMT expands manufacturing capacity, that is NOT evidence that any of its qualification-track
  relationships advanced — do not touch those relationships' `states` because of it.
- If a relationship is prospective/non-binding (a framework agreement, a letter of intent, a
  qualification still in progress), the `status` string must say so plainly (e.g.
  `"framework agreement"`, `"qualification track"`) — never round up to `"production contract"` or
  similar until the source itself says that.

### `evidence` — every fact you report needs at least one of these

```json
{
  "id": "evidence-<kebab-slug>",
  "observedAt": "2026-09-12T00:00:00Z",
  "publishedAt": "2026-09-10T00:00:00Z",
  "source": { "name": "Company press release", "uri": "https://...", "publisher": "Freemelt AB" },
  "description": "Freemelt AB announced a qualification-track supply agreement with Saab Dynamics for additive-manufactured components, effective 2026-08-15.",
  "entityIds": ["entity-freemelt", "entity-saab-dynamics"]
}
```

- `observedAt`: when YOU (the researcher) observed/are recording this — normally today's date.
- `publishedAt`: the source's own publication date, if known (optional, but include when you have
  it — it's a real, useful provenance fact distinct from `observedAt`).
- `description`: an OBSERVATION, never an interpretation — describe what the source actually says,
  not what you conclude from it (e.g. "announced a qualification-track supply agreement," not
  "is likely to become a major supplier").
- `entityIds`: every entity this evidence is actually about — the tracked company AND any named
  counterparty.
- Every event must have a real source URL (`source.uri`) and a real, verifiable publication date.
  Never invent precision the source doesn't give.

### `events` — optional, only if genuinely useful

A modeled occurrence distinct from the evidence describing it (e.g. `"SUPPLIER_QUALIFIED"`) —
most updates from this skill don't need one; only include it if there's a clean, discrete
occurrence worth naming separately from its evidence. Shape:

```json
{
  "id": "event-<kebab-slug>",
  "timestamp": "2026-08-15T00:00:00Z",
  "type": "SUPPLIER_QUALIFICATION_ADVANCED",
  "entityIds": ["entity-freemelt", "entity-saab-dynamics"],
  "evidenceIds": ["evidence-<kebab-slug>"],
  "payload": {}
}
```

## General rules (apply to everything above)

- Evidence, not interpretation.
- Only include facts actually supported by a real, cited source.
- Exclude ambiguous or unverifiable findings — when unsure whether an entity or relationship tier
  applies, leave it out rather than guessing.
- Do not include trading, valuation, or investment strategy anywhere in this output.
- Do not repeat something already on record — check `list:entities`/the existing dataset for
  whether a relationship/evidence already covers this fact before adding a duplicate.
- If there is nothing new touching any of the 11 tracked companies, return
  `{"entities": [], "relationships": [], "evidence": [], "events": []}` (or omit the empty arrays
  entirely) — this is a normal, expected, GOOD outcome on most days, not a sign to broaden scope
  and report general industry news instead.

## What this skill does NOT produce (out of scope for this JSON contract)

Hypothesis-confidence changes (reweighing an existing analytical belief) are NOT part of this
skill's output — that stays a manual, judgment-heavy step for now. Everything above
(entities/relationships/evidence/events) is the full extent of what a run of this skill should
return.
