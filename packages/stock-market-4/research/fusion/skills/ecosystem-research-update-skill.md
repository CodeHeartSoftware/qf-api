# Ecosystem Research Update — Operating Instructions

You research new developments across the fusion technology, reactor, commercialization,
supply-chain, manufacturing, materials, research-institution, and regulatory landscape —
BROADLY, not limited to the 11 tracked-security companies. This is the wider companion to
[`portfolio-research-update-skill.md`](portfolio-research-update-skill.md) (narrow, only the 11
tracked tickers); use THIS one for "what's happening in fusion, generally" — a reactor
construction milestone, a materials/supply-chain development, a competitor's funding round, a
regulatory action — none of which need touch a tracked security at all. A development that DOES
name one of the 11 as a direct party still belongs here too (this is the broader superset); it
will also naturally show up in a portfolio-scoped pass.

Return EXACTLY ONE JSON object. No markdown, commentary, explanation, or prose outside the JSON
object. This output is fed DIRECTLY into `@quant-fusion/research-store`'s
`scripts/applyResearchUpdate.ts` (run as `yarn workspace @quant-fusion/research-store run
apply:research-update -- --update-file <path> --domain fusion`) — no human or coding agent
re-transcribes it into any other format, so it must be schema-exact, not a loose summary.

## Before you start: get the current known-entity list

Run (or ask to have run) `yarn workspace @quant-fusion/research-fusion run list:entities` and use
its output as your reference for existing entity ids — entities tagged `[PORTFOLIO]` are the 11
tracked companies; everything else is ecosystem scope. **Never hand-guess or copy-paste an id list
from memory or from an earlier conversation** — it drifts as the real dataset grows; always pull
it fresh. If a company, reactor program, material, or institution you need ISN'T in that list, it's
genuinely new — mint a fresh id following the convention below.

## What counts as in-scope (report it) vs. out-of-scope (skip it)

**In scope:** any real, sourced development anywhere in the fusion ecosystem — a reactor
project's construction/procurement/plasma-physics milestone, a supply-chain or materials
development, a manufacturing-capability announcement, a funding round, a regulatory or licensing
action, a research institution's result, a competitor/peer company's news — whether or not any of
the 11 tracked companies are involved. There is no "must name a tracked company" filter here (that
filter belongs to the portfolio skill, not this one).

**Also in scope: future milestones and expected development gates** — a reactor's planned
first-plasma date, a facility's expected completion, a program's next funding gate, etc. See
"Modeling a future milestone" below for the one rule that matters here.

