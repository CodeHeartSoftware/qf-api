import {
  constantScenario,
  type AlphaEnsemblePolicy,
  type OrderPolicy,
  type PortfolioConstructionPolicy,
  type RiskPolicy,
  type SecurityConfig,
} from '@quant-fusion/quant-sdk-js';
import type { FusionValuationAssumptions } from './valuation/fusionValue.js';

export type FusionSecurityConfig = SecurityConfig<FusionValuationAssumptions>;

/**
 * This bot's own, deliberately small config shape — unlike quant-v0's `QuantStrategyConfig`, there
 * is no alpha-ensemble-combination or correlation/risk-engine layer here at all (see
 * `src/index.ts`'s own doc comment for why: quant-v0's own measured attribution showed 4 of its 5
 * alpha signals contribute next to nothing, and its real cost drag ran ~3.5-3.7% of equity from
 * frequent rebalancing — this bot targets exactly those two findings, not a new signal).
 * `securities`/`alphaEnsemble` are still `@quant-fusion/quant-sdk-js` shapes, reused because
 * `computeSecurityAlpha` (the one piece of quant-v0's pipeline this bot DOES reuse) requires them.
 * `portfolioConstruction` reuses the SDK's own `inverseVolatilityStrategy` + `selectActiveAlphas`
 * too (2026-09 comparison: quant-v0's inverse-volatility sizing clearly beat its equal-weight
 * variant on residual Sharpe, 0.41 vs 0.03 on a 4-start January comparison — real, not noise —
 * so this bot reuses that proven sizing rather than a naive equal-weight split). See `src/index.ts`
 * for how a security's valuation gap stands in for `AlphaInput.expectedReturn` there.
 */
export interface QuantLiteConfig {
  securities: FusionSecurityConfig[];
  alphaEnsemble: AlphaEnsemblePolicy;
  portfolioConstruction: PortfolioConstructionPolicy;
  /** Reintroduced after a real finding: a single-continuous-run backtest (the full Jan-Sep window,
   * not a multi-start average) showed this bot with a WORSE max drawdown than quant-v0
   * (20.7% vs 16.3%) despite competitive-or-better return on shorter windows — removing quant-v0's
   * thesis-group/concentration risk stage entirely, not just its ensemble/correlation machinery,
   * meant nothing stopped this bot's own top-K from landing on several names that share the same
   * underlying research exposure (e.g. multiple tungsten-supply-chain names) at once. Reuses the
   * SDK's own `applyRiskEngine` UNCHANGED — shrink-only, every adjustment reported — the same
   * risk stage quant-v0 itself uses, not a new one. */
  risk: RiskPolicy;
  /** `rebalanceToleranceWeight` here is deliberately WIDER than quant-v0's own 0.03 — the single
   * biggest lever this bot pulls against quant-v0's measured cost drag: tolerate more ordinary
   * daily price drift before re-trading a name back to its exact target. */
  orderPolicy: OrderPolicy;
}

/** What research does NOT establish for this bot's real security — carried over unchanged from
 * `fusion-fundamental-v7`'s own list — reported on every decision (`CompanyValuation.unknowns`)
 * so a reader never mistakes fair value for a fully-known figure. Supplied to the SDK's
 * `DomainAdapter.knownValuationUnknowns` in `index.ts`. */
export const KNOWN_VALUATION_UNKNOWNS: readonly string[] = [
  'acquired historical revenue of the Schwabmünchen operation',
  'acquired historical EBITDA/profitability of the Schwabmünchen operation',
  'final purchase consideration for the acquisition',
  'exact tungsten/molybdenum production capacity and current utilization',
  'exact incremental EBIT margin ELMT will realize on the acquired operation',
  'exact fusion-program customer revenue, if any, ELMT will ever realize',
];

/**
 * ELMT's assumptions, anchored to its own real trading history (stockanalysis.com daily closes,
 * IPO 2026-06-30 through 2026-09-09): `base` is the last real close before the Schwabmünchen
 * acquisition became public (2026-09-04, $16.78), `bear`/`bull` are the lowest/highest real closes
 * seen in the stock's entire (short) public life so far (2026-07-29 low $12.74; 2026-08-21 high
 * $19.89) — narrower than the halving/doubling spread below since it's grounded in an actual
 * observed distribution, not a guess. `sharesOutstanding`: 30.46M, stockanalysis.com, as of
 * 2026-09-09.
 */
