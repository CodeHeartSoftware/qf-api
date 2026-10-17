import { activeFactorsForMode, applyAblation } from './ablation.js';
import { computeCommercializationAlpha } from './alpha/commercialization.js';
import { computeEvidenceDeltaAlpha } from './alpha/evidenceDelta.js';
import {
  combineAlphaEnsemble,
  computeEnsembleWeights,
  measureAlphaIC,
  type RealizedAlphaSample,
} from './alpha/ic.js';
import { computeMarketImpliedAlpha } from './alpha/marketImplied.js';
import { computeFactorScales, standardizeSignals } from './alpha/standardize.js';
import { computeMomentumAlpha } from './alpha/momentum.js';
import type { AlphaSignal } from './alpha/types.js';
import { computeValuationGapAlpha } from './alpha/valuationGap.js';
import type { AlphaEnsemblePolicy, QuantStrategyConfig, SecurityConfig } from './config.js';
import { computeEffectiveCorrelation } from './correlation/blended.js';
import { computeCausalOverlap } from './correlation/causal.js';
import { computePearsonCorrelation, computeReturnsSeries } from './correlation/statistical.js';
import { estimateOrderCost, type OrderCostEstimate } from './execution/costs.js';
import type { DailyBar, OrderRequest, PortfolioObservation } from './marketTypes.js';
import { buildOrders, spendableCentsFor } from './portfolio.js';
import { effectiveCorrelationKey, type AlphaInput } from './portfolio/types.js';
import { selectPortfolioStrategy } from './portfolio/select.js';
import { selectActiveAlphas } from './portfolio/selection.js';
import { computeResearchDelta, type ResearchDelta } from './research/delta.js';
import { computeExposureMap, exposureFootprint, type ExposureMap } from './research/exposure.js';
import { interpretResearchDelta, type ModelEffect } from './research/interpretEvents.js';
import type { ResearchState } from './research/types.js';
import { applyRiskEngine } from './risk/riskEngine.js';
import { computeDailyVolatility } from './signal.js';
import { computeCompanyValuation } from './valuation/companyValue.js';
import {
  DEFAULT_BASE_ANCHOR_POLICY,
  resolveStaticBaseAnchor,
} from './valuation/pointInTimeAnchor.js';
import { computeBlendedBaseValuePerShare } from './valuation/rollingBaseValue.js';
import type { CompanyValuation, MarketImpliedGap, ScenarioValue } from './valuation/types.js';

/**
 * The one seam a domain bot (quant-v0, or a future quantum/other-domain bot) fills in —
 * everything genuinely domain-specific about how a `SecurityConfig<TDomainAssumptions>` turns into
 * dollars. This SDK owns the alpha/portfolio-construction/risk architecture around it; it has no
 * opinion on what a domain's own value-chain formula looks like.
 */
export interface DomainAdapter<TDomainAssumptions> {
  /** Turns one security's domain-specific assumptions into a $/share value. `sharesOutstanding`
   * is passed through so the domain bot can do its own absolute-dollar -> per-share conversion
   * (e.g. via `mapScenario`) — this SDK never does that conversion itself, since it has no
   * opinion on the domain formula's own absolute-dollar units (some domains might not even need
   * one, if their formula is already per-share). */
  computeDomainValue: (params: {
    assumptions: TDomainAssumptions;
    sharesOutstanding: number;
  }) => ScenarioValue;
  /** Reverse-engineers what the CURRENT market price already implies about this domain's own
   * value chain for one security — or `undefined` when that security's chain is a flat zero
   * regardless of the inverted quantity (nothing to invert; see `MarketImpliedGap`'s own doc
   * comment for why that's reported explicitly, not as a zero gap). */
  computeMarketImpliedGap: (params: {
    marketPricePerShare: number;
    baseBusinessValuePerShare: ScenarioValue;
    domainOptionValuePerShare: ScenarioValue;
    domainAssumptions: TDomainAssumptions;
    sharesOutstanding: number;
  }) => MarketImpliedGap | undefined;
  /** Every quantity research does NOT establish for this domain — reported on every decision so a
   * reader never mistakes fair value for a fully-known figure (see `CompanyValuation.unknowns`). */
  knownValuationUnknowns: readonly string[];
}

