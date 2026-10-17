import {
  constantScenario,
  type AlphaEnsemblePolicy,
  type QuantStrategyConfig,
  type SecurityConfig,
  type ValuationSensitivities,
} from '@quant-fusion/quant-sdk-js';
import type { FusionValuationAssumptions } from './valuation/fusionValue.js';

/**
 * This bot's own instantiation of `@quant-fusion/quant-sdk-js`'s generic `QuantStrategyConfig`/
 * `SecurityConfig`, applied to `FusionValuationAssumptions` — see `valuation/fusionValue.ts` for
 * why that's the one genuinely domain-specific piece. A future domain bot supplies its own
 * assumptions type here instead.
 */
export type FusionQuantConfig = QuantStrategyConfig<FusionValuationAssumptions>;
export type FusionSecurityConfig = SecurityConfig<FusionValuationAssumptions>;

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
  rollingWindowDays: 20,
  // Shorter than rollingWindowDays on purpose — see AlphaEnsemblePolicy's own doc comment.
  momentumWindowDays: 10,
  // Same illustrative starting point fusion-fundamental-v7's ConfidenceCalibration used.
  rollingBlendWeight: 0.08,
  // Point-in-time anchor (2026-09 audit): the config `baseBusinessValuePerShare` values above are
  // the min/last/max close of the backtest window itself, pulled after it ended, so using them in
  // a backtest hands `valuation_gap` the window's ending price on day one. `first_observed` anchors
  // on the first close the bot actually sees instead. Switch to `{ mode: 'config' }` only for runs
  // starting after every `anchorAsOf` (the bot refuses otherwise — see `src/index.ts`).
  baseAnchor: { mode: 'first_observed', bandPct: 0.25 },
  // `signalStandardization` (quant-sdk-js `alpha/standardize.ts`) is deliberately NOT enabled yet
  // (2026-09 audit). Raw valuation_gap dominates the combination; standardizing it to equal footing
  // with the other four factors dropped the 10-start residual Sharpe from ~2.2 to ~0-1 (at 0.03 per
  // unit the bot barely clears activationThreshold at all; at 0.10 it trades but shows no
  // measurable alpha). That means the surviving edge lives almost entirely in valuation_gap — a
  // decision about the model's design, not a constant to tune here.
  // Raised from 10 (2026-09 review): `decision.ts` pools one realized sample per PRICED SECURITY
  // per round into each factor's history — with 11 tracked securities, a factor could already
  // clear a threshold of 10 after just ONE round transition, from a single day's cross-section.
  // That's cross-sectional breadth, not the temporal diversity IC is actually supposed to measure
  // (a market-wide move on one day makes every factor look correlated with returns that day,
  // contaminating all ~11 "samples" with the same single-day noise). This is now the point where
  // `alpha/ic.ts`'s continuous shrinkage crosses 50% trust (2026-09 review #2 — the sampleSize <
  // minSamples cutoff this comment originally described was replaced with continuous
  // `n / (n + minSamples)` shrinkage; see that function's own doc comment for why a single-day
  // cross-section contaminating "40 samples" is now a matter of degree, not an all-or-nothing
  // trap — a factor with, say, 15 tainted same-day samples now gets ~27% trust, not 0% or 100%).
  // 40 requires roughly 4 full rounds of real cross-section to reach even that halfway point —
  // still fast in absolute days given this dataset's real size (~70 trading days total), but
  // meaningfully harder to satisfy from one lucky/unlucky day. Not a rigorously derived number —
  // this whole dataset is too small yet for one (see this bot's own README caveats) — just a more
  // conservative floor than 10 was.
  minSamplesForMeasuredIC: 40,
  maxAlphaHistorySamples: 2_000,
};

export const DEFAULT_FUSION_QUANT_CONFIG: FusionQuantConfig = {
  securities: ALL_SECURITIES,
  alphaEnsemble,
  correlationBlend: {
    // Illustrative starting point (not fitted/swept) — see CorrelationBlendPolicy's own doc
    // comment for why causal overlap gets a meaningful, non-trivial share given how little real
    // price history exists to estimate statistical correlation from right now.
    causalWeight: 0.4,
  },
  portfolioConstruction: {
    strategy: 'inverse_volatility',
    // A security whose |expectedReturn*confidence| is below 1% is left at zero — illustrative,
    // not swept: small enough that a genuine, confidently-held alpha isn't filtered out, large
    // enough that pure noise mostly doesn't activate a position.
    activationThreshold: 0.01,
    // 60% of equity deployed gross across active positions — leaves real dry powder/cash buffer,
    // same order of magnitude as fusion-fundamental-v7's emergencyCashReservePct+dryPowderTargetPct
    // combined, without carrying over that bot's own separate reserve mechanism verbatim.
    totalGrossBudgetPct: 0.6,
    maxPositionWeight: 0.25,
    // Hold the 4 best positive views (~top third of 11), not every name clearing
    // activationThreshold (2026-09 audit, option B). k=4 was picked before evaluating. 10-start
    // walk-forward on dataset v4 from January: threshold -3% / residual Sharpe -1.2, top_k +54% /
    // +0.86 ±0.48; on the Jul-Sep window the two are within noise (2.7 vs 2.2). activationThreshold
    // is unused under top_k.
    selection: { mode: 'top_k', k: 4, minScore: 0 },
  },
  risk: {
    maxPositionWeight: 0.25,
    thesisGroupCap: {
      // Same illustrative starting points fusion-fundamental-v7's ThesisGroupCapPolicy used.
      minSharedExposureIds: 1,
      maxGroupWeight: 0.25 * 1.5,
    },
    // Illustrative starting point (not researched) — a proxy for "how much of this name's real
    // average daily dollar volume this strategy is willing to assume it could trade without
    // meaningfully moving the price."
    defaultLiquidityCapUsd: 2_000_000,
  },
  execution: {
    // Illustrative, not calibrated against any real broker/venue.
    flatFeeUsd: 1,
    impactCoefficient: 0.1,
    averageDailyVolumeUsdByTicker: new Map(),
    defaultAverageDailyVolumeUsd: 2_000_000,
  },
  // 'full' — every alpha active. See @quant-fusion/quant-sdk-js's `ablation.ts` for the other three
  // modes and `backtest/walkForward.ts` for where each gets exercised as part of the Full/Null/
  // Research-only/Price-only comparison the plan calls out as the key scientific test of this
  // whole approach.
  ablationMode: 'full',
  orderExecution: {
    minOrderNotionalCents: 5_000,
    // Same illustrative starting point fusion-fundamental-v7's own rebalanceToleranceWeight used.
    rebalanceToleranceWeight: 0.03,
  },
};
