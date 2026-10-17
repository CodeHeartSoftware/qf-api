import { runBot } from '@quant-fusion/bot-sdk-js';
import {
  applyRiskEngine,
  assertPointInTimeAnchors,
  asResearchSnapshot,
  buildOrders,
  computeMarketImpliedAlpha,
  computeSecurityAlpha,
  DEFAULT_BASE_ANCHOR_POLICY,
  exposureFootprint,
  inverseVolatilityStrategy,
  mapScenario,
  spendableCentsFor,
  type AlphaInput,
  type DomainAdapter,
  type OrderRequest,
  type ResearchState,
  type StockMarket4Action,
  type StockMarket4Observation,
} from '@quant-fusion/quant-sdk-js';
import { DEFAULT_QUANT_LITE_CONFIG, KNOWN_VALUATION_UNKNOWNS, type QuantLiteConfig } from './config.js';
import { computeFusionValue } from './valuation/fusionValue.js';
import type { FusionValuationAssumptions } from './valuation/fusionValue.js';
import { computeMarketImpliedExpectationsFromScenarios } from './valuation/marketImplied.js';

/** Identical to quant-v0's own `FUSION_DOMAIN_ADAPTER` — the same real fusion revenue-chain
 * formula and per-company assumptions, since this bot's whole point is a different downstream
 * decision policy on top of the SAME proven, point-in-time-safe valuation, not a different
 * (unproven) view of what these 11 companies are worth. */
export const FUSION_DOMAIN_ADAPTER: DomainAdapter<FusionValuationAssumptions> = {
  computeDomainValue: ({ assumptions, sharesOutstanding }) =>
    mapScenario(computeFusionValue(assumptions).fusionValue, (companyTotal) => companyTotal / sharesOutstanding),
  computeMarketImpliedGap: (params) =>
    computeMarketImpliedExpectationsFromScenarios({
      marketPricePerShare: params.marketPricePerShare,
      baseBusinessValuePerShare: params.baseBusinessValuePerShare,
      domainOptionValuePerShare: params.domainOptionValuePerShare,
      fusion: params.domainAssumptions,
      sharesOutstanding: params.sharesOutstanding,
    }),
  knownValuationUnknowns: KNOWN_VALUATION_UNKNOWNS,
};

export interface QuantLiteDecision {
  date: string | null;
  ticker: string;
  priceDollars: number;
  fairValuePerShare: number;
  gap: number;
  targetWeight: number;
  orders: OrderRequest[];
}

/**
 * quant-lite's whole strategy, in one sentence: rank the same 11 real, point-in-time-anchored
 * securities quant-v0 tracks by ONE signal — modeled fair value vs. current price
 * (`computeSecurityAlpha`'s own `valuation.fairValue.base`, reused unmodified) — hold the top few,
 * sized by the SDK's own proven inverse-volatility strategy, and re-trade a name only once it
 * drifts well past its target.
 *
 * This is a deliberate response to three things quant-v0's own 2026-09 comparisons found, not a
 * new, unproven idea: (1) of quant-v0's 5 alpha signals, `valuation_gap` alone drove ~88-95% of
 * every decision's expected return — `evidence_delta`/`commercialization` contributed next to
 * nothing, so the extra machinery combining all 5 (measured IC weighting, correlation-aware
 * portfolio construction) was mostly overhead on top of one signal, not real diversification;
 * (2) quant-v0's realistic-execution cost drag ran ~3.5-3.7% of equity over the same backtest
 * window, from rebalancing a 4-name book against a tight 3% deadband every round; (3) a first,
 * equal-weight version of this bot's own top-K wasn't enough on its own — a direct multi-start
 * comparison showed quant-v0's inverse-volatility variant clearly beating its own equal-weight
 * variant (residual Sharpe 0.41 vs 0.03), so equal-weighting here was leaving real, already-proven
 * value on the table, not a safe simplification. This bot keeps the one signal that was actually
 * earning quant-v0's returns and the one sizing method that was actually adding value beyond it,
 * and removes only what genuinely wasn't earning its keep: no ensemble combination (nothing to
 * combine — one signal), no correlation-aware portfolio construction beyond the SDK's own
 * inverse-vol sizing, and a rebalance tolerance wider than quant-v0's own (0.05 vs 0.03) — tested
 * directly against 0.04 and the originally-chosen 0.08, not just assumed. quant-v0's own
 * concentration/thesis-group RISK stage, however, is reused unchanged (`applyRiskEngine`) — an
 * earlier version of this bot dropped it too, and a single-continuous-run backtest (not just a
 * multi-start average) showed a real, measurable cost for that: worse max drawdown than quant-v0
 * (20.7% vs 16.3%) from nothing stopping a top-K pick from concentrating in names that share the
 * same underlying research exposure. See `config.ts`'s own doc comments for the specifics.
 *
 * State retained between rounds is exactly one thing — the previous research snapshot, needed to
 * compute this round's research delta — the same "nothing from the future, nothing invented"
 * discipline `computeSecurityAlpha` itself already enforces; this bot adds no state of its own
 * beyond that.
 */
