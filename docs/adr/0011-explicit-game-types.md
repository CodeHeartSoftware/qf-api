# ADR-0011: Explicit Game Types for Stock Market 4

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

The Stock Market 4 roadmap treats `HISTORICAL`, `SYNTHETIC`, and `FORWARD_SHADOW` as three modes
of ONE game — sharing trading, execution, portfolio, and scoring logic — differing only in how a
match obtains/exposes information and how its lifecycle operates. Today, `games/stock-market-4`
has no field expressing which of these a given match is. The nearest-looking existing field,
`config.marketDataMode` (`'historical' | 'synthetic'`, `types.ts`), is a **data-provenance label**
only — is the price series real or fabricated? — with zero effect on match behavior. Once
`FORWARD_SHADOW` exists as a real concept, reusing or overloading that field's vocabulary for
match-lifecycle semantics would produce a confusing config surface: a `FORWARD_SHADOW` match
replaying genuinely real prices is still, correctly, `marketDataMode: 'historical'`.

A later, separate roadmap phase (deliberately out of scope here) makes `FORWARD_SHADOW` matches
persistent and resumable across process restarts, advancing one real trading day at a time, with
crash/restart equivalence as a first-class correctness requirement. Nothing in
`@thunderdome/engine`'s `GameDefinition` contract offers any pause/resume/persist-across-processes
mechanism today — `runMatch` runs a match to completion in one process, synchronously. This ADR
does not attempt to solve that; it only establishes the type discriminator and gives it one honest,
bounded, single-process lifecycle effect, so the later persistence work has a real distinction to
build on top of rather than inventing one from scratch under time pressure.

## Decision

**Add `config.gameType`**: `'HISTORICAL' | 'SYNTHETIC' | 'FORWARD_SHADOW'`, default `'HISTORICAL'`
— additive and fully backward compatible; every match config predating this field behaves
identically to before. `'HISTORICAL'`/`'SYNTHETIC'` behave IDENTICALLY to each other and to prior
behavior: the full nominal `[startDate, endDate]` trading calendar always plays out, regardless of
how sparse a `config.marketDataset` actually is.

**`'FORWARD_SHADOW'` requires `config.marketDataset`** — inline `historicalPrices`/
`corporateActions` is a fixed blob fully authored before the match starts, which cannot represent
data that isn't all known yet. Enforced in `StockMarket4ConfigSchema`'s `superRefine`, checked
before the pre-existing marketDataset/inline mutual-exclusivity check so this case gets its own
clear message.