function describeResearchChanges(delta: ResearchDelta): string[] {
  const lines: string[] = [];
  for (const event of delta.newEvents) {
    lines.push(`New research event "${event.type}" (${event.id}) at ${event.timestamp}.`);
  }
  for (const relationship of delta.changedRelationships) {
    lines.push(
      `Relationship ${relationship.relationshipId} (${relationship.type}) status: ` +
        `${relationship.previousStatus ?? '(none)'} -> ${relationship.currentStatus}.`,
    );
  }
  for (const hypothesis of delta.changedHypotheses) {
    lines.push(
      `Hypothesis "${hypothesis.name}" confidence: ` +
        `${hypothesis.previousConfidence === null ? '(none)' : String(hypothesis.previousConfidence)} -> ${String(hypothesis.currentConfidence)}.`,
    );
  }
  for (const evidence of delta.newEvidence) {
    lines.push(`New evidence (${evidence.id}): ${evidence.description}`);
  }
  return lines;
}

function collectFalsifiers(effects: ModelEffect[], currentState: ResearchState): string[] {
  const falsifiers = new Set<string>();
  for (const effect of effects) {
    if (effect.sourceHypothesisId !== undefined) {
      const hypothesis = currentState.hypotheses.find((h) => h.id === effect.sourceHypothesisId);
      for (const falsifier of hypothesis?.falsifiers ?? []) falsifiers.add(falsifier.description);
    }
  }
  return Array.from(falsifiers);
}

/** One security's full alpha computation for one round — everything upstream of ensemble
 * combination/portfolio construction. Exported for direct testing and reuse by a domain bot's own
 * `backtest/walkForward.ts`. */
export interface SecurityAlphaComputation {
  ticker: string;
  /** All 5 alphas, PRE-ablation — `computeTradingDecisions` applies ablation only at the
   * ensemble-combination step, so a factor's realized-IC history keeps accumulating regardless of
   * the current ablation mode (see that function's own doc comment). */
  signals: AlphaSignal[];
  exposure: ExposureMap;
  valuation: CompanyValuation;
  /** The static anchor `computeBlendedBaseValuePerShare` blended against this round — see
   * `valuation/pointInTimeAnchor.ts`. */
  staticBaseAnchor: ScenarioValue;
  marketImplied: MarketImpliedGap | undefined;
  dailyVolatility: number | undefined;
  researchChanges: string[];
  modelEffects: string[];
  falsifiers: string[];
}

/**
 * The delta -> effects -> valuation -> alpha pipeline for ONE security (spec-lineage: point-in-time
 * snapshot -> delta -> event interpretation -> valuation), fanned out into 5 independent
 * `AlphaSignal`s instead of one discrete signal bucket. Pure function of its inputs — no clock, no
 * randomness, no I/O. `domain` supplies the one genuinely domain-specific piece (see
 * `DomainAdapter`); `trackedEntityIds` is this config's own tracked universe (every security's
 * `targetEntityId`), used only for `ModelEffect.scope` classification.
 */
