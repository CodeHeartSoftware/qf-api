import { createResearchSnapshot } from '@quant-fusion/research-core';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '@quant-fusion/research-fusion';
import type {
  DailyBar,
  PortfolioObservation,
  ResearchSnapshot,
  ResearchState,
  StockMarket4Observation,
} from '@quant-fusion/quant-sdk-js';

/**
 * Reuses the REAL `@quant-fusion/research-fusion` fixture dataset (vendored as a devDependency
 * tarball — see `../../vendor/`) to build snapshots for this bot's acceptance tests, rather than
 * hand-rolling a smaller fake dataset. `createResearchSnapshot` is research-core's own point-in-
 * time reconstruction (already covered by that package's own temporal-integrity tests); this bot
 * only reads its output.
 */
const dataset = createFusionFixtureDataset();

export const ELMT_ENTITY_ID = FUSION_FIXTURE_IDS.entities.elmt;
export const ARC_ENTITY_ID = FUSION_FIXTURE_IDS.entities.arc;
export const SCHWABMUNCHEN_ENTITY_ID = FUSION_FIXTURE_IDS.entities.schwabmunchenMetalOperations;
export const AMS_OSRAM_ENTITY_ID = FUSION_FIXTURE_IDS.entities.amsOsram;

export const ACQUISITION_RELATIONSHIP_ID = FUSION_FIXTURE_IDS.relationships.elmtSchwabmunchen;
export const MANUFACTURES_TUNGSTEN_RELATIONSHIP_ID =
  FUSION_FIXTURE_IDS.relationships.elmtManufacturesTungsten;
export const ARC_POTENTIAL_CUSTOMER_RELATIONSHIP_ID =
  'rel-schwabmunchen-potential-fusion-customer-arc';
export const ARC_FUSION_QUALIFICATION_RELATIONSHIP_ID =
  'rel-schwabmunchen-fusion-qualification-arc';
export const ACQUISITION_ANNOUNCED_EVENT_ID =
  FUSION_FIXTURE_IDS.events.elmtAmsOsramAcquisitionAnnounced;

/** The real fixture's own snapshot instant — the day the ELMT/Schwabmünchen acquisition becomes
 * knowable (spec §18). */
export const ACQUISITION_DAY = '2026-09-08T00:00:00Z';
export const DAY_BEFORE_ACQUISITION = '2026-09-07T00:00:00Z';

export function fusionSnapshotAt(timestamp: string): ResearchSnapshot {
  // research-core's own snapshot is Zod-validated and field-for-field identical to
  // `@quant-fusion/quant-sdk-js`'s hand-declared mirror (see that package's own
  // `research/types.ts` doc comment) — a structural cast, not an unsafe one.
  return createResearchSnapshot(dataset, timestamp) as unknown as ResearchSnapshot;
}

export function fusionStateAt(timestamp: string): ResearchState {
  return fusionSnapshotAt(timestamp).state;
}

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 100_000 };
}

/** `buyingPowerCents: 0` here is deliberate, not an oversight — it's the REAL default
 * stock-market-4 reports for a plain cash account (`config.risk.allowShortSelling: false`, the
 * game's own default), per `games/stock-market-4/README.md`'s "Risk & financing" section. Using
 * anything else here would let this whole test suite mask exactly the bug
 * `spendableCentsFor`/`buildOrders` fixed (a cash-account BUY reading `buyingPowerCents` directly
 * instead of falling back to `cashCents`) — see `@quant-fusion/quant-sdk-js`'s `portfolio.ts`
 * own doc comment. */
export function emptyPortfolio(cashCents = 10_000_000): PortfolioObservation {
  return {
    cashCents,
    equityCents: cashCents,
    positions: [],
    equityHistory: [],
    buyingPowerCents: 0,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };
}

/** `buyingPowerCents: 0` — same reasoning as `emptyPortfolio`'s own doc comment: this is the real
 * cash-account default, not an arbitrary placeholder. */
export function portfolioWithPosition(params: {
  ticker: string;
  shares: number;
  averageEntryPriceCents: number;
  priceCents: number;
  cashCents?: number;
}): PortfolioObservation {
  const cashCents = params.cashCents ?? 5_000_000;
  const marketValueCents = params.shares * params.priceCents;
  const equityCents = cashCents + marketValueCents;
  return {
    cashCents,
    equityCents,
    positions: [
      {
        ticker: params.ticker,
        shares: params.shares,
        averageEntryPriceCents: params.averageEntryPriceCents,
        realizedPnlCents: 0,
        marketValueCents,
        unrealizedPnlCents: marketValueCents - params.shares * params.averageEntryPriceCents,
      },
    ],
    equityHistory: [],
    buyingPowerCents: 0,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };
}

/** Builds a full `StockMarket4Observation` for `ticker`/`priceDollars` at `date`, carrying
 * `research` as whatever `researchSnapshot` is (or `undefined`, matching a round with no research
 * delivery at all). */
export function buildObservation(params: {
  round: number;
  date: string;
  ticker: string;
  priceDollars: number;
  portfolio: PortfolioObservation;
  researchSnapshot: ResearchSnapshot | undefined;
}): StockMarket4Observation {
  return {
    round: params.round,
    totalRounds: 100,
    opponentIds: [],
    marketDataMode: 'historical',
    date: params.date,
    securities: [
      {
        ticker: params.ticker,
        bar: bar(params.date, params.priceDollars),
        history: [],
      },
    ],
    corporateActions: [],
    portfolio: params.portfolio,
    fills: [],
    research: params.researchSnapshot,
  };
}