**The one lifecycle effect Phase 2 adds**: for `FORWARD_SHADOW` only, the effective trading
calendar (`game.ts`'s `effectiveTradingCalendar`) is trimmed to `state.forwardShadowCutoffDate` —
the **`MIN`** of `MarketDataProvider.latestKnownDate(ticker)` (a new, additive provider method)
across every ticker in `config.marketDataUniverse`. This is the ONLY place `gameType` affects
anything: no other function (`resolve`, execution, portfolio accounting, scoring) branches on it —
concrete evidence the roadmap's "no duplicated trading logic" requirement holds.

**Why `MIN`, never `MAX`.** A real ingestion pipeline can easily have one ticker's data land before
another's on any given day. Using `MAX` across the universe would advance the calendar past a date
where some _traded_ ticker has no data yet, corrupting this game's existing "a missing bar is a
genuine data gap" contract (`bar: null`) into "the match ran out of data," systematically, every
day, for whichever ticker happens to lag. `MIN` gives the honest reading: "every ticker this match
can trade is known through at least this date." `config.benchmarkTicker` is deliberately excluded
from this computation — a benchmark is a comparison yardstick, not necessarily even tradeable (see
its own doc comment in `types.ts`), and must never gate how long a match can run.
`games/stock-market-4/test/gameType.test.ts` has a dedicated regression test (two tickers at
different freshness) protecting this — do not "simplify" the cutoff back to a single dataset-wide
query without re-reading that test first.

**Cached once, in `initialize()`.** `forwardShadowCutoffDate` is resolved once (querying the
provider per traded ticker) and stored as a scalar on `StockMarket4State`, never recomputed inside
`tradingCalendarFor`/`effectiveTradingCalendar` — those remain the cheap, pure, in-memory functions
called every round from `getObservation`/`resolve`/`isTerminal`/`getResult` that they already were.
The trimmed calendar array itself is NOT cached — only the cutoff date — for the same
"duplicated, driftable data" reason this file already avoids caching the calendar itself.

**Zero playable rounds is a hard `initialize()` throw**, not a silently-empty match: if the
cutoff falls before `config.startDate`, `initialize()` throws with a clear message. This matches
`buildMarketDataProvider`'s existing convention for setup-time-fatal problems — `initialize()`
returns `TState` directly (not a `Result`), so throwing is the only mechanism available.

**`totalRounds` reflecting the trimmed count is not an information leak.** It's derived entirely
from what the dataset already publicly declares at match start (which dates it has data through) —
the same category of already-public fact as `config.endDate` itself.

## Consequences

- Fully additive: all 206 pre-existing `stock-market-4` tests and all 27 pre-existing
  `market-data` tests pass unchanged, except one intentional one-line update — the single
  full-literal `getResult()` assertion in `game.test.ts` needed `gameType: 'HISTORICAL'` added
  (the same kind of update `marketDataMode` itself required when it was added).
- `MarketDataProvider` gains `latestKnownDate(ticker): CalendarDate | null` — an additive,
  narrowly-scoped primitive (an index-only `MAX(date)` lookup); the `MIN`-across-a-universe policy
  is deliberately NOT baked into the provider itself, and lives in `game.ts` instead, so a future
  consumer with a different policy (e.g. a different game, or a different aggregation rule) isn't
  stuck with this one.
- **This does NOT add persistence, cross-process resume, or crash/restart guarantees.** Running a
  `FORWARD_SHADOW` match today plays exactly what's currently published, once, in one process, then
  exits — a later invocation against a grown dataset starts a brand-new match from round 0. Making
  this resumable is separate, later roadmap work. This ADR doesn't foreclose it:
  `buildMarketDataProvider(config)` staying a pure function of `config` (true since Phase 1, ADR- 0010) means a future resume mechanism can plausibly just re-run it from persisted config, never
  needing to serialize the live SQLite handle itself.
- Does not add any CLI stepping/pause mode, baseline bots (`Cash`/`BuyAndHold`/`EqualWeight`), or
  single-vs-multi-bot handling changes — all separate, later phases; nothing here blocks them.
- Does not add an explicit close/dispose call for the `MarketDataProvider`'s SQLite handle — still
  out of scope per ADR-0010's own consequences section; `FORWARD_SHADOW` existing doesn't change
  that calculus (still one match, one process, one handle, process-exit-cleaned-up).

## Update: confirmed market holidays no longer stall the whole universe

`latestKnownDate` alone couldn't distinguish a real, confirmed gap in one ticker's own trading
calendar (e.g. a Tokyo Stock Exchange holiday) from ordinary ingestion lag — both look identical
(`daily_bars` simply has no row yet). In practice this meant a match with tickers on different home
exchanges would stall ALL of them behind whichever one happened to be on holiday, even though the
other tickers had fresh data ready to trade, for as long as the holiday lasted.

`MarketDataProvider` gained a second, additive primitive: `checkedThroughDate(ticker)` — the latest
date a fetch has POSITIVELY CONFIRMED has no bar for that ticker, populated by
`@thunderdome/market-data`'s `scripts/fetchAndAppendBars.ts` and persisted in a new
`ticker_checked_through` table. `forwardShadowCutoffDateFor` now takes each ticker's
`MAX(latestKnownDate, checkedThroughDate)` before taking the `MIN` across the universe — still
`MIN` across tickers, unchanged; only a single ticker's OWN effective date changed. A real, positive
confirmation is treated the same as real data for cutoff purposes; an unconfirmed lag still gates
exactly as before (see `gameType.test.ts`'s two `FORWARD_SHADOW confirmed-checked-through` tests,
added alongside the pre-existing MIN-vs-MAX one).

Deliberately conservative: the ingestion script never trusts a same-day "no bars found" as
confirmed (a real holiday and "not published yet" look identical for `today`) — it only advances
the watermark through a date strictly before the day the fetch itself ran on. A single-day holiday
still stalls the whole universe for that one day; a multi-day holiday streak (the motivating case)
no longer stalls it for the streak's full length, since each day becomes confirmed the day after it
happens rather than only once the holiday ticker's own next real bar arrives.