export function computeSecurityAlpha<TDomainAssumptions>(params: {
  date: string | null;
  security: SecurityConfig<TDomainAssumptions>;
  previousResearchState: ResearchState | undefined;
  currentResearchState: ResearchState;
  currentPriceDollars: number;
  priceHistory: DailyBar[];
  alphaEnsemble: AlphaEnsemblePolicy;
  domain: DomainAdapter<TDomainAssumptions>;
  trackedEntityIds: ReadonlySet<string>;
}): SecurityAlphaComputation {
  const delta = computeResearchDelta(params.previousResearchState, params.currentResearchState);
  const effects = interpretResearchDelta(
    delta,
    params.currentResearchState,
    params.security.targetEntityId,
    params.trackedEntityIds,
  );
  const exposure = computeExposureMap(params.currentResearchState, params.security.targetEntityId);

  const staticBaseAnchor = resolveStaticBaseAnchor(
    params.security.valuation.baseBusinessValuePerShare,
    params.priceHistory,
    params.currentPriceDollars,
    params.alphaEnsemble.baseAnchor,
  );
  const baseBusinessValue = computeBlendedBaseValuePerShare(
    staticBaseAnchor,
    params.priceHistory,
    params.alphaEnsemble.rollingWindowDays,
    params.alphaEnsemble.rollingBlendWeight,
  );
  const domainValue = params.domain.computeDomainValue({
    assumptions: params.security.valuation.domain,
    sharesOutstanding: params.security.sharesOutstanding,
  });
  const valuation = computeCompanyValuation({
    ticker: params.security.ticker,
    asOf: params.currentResearchState.timestamp,
    baseBusinessValue,
    domainValue,
    domainOptionValueBaseline: params.security.valuation.domainOptionValueBaselinePerShare,
    effects,
    sensitivities: params.security.valuation.sensitivities,
    unknowns: [...params.domain.knownValuationUnknowns],
  });

  const marketImplied = params.domain.computeMarketImpliedGap({
    marketPricePerShare: params.currentPriceDollars,
    baseBusinessValuePerShare: baseBusinessValue,
    domainOptionValuePerShare: valuation.domainOptionValue,
    domainAssumptions: params.security.valuation.domain,
    sharesOutstanding: params.security.sharesOutstanding,
  });

  const dailyVolatility = computeDailyVolatility(
    params.priceHistory,
    params.alphaEnsemble.rollingWindowDays,
  );

  const signals: AlphaSignal[] = [
    computeEvidenceDeltaAlpha({ ticker: params.security.ticker, date: params.date, effects }),
    computeCommercializationAlpha({ ticker: params.security.ticker, date: params.date, effects }),
    computeValuationGapAlpha({
      ticker: params.security.ticker,
      date: params.date,
      fairValuePerShare: valuation.fairValue.base,
      marketPriceDollars: params.currentPriceDollars,
    }),
    computeMarketImpliedAlpha({ ticker: params.security.ticker, date: params.date, marketImplied }),
    computeMomentumAlpha({
      ticker: params.security.ticker,
      date: params.date,
      priceHistory: params.priceHistory,
      currentPriceDollars: params.currentPriceDollars,
      windowDays: params.alphaEnsemble.momentumWindowDays,
    }),
  ];

  return {
    ticker: params.security.ticker,
    signals,
    exposure,
    valuation,
    staticBaseAnchor,
    marketImplied,
    dailyVolatility,
    researchChanges: describeResearchChanges(delta),
    modelEffects: effects.map((e) => e.rationale),
    falsifiers: collectFalsifiers(effects, params.currentResearchState),
  };
}

/** Per-security state remembered between rounds — what this security's alpha ensemble produced
 * LAST round (awaiting this round's price to become a realized IC sample), plus its last fair
 * value for reporting. */
export interface PreviousQuantState {
  fairValuePerShare?: number;
  pendingSignals?: AlphaSignal[];
  pendingPriceDollars?: number;
}

