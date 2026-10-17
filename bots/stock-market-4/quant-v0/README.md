# quant-v0

A Quant Fusion model (running on the [Stock Market 4](../../../games/stock-market-4/README.md)
engine), and the successor to the `fusion-fundamental-v6`/`fusion-fundamental-v7` models — which
stay behind in the Thunderdome repo, as frozen benchmarks, and were not carried into Quant Fusion.
This model isn't really "a better v6." Both of those reduce to the same shape: one fair-value estimate per company, mapped to
one of six discrete buy/sell buckets, mapped to one hardcoded position size. `quant-v0`
replaces that shape entirely with a small pipeline modeled on how a real quant research desk
actually separates its work: **independent alpha signals → measured (not guessed) combination →
pluggable portfolio construction → an independent risk stage that can only ever shrink, never
override**.

It still tracks the same 11 real companies in the fusion-energy supply chain, using the same
research-derived valuation logic as its predecessors — what's different is everything downstream
of "here's what I think this company is worth."

## Architecture: a thin domain bot on `@quant-fusion/quant-sdk-js`

The whole alpha/correlation/portfolio-construction/risk/execution/research-interpretation pipeline
described below lives in
[`@quant-fusion/quant-sdk-js`](../../../packages/stock-market-4/quant-sdk-js/README.md) (vendored
here the same way `@quant-fusion/bot-sdk-js` is — see `vendor/`, `scripts/pack-quant-sdk-js.sh` at
the repo root) — extracted specifically so a future domain bot (a different research package, a
different tracked-security universe) can reuse all of it instead of copy-pasting ~25 files. This
bot's own `src/` keeps only the three things that are genuinely fusion-specific:

- `src/valuation/fusionValue.ts` — the fusion revenue-chain formula (`computeFusionValue`) and its
  `FusionValuationAssumptions` shape; a different domain would replace this whole file.
- `src/valuation/marketImplied.ts` — inverts that same formula for `supplierCapture` to answer
  "what does the current price already assume"; produces the SDK's generic `MarketImpliedGap`.