const ELMT_SECURITY: FusionSecurityConfig = {
  ticker: 'ELMT',
  targetEntityId: 'entity-elmt',
  sharesOutstanding: 30_460_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 12.74, base: 16.78, bull: 19.89 },
    anchorAsOf: '2026-09-09', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.5, bull: 1.5 },
    domain: {
      reactorDeployments: { bear: 3, base: 8, bull: 20 },
      tungstenContentTonnes: { bear: 20, base: 40, bull: 60 },
      // Approximate tungsten-alloy market price; not a researched fact for this dataset.
      tungstenPriceUsdPerTonne: { bear: 35_000, base: 45_000, bull: 60_000 },
      // UNKNOWN in research whether ELMT will supply ARC or any other program at all — this is a
      // bear/base/bull ASSUMPTION about eventual capture, not a belief this bot has evidence for.
      // It must never be raised except by an explicit, evidenced research change.
      supplierCapture: { bear: 0, base: 0.05, bull: 0.15 },
      replacementDemand: { bear: 1, base: 1.3, bull: 1.8 },
      incrementalEbitMargin: { bear: 0.1, base: 0.18, bull: 0.25 },
      valuationMultiple: { bear: 4, base: 7, bull: 11 },
    },
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.5,
      manufacturingCapabilityToDomainOptionPerShare: 0.4,
      hypothesisConfidenceToDomainOptionPerShare: 0.25,
      // Illustrative starting ratio (2x the hypothesis sensitivity) — a qualification/contract-tier
      // change is treated as twice as consequential as a generic hypothesis shift; not swept/tuned.
      supplierCaptureToDomainOptionPerShare: 0.5,
    },
  },
};

/**
 * A ZERO fusion-revenue-chain: `computeFusionValue`'s formula (reactorDeployments *
 * tungstenContentTonnes * tungstenPriceUsdPerTonne * supplierCapture * replacementDemand) was
 * modeled specifically on ELMT — a tungsten-COMPONENT manufacturer. It does NOT mechanically fit
 * Furukawa (an HTS-WIRE supplier), Vitzro Nextech (aerospace/plasma COMPONENTS, not tungsten), or
 * Almonty (a tungsten CONCENTRATE miner selling into a broad industrial market fusion is a small
 * slice of, not a discrete component order). Force-fitting the same formula to a different business
 * model would be manufactured precision. Until each of those gets its own properly-shaped formula,
 * their fusion channel stays honestly at zero — their fair value comes from
 * `baseBusinessValuePerShare` (real, anchored) plus a small `domainOptionValueBaselinePerShare` for
 * their evidenced-but-unquantified fusion involvement, nothing invented on top.
 */
const NO_FUSION_ASSUMPTIONS: FusionValuationAssumptions = {
  reactorDeployments: constantScenario(0),
  tungstenContentTonnes: constantScenario(0),
  tungstenPriceUsdPerTonne: constantScenario(0),
  supplierCapture: constantScenario(0),
  replacementDemand: constantScenario(0),
  incrementalEbitMargin: constantScenario(0),
  valuationMultiple: constantScenario(0),
};

/**
 * Furukawa Electric (TSE:5801) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from JPY at that day's USD/JPY spot rate (153.605) — see
 * `backtest/furukawaHistoricalPrices.ts`. `base` = most recent USD close (2026-09-09); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: 703.5M
 * (stockanalysis.com, 2026-09-09). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Furukawa
 * has a REAL, evidenced HTS-wire supply relationship with CFS/SPARC, but that's a wire business,
 * not a tungsten-component one; `domainOptionValueBaselinePerShare` (~3%/9% of base, the same ratio
 * ELMT's own placeholder used) is the only channel that can move for it right now.
 */
