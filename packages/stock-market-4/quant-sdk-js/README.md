# @quant-fusion/quant-sdk-js

The domain-agnostic "bones" of a `stock-market-4` quant strategy bot: an independent-alpha-signal
ensemble measured by information coefficient (never hand-picked weights), blended statistical +
causal correlation, three pluggable portfolio-construction strategies, an independent shrink-only
risk engine, a bounded execution-cost model, and the research-delta/event-interpretation framework
that turns a raw `@quant-fusion/research-core` dataset into strategy-relevant effects.

Extracted from [`bots/stock-market-4/quant-v0`](../../../bots/stock-market-4/quant-v0/README.md),
which used to contain all of this directly. The extraction exists for one reason: to make it
possible for a _different_ domain (a different research package, a different tracked-security
universe — quantum computing was the motivating example) to reuse this whole pipeline by writing a
small adapter instead of copy-pasting ~25 files. `quant-v0` is this SDK's only consumer
today, vendored into it the same way `@quant-fusion/bot-sdk-js` is (see `bots/**` isn't a Yarn
workspace member — `docs/adr/0001-monorepo-and-boundary.md` — and `../../../scripts/pack-quant-sdk-js.sh`).

## The one seam: `DomainAdapter`

This package has no opinion on what a domain's own valuation formula looks like — only that a
domain bot can supply one. `decision.ts`'s `DomainAdapter<TDomainAssumptions>` is the whole
interface:

```ts
interface DomainAdapter<TDomainAssumptions> {
  // Turns one security's domain-specific assumptions into a $/share ScenarioValue. Takes
  // sharesOutstanding so the domain can do its own absolute-dollar -> per-share conversion.
  computeDomainValue(params: {
    assumptions: TDomainAssumptions;
    sharesOutstanding: number;
  }): ScenarioValue;

  // Reverse-engineers what the current market price already implies about the domain's own value
  // chain — or undefined when there's nothing to invert for this security.
  computeMarketImpliedGap(params: {
    marketPricePerShare: number;
    baseBusinessValuePerShare: ScenarioValue;
    domainOptionValuePerShare: ScenarioValue;
    domainAssumptions: TDomainAssumptions;
    sharesOutstanding: number;
  }): MarketImpliedGap | undefined;

  // Every quantity research does NOT establish for this domain — reported on every decision.
  knownValuationUnknowns: readonly string[];
}
```

A domain bot builds one `DomainAdapter` (see `quant-v0/src/index.ts`'s
`FUSION_DOMAIN_ADAPTER` for a real example — it wraps that bot's own `computeFusionValue` and
`computeMarketImpliedExpectationsFromScenarios`), then calls this package's `computeTradingDecisions`
with its own `QuantStrategyConfig<TDomainAssumptions>` and that adapter. Everything else — every
alpha signal, the correlation blend, portfolio construction, the risk engine, order generation — is
already generic and needs no per-domain code at all.

`research/interpretEvents.ts`'s `ModelEffect.scope` classification (`'portfolio'` vs.
`'ecosystem'`) is similarly generic: it derives the tracked-entity-id set from
`config.securities.map(s => s.targetEntityId)` at call time, rather than a hardcoded list, so it's
automatically correct for any domain's own universe.

## What's in here, stage by stage

Every stage below operates on plain `SecurityConfig<TDomainAssumptions>`/`ResearchState`/prices —
none of it references "fusion," tungsten, or any other fusion-specific vocabulary.

1. **Five independent alpha signals** (`alpha/evidenceDelta.ts`, `alpha/commercialization.ts`,
   `alpha/valuationGap.ts`, `alpha/marketImplied.ts`, `alpha/momentum.ts`) — each a small,
   independently-testable `AlphaSignal { factor, ticker, date, value, confidence }`
   (`alpha/types.ts`). `commercialization.ts` in particular keys off the generic
   `'supplier_capture'` relationship-status factor from `research/interpretEvents.ts`, not
   anything fusion-specific.
2. **Measured combination** (`alpha/ic.ts`) — each factor's ensemble weight comes from its own
   measured information coefficient (Pearson + rank/Spearman) against realized forward returns,
   never a hand-picked constant.