- `src/config.ts` — the 11 real companies' actual financial data, and `src/index.ts` — a thin
  entrypoint that builds a `DomainAdapter` (see `@quant-fusion/quant-sdk-js`'s `decision.ts`) out of
  the two files above and hands it to the SDK's `computeTradingDecisions`.

Every file path below under `src/alpha/`, `src/correlation/`, `src/portfolio/`, `src/risk/`,
`src/execution/`, `src/research/`, `src/ablation.ts`, `src/signal.ts`, and `src/decision.ts` now
means "that same relative path inside `@quant-fusion/quant-sdk-js`," not a file in this bot.

## The companies it follows

| Ticker | Company | What they do |
|---|---|---|
| ELMT | ELMT | Tungsten components |
| FURUKAWA | Furukawa Electric | High-temperature superconducting wire |
| VITZRONEXTECH | Vitzro Nextech | Aerospace / plasma engineering components |
| ALM | Almonty Industries | Tungsten mining |
| FREEM | Freemelt | Metal 3D-printing (additive manufacturing) |
| OPTX | Syntec Optics | Precision optics, including for fusion reactors |
| GFUZ | General Fusion | Builds fusion reactors directly |
| FUJIKURA | Fujikura Ltd. | HTS wire, connectivity, and cable technology |
| SUMITOMO | Sumitomo Electric | Cable, materials, and industrial components (ITER tungsten monoblocks) |
| KMT | Kennametal | Tooling and wear-resistant materials, general tungsten exposure |
| AMSC | American Superconductor | Grid-scale power electronics and superconductor technology |

## The pipeline, stage by stage

### 1. Five independent alpha signals (`src/alpha/*.ts`)

Every round, for every priced security, this bot computes five separate opinions instead of one
blended number:

| Signal | File | What it reads |
|---|---|---|
| `evidence_delta` | `alpha/evidenceDelta.ts` | Any new research event/relationship/hypothesis change since last round |
| `commercialization` | `alpha/commercialization.ts` | Specifically a `supplier_capture`-type relationship change (an upgrade/downgrade in how much of a program's spend this company actually captures) |
| `valuation_gap` | `alpha/valuationGap.ts` | The gap between the modeled fair value and the current market price |
| `market_implied` | `alpha/marketImplied.ts` | Inverting the valuation formula to ask "what is the market ALREADY pricing in," and flagging when that's outside even the bear/bull range |
| `momentum` | `alpha/momentum.ts` | A plain trailing-return read over a shorter window than the other signals use — the only one of the five that isn't research-derived |

Each one is a small, independently-testable `AlphaSignal { factor, ticker, date, value,
confidence }` — see `src/alpha/types.ts`.

### 2. Measured combination, not hand-picked weights (`src/alpha/ic.ts`)

The five signals aren't averaged with fixed weights. Every round, this bot measures each factor's
own **information coefficient (IC)** — both plain Pearson and rank (Spearman) correlation between
what that factor predicted and what actually happened next — using every realized (prediction,
outcome) pair accumulated so far in the run. A factor with enough history (10+ paired
observations, configurable) gets an ensemble weight proportional to its own measured
rank IC, clipped at zero — a factor that reliably predicts the wrong direction gets no weight,
rather than a weight by magnitude that would push trades backwards. A factor that hasn't accumulated enough history yet gets the *average* of whatever
the reliably-measured factors are getting — an honest "we don't know if this one is good or bad
yet" default, never an invented number and never a silent zero.

This is genuinely adaptive within a run — see the caveat below about what that does and doesn't
mean.

### 3. Blended statistical + causal correlation (`src/correlation/`)

Two securities can be correlated for two different reasons: their prices have historically moved
together (`correlation/statistical.ts`, plain Pearson on return series), or they share real
research exposure — the same counterparty, the same reactor program, the same supply chain node
(`correlation/causal.ts`, built on `research/exposure.ts`'s causal-graph footprint overlap).
`correlation/blended.ts` combines both into one "effective correlation" per pair, with the causal
share weighted deliberately high (`correlationBlend.causalWeight`, default 0.4) precisely because
there's so little real price history to estimate the statistical half from reliably right now.

### 4. Pluggable portfolio construction (`src/portfolio/`)

Given each security's combined expected-return/confidence and the effective-correlation matrix,
one of three configurable strategies (`src/portfolio/select.ts`) turns that into target weights:

- **`equal_weight`** — every active position gets the same size.
- **`inverse_volatility`** — sized inversely to each security's own trailing daily volatility (the
  **default**).
- **`risk_parity`** — sized so each position contributes roughly equal risk, using the blended
  correlation matrix from stage 3.

There is deliberately **no mean-variance optimizer** — with 11 securities and only a couple months
of real price history, fitting one would be manufactured precision, not a real edge. The
walk-forward harness (below) is what actually compares these three empirically instead of the bot
committing to one.

### 5. An independent risk stage that only ever shrinks (`src/risk/riskEngine.ts`)

Portfolio construction's output then passes through a risk engine that can **only reduce** a
weight, never increase or override it, in three sequential passes: a per-position concentration
cap, a liquidity/average-daily-volume-proxy cap, and a thesis-group cap (positions that share
real research exposure — e.g. several tungsten-supply-chain names — get capped as a group, reusing
`fusion-fundamental-v7`'s own `applyThesisGroupCaps` unchanged). Every shrink is recorded with a
plain-language reason in `TradingDecision.riskAdjustments`; when nothing needs shrinking, the
weights pass through byte-identical.

### 6. Execution-cost-aware orders (`src/execution/costs.ts`, `src/portfolio.ts`)

Each order gets a bounded, illustrative transaction-cost estimate (a flat fee plus a term scaled by
order notional ÷ an average-daily-volume proxy) attached for reporting — not a full spread/slippage
model, which would need real bid/ask data this project doesn't have. **Phase 1 is long-only**: no
shorting, no stop-loss, no trend-filter veto — those were v6-era mechanisms tied to its discrete
signal-bucket design, which this bot doesn't have.

### 7. A "null research" ablation switch (`src/ablation.ts`)

One config field, `ablationMode`, controls which alphas are actually allowed to influence the
ensemble: `full` (all five), `research_only` (drops `momentum`), `price_only`/`null_research`
(keeps only `momentum`). This exists specifically to let the walk-forward harness ask the central
question this whole bot is for: **does the research-derived signal add real, measurable alpha, or
would trading on price alone do just as well?**

## The walk-forward harness (`backtest/walkForward.ts`)

This is the actual point of the bot, more than any one config's trading performance. It splits the
real available price history into rolling train/validate folds and — critically — asserts a later
fold's data can never leak into an earlier fold's decision (see
`test/backtest/walkforward-leakage.test.ts`, which truncates the dataset and proves an
already-computed decision is byte-identical before and after). It runs every
`quant-v0` portfolio-strategy/ablation-mode combination, `quant-lite`, and dumb controls (equal-weight,
buy-and-hold, cash) through the identical harness, so they're genuinely comparable. (The
`fusion-fundamental-v6`/`v7` benchmark rows are only available from Thunderdome's copy of this
harness — they were deliberately left out of the Quant Fusion fork.)

**An honest, load-bearing caveat**: with only ~2-3 months of real price history to fold, any
specific numbers this harness reports today are statistically thin — a working proof of the
mechanism, not a settled verdict on any strategy. It gets more meaningful automatically as
`packages/stock-market-4/market-data`'s `fetch:append-bars` keeps growing the real dataset.

**A second, related caveat, worth being just as direct about**: the IC-weighted ensemble (stage 2
above) adapts *online, within a single continuous run* — for one long backtest over the same real
window, its weights in September are shaped by realized outcomes from July-August of that same
run. That's causally legitimate (it never sees ahead of itself) and is exactly what an adaptive
ensemble is supposed to do, but it is not the same thing as the walk-forward harness's proper
held-out validation. A single continuous `match run`/`match forward run` and the walk-forward
harness have in fact disagreed on relative ranking in practice — that discrepancy is a real,
still-open finding, not resolved by this README.

## Execution realism (2026-09)

The walk-forward harness replays every participant **through the real stock-market-4 game engine**
(`backtest/gameReplay.ts`), not a separate ledger, so a backtest and a real match now agree
(Jan 2 start, legacy fills: harness 82.0% vs. a real forward match's 83.8%). By default it uses the
game's `REALISTIC_EXECUTION`: an order decided on day t fills at day t+1's **open**, pays a 15 bps
half-spread plus square-root market impact (100 bps x sqrt(order / average daily volume)), and is
capped at 5% of average daily volume, with the game's 0.1% fee. `--execution legacy` reproduces the
old same-close, cost-free fills, which let a strategy trade on a close it had already seen and were
worth roughly 20-30 points of return this year. New matches created through the app or
`emit:forward-config` get realistic execution too; existing matches keep the fills they started with.

## Paper-trading gate

What quant-v0 must show before any broker connection, and again before real money. These were
written on 2026-09-23 **after** seeing the Jan-Sep 2026 results below, so they can't count as
pre-registered for that data — which is exactly why G5 requires a period nobody has seen yet.

**Simulation -> paper** (all realistic execution; "spread" = 12 starts on the 1st/15th of each month
across at least six months, "cluster" = 10 consecutive starting days):

| # | Criterion | 2026-09-23 status |
|---|---|---|
| G1 | Spread: residual Sharpe vs. the basket, mean >= 0.5 and mean - 1 sd >= 0 | pass (1.54 +/- 1.14) |
| G2 | Spread: positive annualized alpha in >= 75% of starts | pass (100%) |
| G3 | Spread: worst max drawdown <= 25% | pass (21.3%) |
| G4 | Research adds value: `full` and `research_only` both beat `price_only` on residual Sharpe | pass (1.54 / 1.52 vs. -0.76) |
| G5 | **Unseen data:** a forward match started on or after 2026-09-24 with the code frozen, run >= 30 trading days, residual Sharpe >= 0 | not started |
| G6 | Cluster (Jan 2-15 starts): residual Sharpe mean - 1 sd >= 0 | marginal pass (0.40 +/- 0.34) |

Read G1-G4 with G6 in mind: the edge is concentrated in Jul-Sep (January starts earn ~10% alpha a
year, not ~28%), on 11 names in a single thematic rally. G5 is the one that actually decides.

**Paper -> live** (after G1-G6): >= 30 trading days of paper fills; average implementation
shortfall (paper fill vs. simulated fill) <= 25 bps per trade; zero unexplained position/cash
reconciliation breaks; paper residual return within 1 sd of the simulation over the same days.
Then a small live allocation behind a kill switch.

## What's explicitly deferred (not silently dropped)

- Full alpha/beta/cost return-attribution decomposition — each decision records which alpha/stage
  moved it, but the full breakdown isn't computed yet.
- Signal half-life/decay measurement — needs more historical depth than ~2 months can support
  meaningfully.
- Full bid/ask spread/slippage modeling beyond the bounded ADV-scaled approximation.
- A persisted, queryable decision ledger — still in-memory per decision, not a database.

## Quickstart

```bash
cd bots/stock-market-4/quant-v0
npm install   # first time only
npm test      # run the test suite
npm run backtest   # replay it against real historical prices and research
```

Run `npx tsx backtest/walkForward.ts` from this directory for the rolling train/validate comparison
described above. Add `--start-date YYYY-MM-DD` to start every participant trading on that date
instead (bars before it are dropped entirely, not just untraded), or `--start-dates a,b,c` to run
once per date and print each participant's mean ± stdev across them — read comparisons off that,
since one start day has swung a result by ~10 points. Every participant also reports `vsBasket`:
beta, annualized alpha, and residual Sharpe against the tracked universe's equal-weight basket, so
being long the fusion theme in a rising month isn't mistaken for alpha.

**Valuation anchors are point-in-time by default** (`alphaEnsemble.baseAnchor`, 2026-09 audit):
the config `baseBusinessValuePerShare` values are the min/last/max close of the backtest window
itself, pulled after it ended, and using them in a backtest was worth ~20-30 points of pure
hindsight. The bot now anchors on the first close it actually sees, and refuses to run in
`{ mode: 'config' }` from a date before any anchor's `anchorAsOf`. `fusion-fundamental-v6`/`v7`
(Thunderdome only) are frozen and still use the hindsight anchors, so they're no longer a fair
benchmark.

**Price data comes from `@quant-fusion/market-data`** (`backtest/marketDataSeries.ts`), dataset
`fusion-fundamental-v0` version 4 — Yahoo Finance from 2026-01-02, built by that package's
`fetch:publish-version` — replayed from the committed migrations, so the harness always matches
what a real match reads. **Research comes from the live `@quant-fusion/research-store` dataset**
the same way (resolved through the monorepo, not a vendored tarball — the old vendored
`research-fusion` was a frozen Sep 11 snapshot that never saw later research updates). **Positions are chosen by rank** (`portfolioConstruction.selection`,
top 4 positive views) rather than an absolute `activationThreshold`. See [`apps/cli/README.md`](../../../apps/cli/README.md) for running this model
through the real Docker-backed engine (`match run`/`match forward run`).