const FURUKAWA_SECURITY: FusionSecurityConfig = {
  ticker: 'FURUKAWA', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-furukawa',
  sharesOutstanding: 703_500_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 18.05, base: 26.88, bull: 30.79 },
    anchorAsOf: '2026-09-09', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.81, bull: 2.42 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.39,
      manufacturingCapabilityToDomainOptionPerShare: 0.65,
      hypothesisConfidenceToDomainOptionPerShare: 0.4,
      supplierCaptureToDomainOptionPerShare: 0.8,
    },
  },
};

/**
 * Vitzro Nextech (KOSDAQ:488900) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from KRW at that day's USD/KRW spot rate (~1386.155, a 30-day average — no single
 * point-in-time quote was available) — see `backtest/vitzroNextechHistoricalPrices.ts`.
 * `sharesOutstanding`: 28.98M (stockanalysis.com, 2026-09-09). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — Vitzro Nextech's fusion involvement (KSTAR/ITER components) is
 * aerospace/plasma-component manufacturing, not the tungsten-component chain ELMT's formula models.
 */
const VITZRO_NEXTECH_SECURITY: FusionSecurityConfig = {
  ticker: 'VITZRONEXTECH', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-vitzro-nextech',
  sharesOutstanding: 28_980_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 4.95, base: 7.26, bull: 8.42 },
    anchorAsOf: '2026-09-09', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.22, bull: 0.65 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.65,
      manufacturingCapabilityToDomainOptionPerShare: 0.17,
      hypothesisConfidenceToDomainOptionPerShare: 0.11,
      supplierCaptureToDomainOptionPerShare: 0.22,
    },
  },
};

/**
 * Almonty Industries (NASDAQ:ALM) — real daily closes, stockanalysis.com, pulled 2026-09-09
 * (already USD). `sharesOutstanding`: 288,109,013 (stockanalysis.com, 2026-09-09). Fusion channel
 * is zero (see `NO_FUSION_ASSUMPTIONS`) — Almonty mines/sells tungsten CONCENTRATE into a broad
 * existing industrial market; fusion demand is a small, currently-unquantified slice of that
 * market, not a discrete component order like ELMT's or Freemelt's.
 */
const ALMONTY_SECURITY: FusionSecurityConfig = {
  ticker: 'ALM',
  targetEntityId: 'entity-almonty',
  sharesOutstanding: 288_109_013,
  valuation: {
    baseBusinessValuePerShare: { bear: 10.95, base: 18.56, bull: 19.12 },
    anchorAsOf: '2026-09-09', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.56, bull: 1.67 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.65,
      manufacturingCapabilityToDomainOptionPerShare: 0.45,
      hypothesisConfidenceToDomainOptionPerShare: 0.28,
      supplierCaptureToDomainOptionPerShare: 0.56,
    },
  },
};

/**
 * Freemelt Holding AB (STO:FREEM) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from SEK at that day's USD/SEK spot rate (9.5868) — see
 * `backtest/freemeltHistoricalPrices.ts`. `base`/`bear`/`bull` anchor to the last REAL close BEFORE
 * the Sept 9 order announcement (2026-09-08), not the most recent close. `sharesOutstanding`:
 * 227.7M (stockanalysis.com, 2026-09-09).
 *
 * Fusion channel is zero (`NO_FUSION_ASSUMPTIONS`) for the same reason as the others — but unlike
 * them, Freemelt's `domainOptionValueBaselinePerShare` is grounded directly in the REAL order
 * Fusion for Energy awarded Freemelt for JT-60SA: base value SEK 55M / potential SEK 84M, converted
 * to USD at the same spot rate, times an assumed 15% margin and ELMT's own 7x multiple (both still
 * STRATEGY ASSUMPTIONS), divided by shares outstanding. `bear: 0` — the order could still fail to
 * convert into realized margin.
 */
const FREEMELT_SECURITY: FusionSecurityConfig = {
  ticker: 'FREEM',
  targetEntityId: 'entity-freemelt',
  sharesOutstanding: 227_700_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 0.1262, base: 0.1356, bull: 0.2222 },
    anchorAsOf: '2026-09-09', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.0265, bull: 0.0404 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.0121,
      manufacturingCapabilityToDomainOptionPerShare: 0.0033,
      hypothesisConfidenceToDomainOptionPerShare: 0.002,
      supplierCaptureToDomainOptionPerShare: 0.004,
    },
  },
};

