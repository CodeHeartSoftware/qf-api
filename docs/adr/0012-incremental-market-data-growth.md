# ADR-0012: Incremental Growth for Published Market Datasets

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

Phase 3 of the stock-market-4 roadmap makes a `FORWARD_SHADOW` match persistent and resumable —
the same match instance runs for weeks or months, playing one new trading day each time it's
resumed after real data for that day arrives. For that to mean anything, `@thunderdome/market-data`
(ADR-0010) needs a way for a dataset to actually GROW over that time.

Nothing in the package supports this today. `publishDatasetVersion` is a one-shot, all-at-once
operation: it writes every row for a `(id, version)` in a single call and fails if that identity
already exists — deliberately, since ADR-0010's whole reproducibility guarantee rests on "a
version's rows are never mutated or deleted once published." That guarantee was designed around
the historical/synthetic case (Phase 1's only actual use case): a complete dataset, authored once,
occasionally corrected by publishing an entirely new version. It says nothing about a dataset that
is _incomplete by design_ at publish time and grows a row at a time as real trading days close —
a genuinely different access pattern this ADR is the first to need.

The two options considered:

1. **New versions, one per day** — a live feed publishes `v1`, `v2`, `v3`, ... as each day's data
   lands, and a `FORWARD_SHADOW` match somehow always resolves to "the latest version." Rejected:
   it requires `config.marketDataset.version` to mean "follow whatever's newest" instead of a
   pinned, specific version — undermining exactly the reproducibility ADR-0010 exists to provide.
   A forward match's own config should point at one stable `(id, version)` for its entire life.
2. **Append new rows to the SAME, already-published version** — the one this ADR adopts.

## Decision

**New function, `appendBars(store, identity, { bars })`** (`packages/stock-market-4/market-data/src/store/
append.ts`, a new module — deliberately not added into `ingest.ts`, whose own doc comment is
entirely about one-shot immutable publishing and shouldn't be muddied with a second, different
contract). It grows an ALREADY-published `(id, version)` with rows for dates strictly AFTER each
ticker's current `latestKnownDate()` in that version, and rejects (fails the whole batch,
transactionally, same all-or-nothing guarantee as `publishDatasetVersion`) any bar dated at or
before that. `config.marketDataset.version` stays pinned for a `FORWARD_SHADOW` match's entire
life; growth happens by repeatedly appending to that one version, never by publishing new ones.

**Why this doesn't violate ADR-0010's immutability guarantee.** "Rows are never mutated or
deleted" is about not changing what's already been observed — appending a row for a date nobody
could have queried yet (it didn't exist) doesn't touch that guarantee. The monotonic-append rule is
what makes this precise: it only ever extends the frontier forward, never backfills a gap. Without
that rule, appending an EARLIER missing date would be silently indistinguishable from a correction —
it would change what a re-derivation of an already-completed match sees, even though no existing
row was literally touched. A genuine correction to already-published data still must go through a
new dataset version, exactly as ADR-0010 already requires.

**`appendCorporateActions` was considered and deferred.** The symmetric case is easy (anchor a
new action's `date` against `latestKnownDate` the same way), but nothing in Phase 3 actually needs
it yet — `forwardShadowCutoffDateFor` (games/stock-market-4/src/game.ts) only ever reads bars, and
no Phase 3 test exercises a corporate action arriving mid-match. Adding it now would be exactly the
kind of unrequested-ahead-of-need work this repo's conventions discourage; add it when something
actually needs a forward match to react to a newly-announced split or dividend.

## Consequences

- All 39 pre-existing `@thunderdome/market-data` tests pass unchanged; `appendBars` is purely
  additive, with its own new test file (`test/store/append.test.ts`) covering the happy path,
  rejection of a never-published identity, rejection of a backfilling bar, whole-batch rollback,
  a brand-new ticker appearing mid-version, and cross-version isolation.
- `MarketDataProvider`'s existing `latestKnownDate(ticker)` (roadmap Phase 2) is reused as-is to
  determine each ticker's append cursor — no provider-interface change was needed for this ADR.
- This does not build a live ingestion pipeline (a scheduler or broker/API integration that
  actually calls `appendBars` on a schedule) — that remains separate, later, ops-level work, same
  as ADR-0010's own consequences already noted. This ADR only makes the primitive exist and proves
  it correct.
- Does not license appending to any OTHER kind of already-published data (corporate actions,
  trading holidays) — see the deferred `appendCorporateActions` note above.