export function createDecideAction(
  config: QuantLiteConfig = DEFAULT_QUANT_LITE_CONFIG,
  onDecision?: (decision: QuantLiteDecision) => void,
): (observation: StockMarket4Observation) => StockMarket4Action {
  let previousResearchState: ResearchState | undefined;
  let anchorsChecked = false;
  const trackedEntityIds = new Set(config.securities.map((s) => s.targetEntityId));

  return function decideAction(observation: StockMarket4Observation): StockMarket4Action {
    // Refuse to trade on a valuation anchor from this bot's own future — same guard quant-v0 has
    // to pass, checked once against the first dated observation.
    if (!anchorsChecked && observation.date !== null) {
      assertPointInTimeAnchors(
        config.securities,
        config.alphaEnsemble.baseAnchor ?? DEFAULT_BASE_ANCHOR_POLICY,
        observation.date,
      );
      anchorsChecked = true;
    }

    const snapshot = asResearchSnapshot(observation.research);
    const currentResearchState = snapshot?.state;
    if (currentResearchState === undefined) {
      return { orders: [] };
    }

    const currentPricesByTicker = new Map<string, number>();
    const historyByTicker = new Map<string, (typeof observation.securities)[number]['history']>();
    for (const security of observation.securities) {
      if (security.bar !== null) currentPricesByTicker.set(security.ticker, security.bar.close);
      historyByTicker.set(security.ticker, security.history);
    }

    const priced = config.securities.filter((s) => currentPricesByTicker.has(s.ticker));
    const gaps = priced.map((security) => {
      const priceDollars = currentPricesByTicker.get(security.ticker) ?? 0;
      const alpha = computeSecurityAlpha({
        date: observation.date,
        security,
        previousResearchState,
        currentResearchState,
        currentPriceDollars: priceDollars,
        priceHistory: historyByTicker.get(security.ticker) ?? [],
        alphaEnsemble: config.alphaEnsemble,
        domain: FUSION_DOMAIN_ADAPTER,
        trackedEntityIds,
      });
      const fairValuePerShare = alpha.valuation.fairValue.base;
      const gap = priceDollars > 0 ? (fairValuePerShare - priceDollars) / priceDollars : 0;
      // A small, fixed-weight second signal — quant-v0's own 2026-09 attribution measured
      // `market_implied` as the one OTHER factor with a real (if much smaller) contribution: mean
      // |contribution| ~0.009 vs. `valuation_gap`'s ~0.063, roughly a 1:7 ratio. `0.15` here
      // approximates that same ratio as a fixed weight — a broader, 12-start comparison (not just
      // the narrower 4-start one this bot was first tuned against) showed a valuation_gap-only
      // score underperforming quant-v0's own full ensemble; this is a small, evidenced correction
      // toward it, not a new invented signal. `computeMarketImpliedAlpha` is reused unmodified —
      // same scale constant (`MARKET_IMPLIED_SCALE`) quant-v0 itself uses.
      const marketImpliedValue = computeMarketImpliedAlpha({
        ticker: security.ticker,
        date: observation.date,
        marketImplied: alpha.marketImplied,
      }).value;
      const score = gap + 0.15 * marketImpliedValue;
      return {
        ticker: security.ticker,
        priceDollars,
        fairValuePerShare,
        gap,
        score,
        dailyVolatility: alpha.dailyVolatility,
        exposureFootprint: exposureFootprint(alpha.exposure),
      };
    });

    // Which names, and how much of each — reusing the SDK's own proven `top_k` selection +
    // inverse-volatility sizing (see `config.ts`'s own doc comment for why: quant-v0's inverse-vol
    // variant clearly beat its equal-weight one on residual Sharpe). This bot's one real signal
    // (the valuation gap) stands in for `AlphaInput.expectedReturn`, with `confidence` fixed at 1 —
    // there's no second signal to blend against it, so a varying confidence would only add an
    // unearned extra degree of freedom.
    const alphaInputs: AlphaInput[] = gaps.map((g) => ({
      ticker: g.ticker,
      expectedReturn: g.score,
      confidence: 1,
      dailyVolatility: g.dailyVolatility,
    }));
    const constructionResult = inverseVolatilityStrategy.construct(
      { alphas: alphaInputs, effectiveCorrelationByPair: new Map() },
      config.portfolioConstruction,
    );

    // The SDK's own risk stage, reused unchanged — shrink-only, every adjustment reported (see
    // `config.ts`'s own doc comment on why this bot has one at all: a single-continuous-run
    // backtest showed WORSE max drawdown than quant-v0 without it, from nothing stopping this
    // bot's top-K from landing on several names that share the same underlying research exposure
    // at once).
    const exposureFootprintByTicker = new Map(gaps.map((g) => [g.ticker, g.exposureFootprint]));
    const riskResult = applyRiskEngine({
      desiredWeightByTicker: constructionResult.weightByTicker,
      exposureFootprintByTicker,
      equityCents: observation.portfolio.equityCents,
      policy: config.risk,
    });

    // Every priced security gets an explicit target weight — `riskResult.weightByTicker` already
    // defaults every non-selected name to 0 (carried through from `inverseVolatility.ts`'s own
    // default), so a name that just fell out of the top-K is actually closed rather than merely
    // left alone.
    const targetWeightByTicker = riskResult.weightByTicker;

    // Sells (target 0) ordered before buys — matches quant-v0's own `remainingBuyingPowerCents`
    // convention: only BUY orders draw down this round's self-imposed spending budget, so a
    // same-round SELL's proceeds aren't assumed spendable until they actually settle.
    const orderedTickers = [...targetWeightByTicker.entries()].sort((a, b) => a[1] - b[1]);

    let remainingBuyingPowerCents = Math.max(0, spendableCentsFor(observation.portfolio));
    const orders: OrderRequest[] = [];
    for (const [ticker, targetWeight] of orderedTickers) {
      const priceDollars = currentPricesByTicker.get(ticker);
      if (priceDollars === undefined) continue;

      const generated = buildOrders({
        ticker,
        targetWeight,
        priceDollars,
        portfolio: observation.portfolio,
        policy: config.orderPolicy,
        availableBuyingPowerCents: remainingBuyingPowerCents,
      });
      for (const order of generated) {
        if (order.side === 'BUY') {
          remainingBuyingPowerCents = Math.max(
            0,
            remainingBuyingPowerCents - order.quantity * Math.round(priceDollars * 100),
          );
        }
      }
      orders.push(...generated);

      const gapEntry = gaps.find((g) => g.ticker === ticker);
      if (onDecision !== undefined && gapEntry !== undefined) {
        onDecision({
          date: observation.date,
          ticker,
          priceDollars: gapEntry.priceDollars,
          fairValuePerShare: gapEntry.fairValuePerShare,
          gap: gapEntry.gap,
          targetWeight,
          orders: generated,
        });
      }
    }

    previousResearchState = currentResearchState;
    return { orders };
  };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runBot<StockMarket4Observation, StockMarket4Action>({
    decideAction: createDecideAction(DEFAULT_QUANT_LITE_CONFIG, (decision) => {
      process.stderr.write(
        `[quant-lite] ${decision.date ?? '(no date)'} ${decision.ticker} ` +
          `price=${decision.priceDollars.toFixed(2)} fairValue=${decision.fairValuePerShare.toFixed(2)} ` +
          `gap=${(decision.gap * 100).toFixed(1)}% targetWeight=${(decision.targetWeight * 100).toFixed(1)}%\n`,
      );
    }),
  });
}
