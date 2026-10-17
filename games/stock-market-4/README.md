# Stock Market 4

_The Assemblies didn't fall to war, or famine, or another sky turning black. They fell the way
everything since the Griddle went dark eventually falls: something bigger showed up wanting the
same thing. Only difference was they brought a better balance sheet._

_The Combines were never nations, and never pretended to be — no flag, no treasury anyone could
audit, no border that wasn't also a supply chain._

_What they inherited from the Assemblies was the appetite, not the apparatus. No synthetic index.
No invented macro economy. No hidden fundamental value some engine rolled up out of noise — a
Combine doesn't gamble on a number it can't trace back to something that actually happened. It
trades the real tape: real companies, real closes, exactly as history recorded them. At this
scale, fiction just doesn't move enough capital to be worth fabricating._

_Denny's outlived all of it anyway. The Concern, the Last Griddle, whatever a given era called
it — it didn't survive as a company, and it didn't survive as a black-market invitation. It
survived as scripture._

_**The Church of the Bottomless Cup** doesn't sell breakfast; nobody left alive has tasted a real Grand Slam, and most
Combines have quietly stopped pretending that's the point. What matters now is Standing — a portfolio large enough, and
cleanly enough won, to count as an offering the Grand Slam Gods might actually notice — and the honor of
having built it by grinding every rival Combine's own ledger down to nothing in the process._

_Nobody trades for breakfast anymore. Everybody still trades for Denny's._

## About this game

Where [`stock-market-2`](../stock-market-2/README.md) and
[`stock-market-3`](../stock-market-3/README.md) _simulate_ a market — a hidden price model, a
hidden macro economy, an order book matching bots against each other — this version **replays
one**. You supply the daily bars (real historical data, or a synthetic series you generated
yourself); the game replays them day by day, gated so a bot never sees a bar, corporate action, or
research payload before its own date. Nothing here invents prices. Execution is deliberately
simplified (every fill is against the tape itself, never against another participant — no order
book) to keep the focus on portfolio-management decisions: sizing, risk, leverage, and —
optionally — incorporating an external research signal, rather than exchange microstructure.

One round = one real trading day.

```ts
import { game as stockMarket4 } from '@quant-fusion/game-stock-market-4';
```