/**
 * Syntec Optics (NASDAQ:OPTX) — real daily closes, stockanalysis.com, pulled 2026-09-10. `bear`/
 * `base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window (see
 * `backtest/optxHistoricalPrices.ts`). `sharesOutstanding`: ~40.28M (stockanalysis.com,
 * approximate, as of 2026-09-10). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Syntec
 * supplies specialized OPTICS, not the tungsten-component chain ELMT's formula models.
 */
const OPTX_SECURITY: FusionSecurityConfig = {
  ticker: 'OPTX',
  targetEntityId: 'entity-syntec-optics',
  sharesOutstanding: 40_280_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 5.88, base: 8.19, bull: 12.17 },
    anchorAsOf: '2026-09-10', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.25, bull: 0.74 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.73,
      manufacturingCapabilityToDomainOptionPerShare: 0.2,
      hypothesisConfidenceToDomainOptionPerShare: 0.12,
      supplierCaptureToDomainOptionPerShare: 0.24,
    },
  },
};

/**
 * General Fusion (NASDAQ:GFUZ) — real daily closes, stockanalysis.com, pulled 2026-09-10. `bear`/
 * `base`/`bull` = lowest/last/highest real close over its real trading window (2026-07-13, its IPO
 * date, through 2026-08-31 — see `backtest/gfuzHistoricalPrices.ts`). `sharesOutstanding`: ~73.84M
 * (stockanalysis.com, approximate, as of 2026-09-10). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — General Fusion is a pure-play pre-revenue REACTOR DEVELOPER, not a
 * component supplier, so ELMT's tungsten-component-order formula has no analog here at all.
 */
const GFUZ_SECURITY: FusionSecurityConfig = {
  ticker: 'GFUZ',
  targetEntityId: 'entity-general-fusion',
  sharesOutstanding: 73_840_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 6.73, base: 8.1, bull: 13.76 },
    anchorAsOf: '2026-09-10', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.24, bull: 0.73 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.72,
      manufacturingCapabilityToDomainOptionPerShare: 0.19,
      hypothesisConfidenceToDomainOptionPerShare: 0.12,
      supplierCaptureToDomainOptionPerShare: 0.24,
    },
  },
};

/**
 * Fujikura Ltd. (TSE:5803) — real daily closes, stockanalysis.com, pulled 2026-09-11, converted
 * from JPY at that day's USD/JPY spot rate (153.58, Reuters) — see
 * `backtest/fujikuraHistoricalPrices.ts`. `base` = most recent USD close (2026-08-31); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: 1,655,659,296
 * (Fujikura FY2026 financial disclosure, as of 2026-03-31, post 6-for-1 split). Fusion channel is
 * zero (see `NO_FUSION_ASSUMPTIONS`) — Fujikura has a REAL, evidenced HTS-wire supply relationship
 * with CFS, but that's a wire business, not the tungsten-component chain ELMT's formula models.
 */
const FUJIKURA_SECURITY: FusionSecurityConfig = {
  ticker: 'FUJIKURA', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-fujikura',
  sharesOutstanding: 1_655_659_296,
  valuation: {
    baseBusinessValuePerShare: { bear: 24.22, base: 35.84, bull: 39.58 },
    anchorAsOf: '2026-09-11', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 1.08, bull: 3.23 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 3.19,
      manufacturingCapabilityToDomainOptionPerShare: 0.86,
      hypothesisConfidenceToDomainOptionPerShare: 0.53,
      supplierCaptureToDomainOptionPerShare: 1.06,
    },
  },
};

/**
 * Sumitomo Electric Industries, Ltd. (TSE:5802) — real daily closes, stockanalysis.com, pulled
 * 2026-09-11, converted from JPY at that day's USD/JPY spot rate (153.58, Reuters) — see
 * `backtest/sumitomoHistoricalPrices.ts`. `base` = most recent USD close (2026-08-31); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: ~3.12B (S&P
 * Global Market Intelligence, as of 2026-06-30, post 4-for-1 split effective 2026-07-01). Fusion
 * channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Sumitomo (with A.L.M.T.) has a REAL, evidenced
 * ITER tungsten-monoblock production contract (~¥3.5B, dated 2021), but that revenue is already
 * fully absorbed into its real trading range.
 */