**Out of scope (skip, don't report):**

- Anything not genuinely new, sourced, and dated (same discipline as ever — see "General rules").
- Pure opinion/analysis pieces, prognostication roundups, or market-sizing reports with no single
  verifiable fact to extract.
- Anything already on record — check `list:entities`/the existing dataset before adding a
  duplicate (the same "don't repeat" discipline as the portfolio skill).

## Modeling a future milestone or expected gate (read this before using events for one)

A `ResearchEvent`'s `timestamp` field gates VISIBILITY, not occurrence — it means "knowable from
this date onward," the same way `Evidence.observedAt`/`Entity.recordedAt` do throughout this
schema (see `@quant-fusion/research-core`'s temporal-semantics docs). If you dated a "SPARC first
plasma expected 2027" milestone AT 2027, it would stay invisible to research until 2027 arrives —
exactly backwards, since we already know TODAY that it's expected. So:

- `timestamp`: the date the EXPECTATION was announced/learned (today, or the source's own publish
  date) — never the future target date itself.
- `type`: something like `"MILESTONE_EXPECTED"` (a domain-defined string — pick whatever reads
  clearly; research-core does not enumerate these).
- `payload`: carry the actual future target date here, e.g. `{"expectedDate": "2027-06-01"}` —
  never invent a precision the source doesn't give (a source saying "2027" should stay `"2027"`
  or omit the field entirely, not become a fabricated `"2027-01-01"`).

When the milestone is later actually REACHED, that's a normal new event dated at the real
occurrence — it does not overwrite or replace the expectation event.

## Output schema

Return a single JSON object with any subset of these four arrays (omit or leave empty any you have
nothing for — an all-empty result on a quiet day is normal and expected). Every object in every
array must be schema-exact — this is a direct, un-translated feed into
`@quant-fusion/research-core`'s `ResearchDataset`, validated by `applyResearchUpdate.ts` before
anything is written; a field name or shape that doesn't match exactly gets the WHOLE update
refused, not partially applied.

```
{
  "entities":      [ /* only for a genuinely NEW company/reactor/material/institution — see below */ ],
  "relationships": [ /* new or status-changed relationships anywhere in the ecosystem */ ],
  "evidence":      [ /* every fact you report needs at least one evidence record citing it */ ],
  "events":        [ /* an occurrence, OR a future milestone per the rule above */ ]
}
```

### `entities` — only for something genuinely new, not already in `list:entities`'s output

```json
{
  "id": "entity-<kebab-slug>",
  "type": "company",
  "name": "Full Entity Name",
  "recordedAt": "2026-09-14T00:00:00Z",
  "description": "one sentence, optional"
}
```

- `id`: mint as `entity-<kebab-slug>` — lowercase, hyphen-separated, matching every existing id in
  `list:entities`'s output. Never reuse an id already in that list.
- `type`: domain-defined, matching this dataset's existing conventions — `"company"`,
  `"reactor"`, `"government-agency"`, `"organization"`, `"material"`, `"national-laboratory"`,
  etc. (run `list:entities` and look at what similar existing entities use — this dataset uses
  hyphenated forms like `"government-agency"`, not underscored).
- `recordedAt`: today's date (when YOU are recording this), not the event's own date.

### `relationships` — a NEW relationship, or a STATUS CHANGE on an existing one

Same shape and anti-inference discipline as `portfolio-research-update-skill.md`'s own
`relationships` section (new relationship vs. status-change-on-existing, `id`/`type`/
`fromEntityId`/`toEntityId`/`states`, capability-never-implies-qualification/customer/contract) —
see that file for the full rules; they apply identically here. The one difference: neither party
needs to be one of the 11 tracked companies. Use whatever relationship `type` vocabulary the
existing dataset already uses for similar facts (`supplies`, `customer`, `qualification`,
`acquires`, `manufactures`, `development_relationship`, etc. — check `list:entities`'s
neighborhood or the dataset for precedent rather than inventing a new type for something that
already has one).

### `evidence` — every fact you report needs at least one of these

Same shape as the portfolio skill: `id`, `observedAt`, `publishedAt` (optional but include when
known), `source` (`name`/`uri`/`publisher`), `description` (an OBSERVATION, never an
interpretation), `entityIds` (every entity this evidence is actually about). Every event must have
a real source URL (`source.uri`) and a real, verifiable publication date.

### `events` — an occurrence, or a future milestone (see the rule above)

```json
{
  "id": "event-<kebab-slug>",
  "timestamp": "2026-09-14T00:00:00Z",
  "type": "MILESTONE_EXPECTED",
  "entityIds": ["entity-sparc"],
  "evidenceIds": ["evidence-<kebab-slug>"],
  "payload": { "expectedDate": "2027-06-01" }
}
```

## General rules (apply to everything above)

- Evidence, not interpretation.
- Only include facts actually supported by a real, cited source.
- Exclude ambiguous or unverifiable findings — when unsure whether an entity or relationship tier
  applies, leave it out rather than guessing.
- Never invent precision the source doesn't give (dates, especially — see the milestone rule
  above).
- Do not include trading, valuation, or investment strategy anywhere in this output.
- Do not repeat something already on record — check `list:entities`/the existing dataset for
  whether a relationship/evidence already covers this fact before adding a duplicate.
- If there is nothing new, return `{"entities": [], "relationships": [], "evidence": [], "events": []}`
  (or omit the empty arrays entirely) — a quiet day is a normal, expected outcome.

## What this skill does NOT produce (out of scope for this JSON contract)

Hypothesis-confidence changes and anything about how a bot should trade on this research stay a
manual, judgment-heavy step, same as the portfolio skill — `research-fusion`/`research-core` stay
completely unaware of any bot that consumes this data (see the package README).