export interface TradingDecision {
  date: string | null;
  security: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  expectedReturn: number;
  confidence: number;
  /** This round's measured (or equal-weight-fallback) ensemble weight per alpha factor — shared
   * across every security this round, surfaced per-decision for explainability. */
  ensembleWeights: Record<string, number>;
  /** THIS security's exact share of `expectedReturn` attributable to each alpha factor — an exact
   * decomposition (see `alpha/ic.ts`'s `combineAlphaEnsemble`), not an approximation: summing
   * every value here reproduces `expectedReturn` up to floating-point rounding. A factor absent
   * from this record had zero weight this round (ablated away, or not yet measured with any
   * weight), not a hidden zero contribution. */
  alphaContribution: Record<string, number>;
  /** Why this name was (or wasn't) sized at all this round — see `portfolio/selection.ts`.
   * `score` is `expectedReturn * confidence`; `rank` is 1-based among every priced security
   * (same ordering `top_k` uses), so an unselected name can say "ranked 6th of 11, top 4 held". */
  selection: {
    mode: 'threshold' | 'top_k';
    score: number;
    rank: number;
    rankedOf: number;
    selected: boolean;
    /** `top_k` only. */
    k?: number;
    /** `threshold` only — the `activationThreshold` a score had to clear. */
    threshold?: number;
  };
  /** Where this round's static valuation anchor came from — see `valuation/pointInTimeAnchor.ts`.
   * `basePerShare` is that anchor's base case (the first close seen, under `first_observed`). */
  baseAnchor: { mode: 'first_observed' | 'config'; basePerShare: number };
  /** Portfolio construction's own output, BEFORE the risk engine's shrink pass. */
  desiredWeight: number;
  /** The risk-engine's final weight, actually used to build `orders`. */
  targetWeight: number;
  /** Every reason the risk engine shrank this security's weight this round — empty when it didn't. */
  riskAdjustments: string[];
  portfolioConstructionNote: string;
  valuationBefore: number | undefined;
  valuationAfter: number;
  valuationBreakdown: CompanyValuation;
  marketImplied: MarketImpliedGap | undefined;
  exposure: ExposureMap;
  researchChanges: string[];
  modelEffects: string[];
  falsifiers: string[];
  orders: OrderRequest[];
  orderCosts: OrderCostEstimate[];
  rationale: string;
}

/**
 * The multi-security, per-round orchestration — the alpha/portfolio-construction/risk separation,
 * end to end:
 *
 * 1. Realize last round's PENDING alpha predictions into `RealizedAlphaSample`s, using this
 *    round's price vs. the price recorded when those predictions were made (a genuine one-round
 *    forward return — never anything from beyond the round this function is currently processing,
 *    so there is no look-ahead).
 * 2. Compute each priced security's alpha signals (`computeSecurityAlpha`).
 * 3. Measure each factor's information coefficient from the accumulated realized samples
 *    (`alpha/ic.ts`), scoped to whichever factors survive `config.ablationMode`
 *    (`ablation.ts`'s `activeFactorsForMode`) — this is what makes ensemble weights MEASURED, not
 *    hand-picked.
 * 4. Combine each security's (post-ablation) signals into one expected-return/confidence pair.
 * 5. Compute pairwise blended (statistical + causal) effective correlation.
 * 6. Run the configured, PLUGGABLE portfolio-construction strategy.
 * 7. Run the independent risk engine — shrink-only, every adjustment reported.
 * 8. Generate orders, largest desired long weight first for the shared cash budget.
 */
/** `map.get(key)`, guaranteed present by construction (every caller below builds `map` FROM the
 * same `pricedSecurities`/index bounds it then looks `key` back up in) — throws rather than
 * silently returning `undefined` if that invariant is ever actually violated, instead of a bare
 * `!` assertion. */
function requireFromMap<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined)
    throw new Error(
      `unreachable: "${key}" missing from a map built from the same priced securities`,
    );
  return value;
}