const SUMITOMO_SECURITY: FusionSecurityConfig = {
  ticker: 'SUMITOMO', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-sumitomo',
  sharesOutstanding: 3_120_000_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 13.43, base: 14.46, bull: 18.45 },
    anchorAsOf: '2026-09-11', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.43, bull: 1.3 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.29,
      manufacturingCapabilityToDomainOptionPerShare: 0.34,
      hypothesisConfidenceToDomainOptionPerShare: 0.21,
      supplierCaptureToDomainOptionPerShare: 0.42,
    },
  },
};

/**
 * Kennametal Inc. (NYSE:KMT) — real daily closes, stockanalysis.com, pulled 2026-09-11. `bear`/
 * `base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window (see
 * `backtest/kmtHistoricalPrices.ts`). `sharesOutstanding`: 76,219,022 (Kennametal SEC filing, as of
 * 2026-07-31). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — the research dataset's own
 * `commodityTrap` assertion names Kennametal explicitly as a caution case: general tungsten
 * exposure through tooling and materials is not the same as capturing fusion economics.
 */
const KMT_SECURITY: FusionSecurityConfig = {
  ticker: 'KMT',
  targetEntityId: 'entity-kennametal',
  sharesOutstanding: 76_219_022,
  valuation: {
    baseBusinessValuePerShare: { bear: 29.27, base: 29.34, bull: 36.06 },
    anchorAsOf: '2026-09-11', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.88, bull: 2.64 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.61,
      manufacturingCapabilityToDomainOptionPerShare: 0.7,
      hypothesisConfidenceToDomainOptionPerShare: 0.43,
      supplierCaptureToDomainOptionPerShare: 0.86,
    },
  },
};

/**
 * American Superconductor Corporation (NASDAQ:AMSC) — real daily closes, stockanalysis.com, pulled
 * 2026-09-11. `bear`/`base`/`bull` = lowest/last/highest real close over the
 * 2026-07-01..2026-08-31 window (see `backtest/amscHistoricalPrices.ts`). `sharesOutstanding`:
 * 48,442,143 (AMSC Form 10-Q, as of 2026-07-31). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — the research dataset has no evidenced fusion-specific relationship for
 * AMSC yet (grid/power-electronics superconductor business, not a named fusion supplier).
 */
const AMSC_SECURITY: FusionSecurityConfig = {
  ticker: 'AMSC',
  targetEntityId: 'entity-amsc',
  sharesOutstanding: 48_442_143,
  valuation: {
    baseBusinessValuePerShare: { bear: 26.64, base: 28.71, bull: 39.92 },
    anchorAsOf: '2026-09-11', // pull date — see this security's doc comment
    domainOptionValueBaselinePerShare: { bear: 0, base: 0.86, bull: 2.58 },
    domain: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.56,
      manufacturingCapabilityToDomainOptionPerShare: 0.69,
      hypothesisConfidenceToDomainOptionPerShare: 0.42,
      supplierCaptureToDomainOptionPerShare: 0.84,
    },
  },
};

/** Same 11 real-price-anchored securities `fusion-fundamental-v7` tracks — this bot's whole
 * point is a different alpha-combination/portfolio-construction/risk architecture ON TOP of the
 * same per-security valuation inputs, not a different universe. */
const ALL_SECURITIES: FusionSecurityConfig[] = [
  ELMT_SECURITY,
  FURUKAWA_SECURITY,
  VITZRO_NEXTECH_SECURITY,
  ALMONTY_SECURITY,
  FREEMELT_SECURITY,
  OPTX_SECURITY,
  GFUZ_SECURITY,
  FUJIKURA_SECURITY,
  SUMITOMO_SECURITY,
  KMT_SECURITY,
  AMSC_SECURITY,
];