**New here?** Read the [Quickstart](#quickstart) below first — it walks through supplying data,
writing a config, feeding in research, and submitting orders with copy-pasteable examples. Every
section after it goes deeper into the reasoning behind each piece, for once you're past "how do I
make this run."

- [Quickstart](#quickstart)
  - [1. Supply market data](#1-supply-market-data)
  - [2. Write a config](#2-write-a-config)
  - [3. Run a match](#3-run-a-match)
  - [4. Feed in research (optional)](#4-feed-in-research-optional)
  - [5. Create and execute orders](#5-create-and-execute-orders)
- [Running a real forward-shadow match (beginner walkthrough)](#running-a-real-forward-shadow-match-beginner-walkthrough) —
  no code, just the CLI: seeding a dataset, wiring in research, creating/resuming a match, and
  checking in on it
- [You supply the data](#you-supply-the-data) — the full data-model reference
- [Game type](#game-type) — historical replay vs. forward/shadow
- [Corporate actions](#corporate-actions)
- [Orders & execution](#orders--execution) — the full mechanics reference
- [Risk & financing](#risk--financing-configrisk)
- [The research boundary](#the-research-boundary) — the full research reference
- [Benchmarks & metrics](#benchmarks--metrics)
- [Results, ranking, and determinism](#results-ranking-and-determinism)
- [Setup and winning](#setup-and-winning)
- [What this game deliberately isn't](#what-this-game-deliberately-isnt)
- [Good to know](#good-to-know)

## Quickstart

This walks through the four things you need to run a match: data, config, (optionally) research,
and orders. Everything here works with plain objects — no database, no Docker, no CLI — so you can
follow along in a `.ts` scratch file or a test.

### 1. Supply market data

There's no built-in price feed. You hand in every bar a bot will ever see, keyed by ticker:

```ts
const historicalPrices = {
  ACME: [
    { date: '2026-01-05', open: 100, high: 102, low: 99, close: 101, volume: 500_000 },
    { date: '2026-01-06', open: 101, high: 103, low: 100, close: 102.5, volume: 480_000 },
    { date: '2026-01-07', open: 102.5, high: 104, low: 101, close: 103, volume: 510_000 },
    { date: '2026-01-08', open: 103, high: 105, low: 102, close: 104.5, volume: 495_000 },
    { date: '2026-01-09', open: 104.5, high: 106, low: 103, close: 105, volume: 520_000 },
  ],
};
```

Real historical data (pulled from wherever you like) or a synthetic series you generate yourself
both work identically — see [You supply the data](#you-supply-the-data) below for the full
picture, including the SQLite-backed alternative (`config.marketDataset`) for a dataset too big to
hand-write inline, or one that needs to grow over time.

### 2. Write a config

```ts
const config = {
  startDate: '2026-01-05',
  endDate: '2026-01-09',
  marketDataUniverse: ['ACME'], // every ticker this match trades — must have a historicalPrices entry
  historicalPrices,
  startingCapital: 100_000, // optional — this is already the default
};
```

That's a complete, valid config — everything else (`risk`, `transactionFeeRate`, `gameType`, ...)
has a sensible default. Validate it the same way the engine does:

```ts
const parsed = stockMarket4.parseConfig(config);
if (!parsed.ok) throw new Error(parsed.reason); // e.g. a typo'd date, or a ticker missing from historicalPrices
```

### 3. Run a match

The fastest way to see this play out is the real CLI, against real bots, with zero setup beyond
what's already in this repo — `match run` needs at least two bot ids sharing this game:

```bash
yarn quant-fusion match run <botId> <botId> --config '{"startDate":"2026-01-05","endDate":"2026-01-09",...}'
```

For a single bot on its own — evaluating one strategy rather than a head-to-head — use
`match forward run` instead (below); it's the same real engine, just without the two-participant
minimum. See [`apps/cli/README.md`](../../apps/cli/README.md#match-run) for the full command
reference and
[`bots/stock-market-4/fusion-fundamental-v0/README.md`](../../bots/stock-market-4/fusion-fundamental-v0/README.md)
for a fully worked solo example against that bot's own real tracked securities.

To drive it yourself in code instead (what the engine itself does under the hood — useful for
writing a test, or a quick sanity check without Docker):

```ts
import { createRng } from '@quant-fusion/rng';

const rng = createRng(Buffer.alloc(16)); // unused — this game is fully deterministic, never reads rng

const state0 = stockMarket4.initialize({ config: parsed.value, participantIds: ['alice'], rng });

const observation = stockMarket4.getObservation(state0, 'alice');
// observation.securities[0] -> { ticker: 'ACME', bar: {...2026-01-05 bar...}, history: [...] }

const { nextState } = stockMarket4.resolve({
  state: state0,
  actions: new Map([
    ['alice', { orders: [{ kind: 'MARKET', ticker: 'ACME', side: 'BUY', quantity: 10 }] }],
  ]),
  rng,
});

stockMarket4.isTerminal(nextState); // false — 3 more trading days left
```

### 4. Feed in research (optional)

`config.researchTimeline` is a list of `{ date, payload }` entries — `payload` can be _anything_,
the game never looks inside it. The simplest possible version:

```ts
const researchTimeline = [
  { date: '2026-01-06', payload: { headline: 'ACME beats earnings', sentiment: 'bullish' } },
];
```

A bot decides what a `research.payload` even means; this game just delivers the latest one whose
`date` has arrived, via `observation.research`. The real, structured way to build one — what
[`fusion-fundamental-v0`](../../bots/stock-market-4/fusion-fundamental-v0/README.md) actually
uses — is [`@quant-fusion/research-core`](../../packages/stock-market-4/research/core/README.md)'s
`createResearchSnapshot(dataset, timestamp)`, called once per date you want to reveal:

```ts
import { createResearchSnapshot } from '@quant-fusion/research-core';
import { createFusionFixtureDataset } from '@quant-fusion/research-fusion';

const dataset = createFusionFixtureDataset();
const researchTimeline = [
  { date: '2026-01-05', payload: createResearchSnapshot(dataset, '2026-01-05T00:00:00Z') },
  { date: '2026-01-08', payload: createResearchSnapshot(dataset, '2026-01-08T00:00:00Z') },
];
```

Full picture, including why the game never imports `research-core` itself, in
[The research boundary](#the-research-boundary) below.

### 5. Create and execute orders

A bot's `decideAction` (or, if you're driving the game directly, whatever you pass as that
participant's `action`) returns a batch of orders:

```ts
const action = {
  orders: [
    { kind: 'MARKET', ticker: 'ACME', side: 'BUY', quantity: 10 },
    { kind: 'LIMIT', ticker: 'ACME', side: 'SELL', quantity: 5, limitPrice: 110 },
  ],
};
```

- `MARKET` always fills, at that day's close.
- `LIMIT` only fills if the day's range would plausibly have crossed `limitPrice` (low ≤ limit for
  a BUY, high ≥ limit for a SELL) — otherwise it's reported with `filledQuantity: 0`, not an error.
- Orders don't rest — each round's batch is evaluated only for that round. Want another chance
  tomorrow? Submit again.
- What actually happened is in next round's `observation.fills` — never silently swallowed, even
  a `0`-filled order is reported so a bot can tell "I asked and nothing happened" from "I never
  asked."

Full mechanics, including how a batch is order-independent within a round (a SELL right after a
BUY sees the position that BUY just opened), in [Orders & execution](#orders--execution) below.

---

## Running a real forward-shadow match (beginner walkthrough)

Everything above shows the game's API in isolation — plain objects, no setup. This section is the
"I just want to actually run this" path: real CLI commands, copy-pasteable from the repo root, no
code required. It uses `fusion-fundamental-v6` (see its own
[README](../../bots/stock-market-4/fusion-fundamental-v6/README.md)) and the real price history
several `fusion-fundamental-*` bot versions share as the worked example — swap in your own bot/data
once you've got the shape.

### What you need first

- **Docker Desktop running.** Every bot plays inside its own container — this is true for every
  match this repo runs, not just forward ones.
- **`yarn install` once, at the repo root.**
- Run every command below **from the repo root**, not a subdirectory — the CLI resolves bots and
  games relative to wherever you invoke it from, and silently reports "no bots found" if you're in
  the wrong place.

### What "forward-shadow" actually means, in practice

A `'HISTORICAL'` match plays a fixed window of prices you already have, start to finish, in one
sitting, then it's over. A `'FORWARD_SHADOW'` match instead plays against a dataset that's still
growing in the real world: you run it today, it plays every real trading day currently known and
then stops (not an error — `list`/`inspect` show it as `active`, "still resumable"); you run the
_exact same command_ again next week, once more real bars have actually happened, and it picks up
exactly where it left off, with the bot's portfolio and history intact. Nothing about a bot's own
decision logic changes — only how much real data currently exists to show it.

### Step 1 — seed a price dataset

You need real daily bars before anything else can run. This repo already has a seeded, versioned
dataset for the 11 companies `fusion-fundamental-v0`/`v6` track — seed it once:

```bash
yarn workspace @quant-fusion/market-data run seed:fusion-fundamental-v0
```

This publishes dataset id `fusion-fundamental-v0` (check its own script,
[
`packages/stock-market-4/market-data/scripts/seedFusionFundamentalV0.ts`](../../packages/stock-market-4/market-data/scripts/seedFusionFundamentalV0.ts),
for the current `DATASET_VERSION` — it bumps whenever the published data itself is corrected) into
the shared Stock Market 4 database at `.quant-fusion/db.sqlite` (gitignored local
state, not committed — see
[ADR-0014](../../docs/adr/0014-sqlite-standard-and-migrations.md)). See
[`@quant-fusion/market-data`'s own README](../../packages/stock-market-4/market-data/README.md) for the full
picture, including tracking a brand-new ticker of your own.

**Growing it later, with no LLM and no manual data-entry**, once you want more recent real prices
than what's currently seeded:

```bash
yarn workspace @quant-fusion/market-data run fetch:append-bars -- \
  --dataset-id fusion-fundamental-v0 --dataset-version <the version you seeded> \
  --db-path ./.quant-fusion/db.sqlite
```

This fetches straight from Yahoo Finance's public chart API and only ever adds bars strictly after
each ticker's own current latest known date — safe to just re-run whenever, with no dates to
figure out yourself. Add `--dry-run` to preview without writing. (If you'd rather hand-supply
prices from somewhere else, `append:bars` in that same package takes a plain JSON file instead —
see its own script for the exact shape.)

### Step 2 — (optional, but usually worth it) wire in research

**Without this step, most real bots will just hold cash forever.** A bot like
`fusion-fundamental-v6` decides what to trade based on `observation.research` (see
[The research boundary](#the-research-boundary) below) — with an empty `researchTimeline`
(the default), it correctly has nothing to react to and sits out every round, which looks like a
bug the first time you see it but isn't one.

If your bot uses [`@quant-fusion/research-fusion`](../../packages/stock-market-4/research/fusion/README.md)'s
fixture (as every `fusion-fundamental-*` version does), generate a real `researchTimeline` from it:

```bash
DB_PATH="$(pwd)/.quant-fusion/db.sqlite"
(cd packages/stock-market-4/research/fusion && yarn run emit:forward-config --silent -- \
  --market-dataset-id fusion-fundamental-v0 --market-dataset-version <the version you seeded> \
  --start-date 2026-07-13 --end-date 2026-12-31 --as-of-date "$(date +%F)" \
  --universe ELMT,FURUKAWA,VITZRONEXTECH,ALM,FREEM,OPTX,GFUZ,FUJIKURA,SUMITOMO,KMT,AMSC \
  --db-path "$DB_PATH") \
  > ./.quant-fusion/preview-configs/my-match.json
```

This writes a complete match config (universe, dataset, dates, AND a real `researchTimeline` built
from the current fixture) to a file — a real one routinely runs to megabytes, well past what a
shell allows as an inline argument, which is exactly why this writes to a file rather than
printing something you'd paste inline. `--start-date` matters: pick one that's actually within
every tracked ticker's real trading history (a company that IPO'd partway through your dataset's
window has no earlier data to show, real or otherwise — check
[`@quant-fusion/market-data`'s README](../../packages/stock-market-4/market-data/README.md) if a ticker isn't
covering the range you expected). `--end-date` should be far in the future (e.g. the end of the
year) — **not** "today," or your match will immediately flip to `completed` the moment real data
catches up to it, rather than staying `active`/resumable for the long haul.

### Step 3 — create the match

```bash
yarn quant-fusion match forward run my-match fusion-fundamental-v6 \
  --config-file ./.quant-fusion/preview-configs/my-match.json
```

`--config-file` (or inline `--config '<json>'` for something small enough to type) is only needed
this FIRST time, to create the match — its `<matchId>` (`my-match` here) is yours to choose, and is
how you find it again later. This plays every real trading day currently known, then stops and
reports itself `active`/"still resumable."

### Step 4 — resume it later, whenever more real data has landed

```bash
yarn quant-fusion match forward run my-match fusion-fundamental-v6
```

Same command, no config needed this time (a stored match always uses the config it was created
with — passing one again just prints a warning and is ignored). Run Step 1's `fetch:append-bars`
first if you want fresh prices to actually be there to play against.

### Step 5 — check in on it

```bash
yarn quant-fusion match forward list                 # every forward match you've created
yarn quant-fusion match forward inspect my-match      # this one's status, round count, participants
```

### Step 6 — (optional) see what the bot would do right now, without playing a round

Re-run Step 2's command first (same `--start-date`/`--end-date`/dataset, `--as-of-date` set to
today) to overwrite `my-match.json` with a config that reflects any research added since the match
was created — that's the whole point of previewing:

```bash
yarn quant-fusion match forward preview my-match --config-file ./.quant-fusion/preview-configs/my-match.json
```

Read-only: never persists a round or changes the match. Reports which securities' orders differ
between the match's own stored config and this freshly-generated one — or plainly says there's no
new round to preview yet if the price dataset hasn't grown past what's already been played.

Full flag reference for every command above: [
`apps/cli/README.md`](../../apps/cli/README.md#match-forward-run--list--inspect).

---

## You supply the data

There is no procedural price engine in this game, historical or synthetic.
`config.historicalPrices` is a plain `{ [ticker]: DailyBar[] }` map — every bar you want this match
to ever show a bot, for every ticker in `config.marketDataUniverse`. `config.marketDataMode`
(`'historical'` or `'synthetic'`, default `'historical'`) is a label only: nothing about how a
series is read, replayed, split-adjusted, or traded against differs by mode. If you want a
synthetic match, you generate the synthetic series yourself (however you like) and hand it in
exactly the same way you'd hand in real data — see
[`market/historicalPrices.ts`](src/market/historicalPrices.ts) and
[`market/calendar.ts`](src/market/calendar.ts).

```
config.startDate / config.endDate       the match's calendar window
config.tradingHolidays                  non-trading dates besides weekends (default: [])
config.historicalContextDays            trailing bars a bot sees before its first decision (default: 250)
config.marketDataUniverse               tickers this match trades (must each have a historicalPrices entry)
config.historicalPrices                 { [ticker]: DailyBar[] } — the whole declared price series
```

`state.round` N is decided for the Nth actual trading day in `[startDate, endDate]` — weekends and
`tradingHolidays` are skipped, so a two-day weekend inside the range never adds a round. A bar's
own bid to the bot is capped by `historicalContextDays`; `historicalPrices` may (and generally
should) extend earlier than `startDate` so that warmup window has real data to draw from, not just
days actually played during the match. A gap in the data (a ticker with no bar on some trading day)
is reported to the bot as `bar: null`, never silently carried forward from the prior close.

## Game type

`config.gameType` (`'HISTORICAL'` | `'SYNTHETIC'` | `'FORWARD_SHADOW'`, default `'HISTORICAL'`) is
a **match-lifecycle** discriminator — deliberately not the same axis as `marketDataMode` above,
which is a **data-provenance** label. A `FORWARD_SHADOW` match replaying real prices is still
`marketDataMode: 'historical'`; the two answer different questions and both are reported on every
observation/result. See [`docs/adr/0011-explicit-game-types.md`](../../docs/adr/0011-explicit-game-types.md)
for the full rationale.

`'HISTORICAL'` and `'SYNTHETIC'` behave identically to each other and to every match before this
field existed: the full nominal `[startDate, endDate]` calendar plays out regardless of how sparse
a `config.marketDataset` actually is (a missing bar stays an ordinary per-ticker data gap,
`bar: null`, exactly as always). `'FORWARD_SHADOW'` requires `config.marketDataset` (inline
`historicalPrices`/`corporateActions` can't represent data that isn't all authored yet) and is the
one case where the match's effective calendar is trimmed to what the dataset actually has: the
earliest date every ticker in `config.marketDataUniverse` is currently known through (not
`config.benchmarkTicker`, which never gates match length). This lets a `FORWARD_SHADOW` match end
cleanly at "ran out of real data" instead of playing a tail of empty rounds up to a possibly-distant
`endDate`.

**Directly via `GameDefinition`, a `FORWARD_SHADOW` match is still a bounded, single-process run**
that plays exactly what's currently published, then ends. Resumability across process restarts —
picking a match back up later, once the dataset has grown, with no loss of portfolio/state — is
layered on top via three additional exported functions this module provides but `GameDefinition`
itself has no hook for: `serializeForwardState`, `resumeForwardState`, and
`isForwardMatchFullyResolved` (which one, not `isTerminal`, tells you whether a `FORWARD_SHADOW`
match is genuinely done versus just out of data for now). See
[`docs/adr/0013-forward-match-persistence.md`](../../docs/adr/0013-forward-match-persistence.md)
for the full design, and `apps/cli`'s `match forward run` for the operational entry point that
actually uses them.

## Corporate actions

`config.corporateActions` declares real (or synthetic) dividends, splits, reverse-splits,
buybacks, acquisitions, and delistings — organizer-declared historical fact, not something this
game triggers on its own. STOCK_SPLIT/REVERSE_SPLIT get full mechanical treatment: the price series
a bot sees is retroactively adjusted so a split never looks like a 50% loss, and a held position's
share count/cost basis rescale the moment it takes effect — all pure accounting math, so it needs
no order-execution machinery to work. A split dated in the future never adjusts anything
retroactively; only once it's actually happened does the past reread as continuous, the same way
real adjusted-close data behaves. CASH_DIVIDEND settles cash onto a held position the same way.
BUYBACK/ACQUISITION/DELISTING are surfaced to a bot as fact (`observation.corporateActions`) but
have no forced-settlement mechanism (yet) — see [`market/corporateActions.ts`](src/market/corporateActions.ts).

Acquisitions/delistings may declare an `announcedDate` earlier than their effective `date` — real
advance notice, the same as an actual M&A announcement.

## Orders & execution

```ts
action = { orders: [{ kind: 'MARKET' | 'LIMIT', ticker, side: 'BUY' | 'SELL', quantity, limitPrice? }] }
```

Every order fills independently against that round's own bar — a MARKET order at the day's close,
a LIMIT order at the limit price if the day's range would plausibly have crossed it (low ≤ limit
for a BUY, high ≥ limit for a SELL), never partially against synthetic order-book depth. Orders
don't rest: an order is evaluated only for the round it's submitted in, so a bot that wants another
chance simply resubmits. A batch of orders is processed in submission order, each seeing the fill
before it — a SELL right after a BUY in the same list sees the position that BUY just opened. See
[`execution/orders.ts`](src/execution/orders.ts).

## Risk & financing (`config.risk`)

```
allowShortSelling      default false — a plain cash account; true enables margin/short-selling
borrowableShares       per-ticker short cap (default 1000, static — not dynamically scaled)
borrowFeeAnnualized    default 0.03 (3%), charged daily on any short position's notional
initialMarginRatio     default 0.5 — Reg-T-style buying power = equity / this
maintenanceMarginRatio default 0.3 — equity below this forces liquidation
```

Off by default: a BUY is capped to what cash affords, a SELL to shares actually held, never
opening a short. Turn it on and buying power (not literal cash) becomes the real spending limit —
a BUY can be financed by margin beyond your cash balance (which is then allowed to go negative), a
SELL beyond current shares opens/extends a short capped by `borrowableShares`. Every round, any
short position is charged a daily borrow fee; if equity then falls below the maintenance
requirement, positions are force-liquidated (largest exposure first, deterministic) against that
same day's close — there's no order book to partially fill against, so each forced trade closes in
one step. See [`portfolio/accounting.ts`](src/portfolio/accounting.ts),
[`portfolio/borrow.ts`](src/portfolio/borrow.ts), and [`portfolio/liquidation.ts`](src/portfolio/liquidation.ts).

## The research boundary

`config.researchTimeline` is a sorted list of `{ date, payload }` entries — `payload` is
completely opaque to this game. No schema, no validation of its shape, no interpretation. A bot
sees `observation.research`: the latest entry with `date` at or before the current round, or
`undefined` if none is knowable yet. This game deliberately doesn't import
[`@quant-fusion/research-core`](../../packages/stock-market-4/research/core/README.md) or know that it exists —
the intended real-world flow is to call that package's own `createResearchSnapshot(dataset,
timestamp)` yourself, outside this game entirely, and hand the resulting JSON straight through
here. See [`research/timeline.ts`](src/research/timeline.ts).

## Benchmarks & metrics

Every participant's whole equity curve is tracked (`observation.portfolio.equityHistory`) — one
reading at match start, one more per round. At match end, `getResult` reports each participant's
`performanceMetrics`: total return, max drawdown, annualized volatility, and a Sharpe ratio
(`null` when volatility is 0 — e.g. a single trade all match, which has no defined variance to
compute one from). Annualization uses 252 trading days/year throughout, the same convention the
borrow-fee calculation uses. Optionally declare `config.benchmarkTicker` (any ticker with a
`historicalPrices` entry — it doesn't need to be in `marketDataUniverse`, since a benchmark is
something performance is measured _against_, not necessarily something a bot can trade) for a
buy-and-hold `benchmarkReturn` over the same first-to-last trading day the match actually played.
See [`metrics/performance.ts`](src/metrics/performance.ts).

## Results, ranking, and determinism

Ranked by final equity, highest wins — ties share a rank (competition ranking: 1, 1, 3, never 1,
1, 2), same convention `stock-market-3`'s own net-liquidation-value scoring used. This was chosen
over a Sharpe-based ranking because `sharpeRatio` is legitimately `null` for plenty of real
portfolios, which would need its own tiebreak rule anyway — `performanceMetrics`/`riskStats` stay
on the result for anyone who wants a different scoring rule downstream.

Every resolved round's event carries a real audit-trail payload (`RoundEventData`): the date,
every participant's fills (order fills and any forced liquidations), which participants got
margin-called that specific round, and which corporate actions took mechanical effect that round —
enough for a replay/spectator consumer to reconstruct exactly what happened without touching raw
game state.

This game is fully deterministic (`manifest.json`'s `deterministic: true`): nothing in it ever
reads its own `rng` argument. Every outcome is a pure function of `config` and the action sequence
submitted — the same config and the same actions always produce the same result.

## Setup and winning

Starting capital defaults to $100,000; a transaction fee (default 0.1%) is charged on every
executed fill (including a forced liquidation). A missed, late, or invalid action never forfeits
the match — a historical-replay match can run hundreds of rounds, so it's substituted with an
empty order list instead (that participant just sits out the round; their portfolio, borrow fees,
and margin exposure all carry forward normally). As few as 1 participant may play — a bot trading
solo against real history is a complete match on its own, reported as a solo win.

## What this game deliberately isn't

- **Not a market simulator.** There is no hidden fundamental-value model, no macro economy, no
  synthetic index — see `stock-market-2`/`stock-market-3` for that. Every price a bot ever sees
  came from `config.historicalPrices`, verbatim (split-adjusted for continuity, never invented).
- **Not an order book.** Every fill is against the declared tape, independent of every other
  participant — there's no cross-participant matching, no synthetic bid/ask depth, no queue
  position to game.
- **Not aware of research, or of any bot.** `research/timeline.ts` never imports or assumes
  anything about `@quant-fusion/research-core`; `config`/`getObservation` never leak anything a bot
  shouldn't see yet (see `redactConfigForBots`, which strips `historicalPrices`/
  `corporateActions`/`researchTimeline` down to their empty shape before a bot's own `init` — the
  full match's future tape/actions/research would otherwise go straight to it).

## Good to know

- `config.transactionFeeRate` (default 0.1%) applies to every fill, including a forced liquidation.
- A bar dated exactly on a split's own effective date is never itself adjusted by that split —
  only bars strictly before it are, which is what makes the series read as continuous rather than
  doubly-adjusted.
- `redactConfigForBots` is the only place isolation needs active enforcement beyond
  `getObservation` itself: `historicalPrices`/`corporateActions`/`researchTimeline` each hold the
  FULL match (every future bar, action, and research entry), so the wire copy of config a bot
  actually receives via `init` has all three stripped to their empty shape.
- 229 tests across 15 files cover every module in this package — see `test/` for the full suite,
  organized to mirror `src/`.
- None of this is a comment on the real, present-day financial markets or any real, currently
  publicly traded company — every ticker you supply here is whatever real (or synthetic) data you
  hand in, replayed exactly as given.