export function computeTradingDecisions<TDomainAssumptions>(params: {
  date: string | null;
  config: QuantStrategyConfig<TDomainAssumptions>;
  domain: DomainAdapter<TDomainAssumptions>;
  previousResearchState: ResearchState | undefined;
  currentResearchState: ResearchState;
  currentPricesByTicker: Map<string, number>;
  historyByTicker: Map<string, DailyBar[]>;
  previousByTicker: Map<string, PreviousQuantState>;
  realizedAlphaSamples: RealizedAlphaSample[];
  portfolio: PortfolioObservation;
}): {
  decisions: TradingDecision[];
  updatedRealizedAlphaSamples: RealizedAlphaSample[];
  updatedPreviousByTicker: Map<string, PreviousQuantState>;
} {
  const pricedSecurities = params.config.securities.filter((s) =>
    params.currentPricesByTicker.has(s.ticker),
  );
  const trackedEntityIds = new Set(params.config.securities.map((s) => s.targetEntityId));

  const newSamples: RealizedAlphaSample[] = [];
  for (const security of pricedSecurities) {
    const previous = params.previousByTicker.get(security.ticker);
    if (previous?.pendingSignals === undefined || previous.pendingPriceDollars === undefined)
      continue;
    const currentPrice = requireFromMap(params.currentPricesByTicker, security.ticker);
    const realizedForwardReturn = currentPrice / previous.pendingPriceDollars - 1;
    for (const signal of previous.pendingSignals) {
      newSamples.push({ factor: signal.factor, predicted: signal.value, realizedForwardReturn });
    }
  }
  const updatedRealizedAlphaSamples = [...params.realizedAlphaSamples, ...newSamples].slice(
    -params.config.alphaEnsemble.maxAlphaHistorySamples,
  );

  const alphaByTicker = new Map(
    pricedSecurities.map((security) => [
      security.ticker,
      computeSecurityAlpha({
        date: params.date,
        security,
        previousResearchState: params.previousResearchState,
        currentResearchState: params.currentResearchState,
        currentPriceDollars: requireFromMap(params.currentPricesByTicker, security.ticker),
        priceHistory: params.historyByTicker.get(security.ticker) ?? [],
        alphaEnsemble: params.config.alphaEnsemble,
        domain: params.domain,
        trackedEntityIds,
      }),
    ]),
  );

  const icStats = measureAlphaIC(updatedRealizedAlphaSamples);
  const presentFactors = activeFactorsForMode(params.config.ablationMode);
  const weightByFactor = computeEnsembleWeights(
    icStats,
    presentFactors,
    params.config.alphaEnsemble.minSamplesForMeasuredIC,
  );
  const ensembleWeights = Object.fromEntries(weightByFactor);

  const standardization = params.config.alphaEnsemble.signalStandardization;
  const factorScales =
    standardization === undefined
      ? undefined
      : computeFactorScales(
          updatedRealizedAlphaSamples,
          [...alphaByTicker.values()].flatMap((alpha) => alpha.signals),
        );
  const combinedByTicker = new Map(
    pricedSecurities.map((security) => {
      const alpha = requireFromMap(alphaByTicker, security.ticker);
      const filtered = applyAblation(alpha.signals, params.config.ablationMode);
      const scaled =
        standardization === undefined || factorScales === undefined
          ? filtered
          : standardizeSignals(filtered, factorScales, standardization);
      return [security.ticker, combineAlphaEnsemble(scaled, weightByFactor)] as const;
    }),
  );

  const returnsByTicker = new Map(
    pricedSecurities.map((security) => [
      security.ticker,
      computeReturnsSeries(
        params.historyByTicker.get(security.ticker) ?? [],
        params.config.alphaEnsemble.rollingWindowDays,
      ),
    ]),
  );
  const effectiveCorrelationByPair = new Map<string, number>();
  for (let i = 0; i < pricedSecurities.length; i++) {
    for (let j = i + 1; j < pricedSecurities.length; j++) {
      const a = pricedSecurities[i];
      const b = pricedSecurities[j];
      if (a === undefined || b === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
      const statistical = computePearsonCorrelation(
        returnsByTicker.get(a.ticker) ?? [],
        returnsByTicker.get(b.ticker) ?? [],
      );
      const causal = computeCausalOverlap(
        requireFromMap(alphaByTicker, a.ticker).exposure,
        requireFromMap(alphaByTicker, b.ticker).exposure,
      );
      effectiveCorrelationByPair.set(
        effectiveCorrelationKey(a.ticker, b.ticker),
        computeEffectiveCorrelation(statistical, causal, params.config.correlationBlend),
      );
    }
  }

  const alphaInputs: AlphaInput[] = pricedSecurities.map((security) => {
    const combined = requireFromMap(combinedByTicker, security.ticker);
    return {
      ticker: security.ticker,
      expectedReturn: combined.expectedReturn,
      confidence: combined.confidence,
      dailyVolatility: requireFromMap(alphaByTicker, security.ticker).dailyVolatility,
    };
  });
  const strategy = selectPortfolioStrategy(params.config.portfolioConstruction.strategy);
  const constructionResult = strategy.construct(
    { alphas: alphaInputs, effectiveCorrelationByPair },
    params.config.portfolioConstruction,
  );

  const selectionPolicy = params.config.portfolioConstruction.selection ?? {
    mode: 'threshold' as const,
  };
  const selectedTickers = new Set(
    selectActiveAlphas(alphaInputs, params.config.portfolioConstruction).map((a) => a.ticker),
  );
  const scoreOf = (a: AlphaInput) => a.expectedReturn * a.confidence;
  const rankByTicker = new Map(
    [...alphaInputs]
      .sort((a, b) => scoreOf(b) - scoreOf(a) || (a.ticker < b.ticker ? -1 : 1))
      .map((a, index) => [a.ticker, index + 1]),
  );
  const anchorMode = (params.config.alphaEnsemble.baseAnchor ?? DEFAULT_BASE_ANCHOR_POLICY).mode;

  const exposureFootprintByTicker = new Map(
    pricedSecurities.map((security) => [
      security.ticker,
      exposureFootprint(requireFromMap(alphaByTicker, security.ticker).exposure),
    ]),
  );
  const riskResult = applyRiskEngine({
    desiredWeightByTicker: constructionResult.weightByTicker,
    exposureFootprintByTicker,
    equityCents: params.portfolio.equityCents,
    policy: params.config.risk,
  });

  const riskReasonsByTicker = new Map<string, string[]>();
  for (const adjustment of riskResult.adjustments) {
    const existing = riskReasonsByTicker.get(adjustment.ticker) ?? [];
    existing.push(adjustment.reason);
    riskReasonsByTicker.set(adjustment.ticker, existing);
  }

  const orderedSecurities = [...pricedSecurities].sort(
    (a, b) =>
      (riskResult.weightByTicker.get(b.ticker) ?? 0) -
      (riskResult.weightByTicker.get(a.ticker) ?? 0),
  );

  let remainingBuyingPowerCents = Math.max(0, spendableCentsFor(params.portfolio));
  const decisions: TradingDecision[] = [];
  const updatedPreviousByTicker = new Map<string, PreviousQuantState>();
  for (const security of orderedSecurities) {
    const currentPriceDollars = requireFromMap(params.currentPricesByTicker, security.ticker);
    const finalWeight = riskResult.weightByTicker.get(security.ticker) ?? 0;
    const orders = buildOrders({
      ticker: security.ticker,
      targetWeight: finalWeight,
      priceDollars: currentPriceDollars,
      portfolio: params.portfolio,
      policy: params.config.orderExecution,
      availableBuyingPowerCents: remainingBuyingPowerCents,
    });

    const priceCents = Math.round(currentPriceDollars * 100);
    for (const order of orders) {
      if (order.side === 'BUY') {
        remainingBuyingPowerCents = Math.max(
          0,
          remainingBuyingPowerCents - order.quantity * priceCents,
        );
      }
    }

    const orderCosts = orders.map((order) =>
      estimateOrderCost({
        ticker: security.ticker,
        notionalUsd: (order.side === 'BUY' ? 1 : -1) * order.quantity * currentPriceDollars,
        policy: params.config.execution,
      }),
    );

    const alpha = requireFromMap(alphaByTicker, security.ticker);
    const combined = requireFromMap(combinedByTicker, security.ticker);
    const previous = params.previousByTicker.get(security.ticker);
    const firstOrder = orders[0];
    const action: TradingDecision['action'] =
      firstOrder === undefined ? 'HOLD' : firstOrder.side === 'BUY' ? 'BUY' : 'SELL';
    const riskReasons = riskReasonsByTicker.get(security.ticker) ?? [];
    const desiredWeight = constructionResult.weightByTicker.get(security.ticker) ?? 0;

    const rationale =
      (alpha.researchChanges.length === 0
        ? 'No research change since the previous decision. '
        : `Research changed: ${alpha.researchChanges.join(' ')} `) +
      `Ensemble expected return ${(combined.expectedReturn * 100).toFixed(2)}%, confidence ${(combined.confidence * 100).toFixed(0)}%. ` +
      `${constructionResult.note} ` +
      (riskReasons.length > 0 ? `Risk engine adjustments: ${riskReasons.join(' ')} ` : '') +
      (orders.length === 0
        ? 'No trade: within rebalance tolerance or below the minimum order size.'
        : `Action: ${action} to move toward a ${(finalWeight * 100).toFixed(1)}% target weight.`);

    decisions.push({
      date: params.date,
      security: security.ticker,
      action,
      expectedReturn: combined.expectedReturn,
      confidence: combined.confidence,
      ensembleWeights,
      alphaContribution: combined.contributionByFactor,
      selection: {
        mode: selectionPolicy.mode,
        score: combined.expectedReturn * combined.confidence,
        rank: requireFromMap(rankByTicker, security.ticker),
        rankedOf: alphaInputs.length,
        selected: selectedTickers.has(security.ticker),
        ...(selectionPolicy.mode === 'top_k'
          ? { k: selectionPolicy.k }
          : { threshold: params.config.portfolioConstruction.activationThreshold }),
      },
      baseAnchor: { mode: anchorMode, basePerShare: alpha.staticBaseAnchor.base },
      desiredWeight,
      targetWeight: finalWeight,
      riskAdjustments: riskReasons,
      portfolioConstructionNote: constructionResult.note,
      valuationBefore: previous?.fairValuePerShare,
      valuationAfter: alpha.valuation.fairValue.base,
      valuationBreakdown: alpha.valuation,
      marketImplied: alpha.marketImplied,
      exposure: alpha.exposure,
      researchChanges: alpha.researchChanges,
      modelEffects: alpha.modelEffects,
      falsifiers: alpha.falsifiers,
      orders,
      orderCosts,
      rationale,
    });

    updatedPreviousByTicker.set(security.ticker, {
      fairValuePerShare: alpha.valuation.fairValue.base,
      pendingSignals: alpha.signals,
      pendingPriceDollars: currentPriceDollars,
    });
  }

  return { decisions, updatedRealizedAlphaSamples, updatedPreviousByTicker };
}

/** Human-readable, multi-line trace for dev/testing — callers decide where this goes (stderr, a
 * log file); production `decideAction` behavior never depends on this being read. */
export function formatStrategyTrace(decision: TradingDecision, botLabel = 'quant-sdk'): string {
  const contributionEntries = Object.entries(decision.alphaContribution).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  const lines = [
    `[${botLabel}] ${decision.date ?? '(no date)'} ${decision.security}`,
    `  fair value: ${decision.valuationBefore?.toFixed(4) ?? '(none)'} -> ${decision.valuationAfter.toFixed(4)}`,
    `  expected return: ${(decision.expectedReturn * 100).toFixed(2)}%  confidence: ${(decision.confidence * 100).toFixed(0)}%`,
    `  alpha contribution: ${
      contributionEntries.length === 0
        ? '(none)'
        : contributionEntries
            .map(([factor, value]) => `${factor} ${(value * 100).toFixed(2)}%`)
            .join(' | ')
    }`,
    `  desired weight: ${(decision.desiredWeight * 100).toFixed(1)}%  final (post-risk) weight: ${(decision.targetWeight * 100).toFixed(1)}%`,
    `  risk adjustments: ${decision.riskAdjustments.length === 0 ? '(none)' : decision.riskAdjustments.join(' | ')}`,
    `  action: ${decision.action}`,
    `  rationale: ${decision.rationale}`,
  ];
  return lines.join('\n');
}