const alphaEnsemble: AlphaEnsemblePolicy = {
  // Only `rollingWindowDays`, `rollingBlendWeight`, and `baseAnchor` actually affect this bot's
  // own decisions (they feed `computeSecurityAlpha`'s valuation, the one thing this bot reads from
  // it). `momentumWindowDays`/`minSamplesForMeasuredIC`/`maxAlphaHistorySamples` are required
  // fields of the SDK's own `AlphaEnsemblePolicy` type but feed signals/ensemble machinery this
  // bot never calls (`combineAlphaEnsemble`, `measureAlphaIC`) — copied from quant-v0 for a valid,
  // harmless value, not because they do anything here.
  rollingWindowDays: 20,
  momentumWindowDays: 10,
  rollingBlendWeight: 0.08,
  // Point-in-time anchor — NEVER `{ mode: 'config' }` (see quant-v0's own README/2026-09 audit on
  // why that mode hands a backtest hindsight it wouldn't really have had): `first_observed`
  // anchors on the first close THIS bot actually sees, the same fix quant-v0 already needed once.
  baseAnchor: { mode: 'first_observed', bandPct: 0.25 },
  minSamplesForMeasuredIC: 40,
  maxAlphaHistorySamples: 2_000,
};

export const DEFAULT_QUANT_LITE_CONFIG: QuantLiteConfig = {
  securities: ALL_SECURITIES,
  alphaEnsemble,
  portfolioConstruction: {
    // Unused under top_k (see `selection` below) — required by the shared
    // `PortfolioConstructionPolicy` type.
    activationThreshold: 0.02,
    // Same order of magnitude as quant-v0's own gross budget — a real cash buffer, not tuned here.
    totalGrossBudgetPct: 0.6,
    // Higher than quant-v0's 0.25 — 3 names sized by inverse volatility already average ~33% each;
    // this is a real, independent cap (matters if `k` below is ever lowered to 1-2), not the thing
    // doing the sizing work.
    maxPositionWeight: 0.35,
    // Same k as quant-v0's own default — a 4-start comparison against a narrower top-3 book
    // (2026-09) showed k=4 clearly more consistent (lower return stdev, higher residual Sharpe)
    // without giving up return, so this bot matches quant-v0's own breadth rather than being more
    // concentrated for its own sake.
    // `minScore: 0.02` — tested against quant-v0's own `0` floor directly (2026-09 comparison):
    // `0` measurably UNDERPERFORMED (12-start total return 23.4% vs 26.5%), so the floor is a real,
    // evidenced improvement here, not an unjustified guess — reverted back after checking.
    selection: { mode: 'top_k', k: 4, minScore: 0.02 },
  },
  risk: {
    // Same value as `portfolioConstruction.maxPositionWeight` above — matches quant-v0's own
    // convention of keeping both in sync (this stage's cap is a real, independent backstop, not
    // meant to bind differently from portfolio construction's own intent).
    maxPositionWeight: 0.35,
    thesisGroupCap: {
      // Same illustrative starting points quant-v0 itself uses (carried over from
      // fusion-fundamental-v7's own ThesisGroupCapPolicy) — a group of names sharing real research
      // exposure can collectively exceed one name's own cap, but not by much.
      minSharedExposureIds: 1,
      maxGroupWeight: 0.35 * 1.5,
    },
    // Same illustrative starting point quant-v0 itself uses — a proxy for "how much of this name's
    // real average daily dollar volume this strategy is willing to assume it could trade without
    // meaningfully moving the price."
    defaultLiquidityCapUsd: 2_000_000,
  },
  orderPolicy: {
    minOrderNotionalCents: 5_000,
    // Wider than quant-v0's own 0.03 — a real lever against quant-v0's own measured cost drag
    // (2026-09 attribution: ~3.5-3.7% of equity over the same backtest window from frequent
    // rebalancing). Tested directly, not just assumed: 0.08 (originally chosen) measurably
    // UNDERPERFORMED both 0.03-ish behavior and this value on a 12-start comparison — wide enough
    // to miss real rebalancing opportunities, not just noise. 0.05 was the better of {0.04, 0.05,
    // 0.08} tested; stopped tuning there rather than keep narrowing the grid against the same
    // backtest (see this bot's own README on why).
    rebalanceToleranceWeight: 0.05,
  },
};
