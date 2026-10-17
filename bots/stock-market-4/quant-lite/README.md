# quant-lite

A deliberately stripped-down sibling of [`quant-v0`](../quant-v0/README.md), built to test one
specific hypothesis: quant-v0's own 5-signal alpha ensemble, correlation-aware portfolio
construction, and tight (3%) rebalance deadband add real cost and complexity without adding
proportional value — because quant-v0's own 2026-09 return-attribution work found that
`valuation_gap` alone drove ~88-95% of every decision's expected return, and its realistic-execution
cost drag ran ~3.5-3.7% of equity over the same backtest window.

## What it actually does

Reuses `@quant-fusion/quant-sdk-js`'s `computeSecurityAlpha` unmodified — the same real,
point-in-time-anchored fair-value model, over the same 11 real companies, as quant-v0 — but throws
away everything quant-v0 builds on top of it and replaces it with:

- **One signal, not five**: a security's score is `valuationGap + 0.15 * marketImpliedAlpha` (the
  one other signal quant-v0's own attribution found any real, non-negligible contribution from —
  `evidence_delta`/`commercialization` measured next to zero and are dropped entirely). No
  measured-IC ensemble weighting; nothing to weight.
- **The SDK's own proven `inverseVolatilityStrategy` + `top_k` selection** — reused directly, not
  reimplemented — sizing the top 4 names by score, inversely to trailing volatility.
- **A wider rebalance deadband** (`rebalanceToleranceWeight: 0.05`, vs. quant-v0's `0.03`) — a real
  lever against quant-v0's own measured cost drag, but tested rather than assumed: an initial,
  illustrative `0.08` measurably underperformed both `0.05` and `0.04` on the 12-start comparison
  below — wide enough to miss real rebalancing opportunities, not just trading costs.
- **quant-v0's own risk-shrink stage, reused unchanged** (`applyRiskEngine`) — added back after a
  real finding below; everything else stays a plain per-name weight cap.

See `src/index.ts`'s own doc comment for the full reasoning, and `src/config.ts` for every tuned
constant's own justification.

## Honest backtest results (2026-09, via quant-v0's own `backtest/walkForward.ts` — this bot is
wired in there as a participant, not duplicated into a separate harness)

**The 12-start average was itself misleading — read the single continuous run first.** A multi-start
comparison (12 starts, Jan–Jun, averaging independent fresh-capital runs) made this bot look
competitive-to-better than quant-v0. The single, continuous, full-window run (`npx tsx
backtest/walkForward.ts`, no flags — closer to how a real match actually plays out, one continuous
equity curve, not 12 independent restarts) told a different, more decisive story: quant-v0's own
`inverse_volatility, full` variant clearly beats this bot on ALL THREE metrics that matter —
return, Sharpe, AND max drawdown:

| Metric (single continuous run, Jan–Sep) | quant-v0 (inverse_volatility, full) | quant-lite |
|---|---|---|
| Total return | 53.7% | 49.5% |
| Sharpe | 1.80 | 1.52 |
| Max drawdown | 16.3% | 20.7% |
| Residual Sharpe (vs. basket) | 0.791 | 0.497 |

Several specific, falsifiable hypotheses for the gap were tested and checked against this same
single-run number — most were disproven, not just assumed away:

- **Eligibility floor** (`minScore`): tried matching quant-v0's `0` exactly. Measurably worse
  (12-start return 23.4% vs 26.5%) — reverted.
- **Rebalance deadband width**: tried 0.08 → 0.05 → 0.04 on the 12-start average (0.05 best) —
  then tried 0.03 (matching quant-v0 exactly) against the DECISIVE single-run number specifically,
  on the hypothesis that a wider deadband reacts too slowly during a fast-moving rally. **Result:
  0.03 was WORSE** (45.5% vs 49.5% at 0.05), and max drawdown barely moved (20.4% vs 20.7%) — ruled
  out; deadband width isn't the real driver of either the return gap or the drawdown gap.
- **Concentration/thesis-group risk**: added quant-v0's own `applyRiskEngine` back (this bot had
  dropped it along with the rest of the risk-engine/correlation layer), on the hypothesis that
  nothing was stopping this bot's top-K from concentrating in names sharing the same research
  exposure, driving the worse drawdown. **Result: zero adjustments fired across the entire
  backtest** — this bot's own top-4 picks never actually triggered the thesis-group cap in this
  dataset. Kept in the code anyway (a real, free safety net for conditions this backtest doesn't
  cover), but it isn't the explanation either.

**Where this leaves things, honestly**: none of the portfolio-mechanics levers (sizing, deadband,
concentration risk) explain the gap. What's left is signal composition and quant-v0's ADAPTIVE
(measured-IC) ensemble weighting itself — which can shift weight toward whichever signal is
actually working as conditions change, something a fixed two-signal blend structurally cannot do.
That the full ensemble's edge shows up specifically on the decisive single-run number (which is
dominated by the Jul-Sep rally) and much less on the calmer 12-start average is consistent with
that adaptive weighting earning real value during exactly the regime that matters most for total
return — not obviously a flaw in this bot's execution, but a real, structural reason a
fixed-weight "lite" version of quant-v0's approach may not reliably beat it. Continuing to tune
constants against these same two backtests from here risks fitting them to data already seen,
rather than finding a real edge — see quant-v0's own paper-trading gate (`G5`) for why that
distinction matters. The honest next test remains the real forward match below, on genuinely
unseen data.

## The real test

`fusion-quant-lite-vs-quant-v0` — a live `FORWARD_SHADOW` match with both bots as participants,
realistic execution, started 2026-09-24 (the latest real trading day available at creation time)
through 2026-12-31. Advance it the same way any other forward match here is advanced (`match
forward run`/`refresh`, or the app's own Jobs panel).

## Quickstart

```bash
cd bots/stock-market-4/quant-lite
npm install   # first time only
npm run build
```

No dedicated `backtest/` directory of its own — see `../quant-v0/backtest/walkForward.ts`, which
already loads this bot as a participant (`loadQuantLiteDecideAction`) and runs it through the exact
same real-data, real-execution harness quant-v0 itself is judged by.