3. **Blended statistical + causal correlation** (`correlation.ts`, `correlation/statistical.ts`,
   `correlation/causal.ts`, `correlation/blended.ts`) — combines price-return correlation with
   shared research-exposure overlap (`research/exposure.ts`) into one effective correlation per
   pair.
4. **Pluggable portfolio construction** (`portfolio.ts`, `portfolio/select.ts`,
   `portfolio/equalWeight.ts`, `portfolio/inverseVolatility.ts`, `portfolio/riskParity.ts`,
   `portfolio/optimizer.ts`, `portfolio/thesisGroups.ts`) — three selectable strategies, plus a
   thesis-group cap that scales down positions sharing enough research exposure to represent one
   underlying bet.
5. **An independent, shrink-only risk engine** (`risk/riskEngine.ts`) — position-concentration,
   liquidity/ADV-proxy, and thesis-group caps; every adjustment is reported, never silent.
6. **Execution-cost-aware order generation** (`execution/costs.ts`, `portfolio.ts`'s
   `buildOrders`/`spendableCentsFor`).
7. **A null-research ablation switch** (`ablation.ts`) — controls which alphas can influence the
   ensemble (`full`/`research_only`/`price_only`/`null_research`), for measuring whether the
   research-derived signals add real alpha over price alone.
8. **The research-interpretation framework** (`research/delta.ts`, `research/exposure.ts`,
   `research/interpretEvents.ts`, `research/types.ts`) — turns two point-in-time
   `@quant-fusion/research-core` snapshots into a typed delta, then into explicit, inspectable
   `ModelEffect`s (never a black-box valuation update), with the anti-inference discipline that
   capability never implies qualification, qualification never implies a customer relationship,
   and a customer relationship never implies a contract.
9. **The valuation combiner** (`valuation/companyValue.ts`, `valuation/rollingBaseValue.ts`,
   `valuation/scenarios.ts`, `valuation/types.ts`) — combines a base-business value, a domain's own
   `domainValue` (from `DomainAdapter.computeDomainValue`), and a research-driven option-value
   adjustment into one `CompanyValuation`, keeping Bear/Base/Bull scenario legs independent all the
   way through (`ScenarioValue`, never a single fake-precise number).
10. **Per-round orchestration** (`decision.ts`) — ties every stage above together into
    `computeTradingDecisions`, plus the realized-alpha-sample bookkeeping between rounds that
    `alpha/ic.ts`'s measured weights depend on.

`marketTypes.ts` and `signal.ts` are the remaining shared plumbing (the generic `stock-market-4`
observation/order protocol types, and trailing-volatility/return helpers used across several
stages above).

## What's deliberately NOT in here

Anything that requires knowing a specific domain's own value-chain formula: `quant-v0`'s
`valuation/fusionValue.ts` (the tungsten/reactor revenue-chain formula) and `valuation/marketImplied.ts`
(inverting that specific formula for `supplierCapture`) stay in that bot. A future domain bot
replaces both with its own formula and its own inversion, producing this package's generic
`ScenarioValue`/`MarketImpliedGap` shapes.

## Using this from a new domain bot

1. Define your own `TDomainAssumptions` shape and a value-chain formula that produces a
   `ScenarioValue`.
2. Build a `DomainAdapter<TDomainAssumptions>` (see "The one seam" above).
3. Build a `QuantStrategyConfig<TDomainAssumptions>` — your own `SecurityConfig[]` (real
   per-security data), `AlphaEnsemblePolicy`, `CorrelationBlendPolicy`, portfolio/risk/execution
   policies, and `ablationMode`.
4. Call `computeTradingDecisions({ config, domain, ... })` once per round, same as
   `quant-v0/src/index.ts`'s `createDecideAction` does.
5. Vendor this package into your bot the same way `quant-v0` does — add your bot's directory
   to `scripts/pack-quant-sdk-js.sh`'s `BOT_DIRS` array and re-run it.

## Testing

`yarn workspace @quant-fusion/quant-sdk-js test` — every stage above has its own unit tests against
synthetic fixtures (no dependency on any real research dataset); `quant-v0`'s own remaining
tests (`decision.test.ts`, `research/exposure.test.ts`, the walk-forward-leakage suite) are the
integration layer, exercising this package against real fusion research data through the vendored
dependency.
