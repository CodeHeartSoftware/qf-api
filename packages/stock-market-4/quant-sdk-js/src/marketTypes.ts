/**
 * A hand-declared local copy of `@quant-fusion/game-stock-market-4`'s `StockMarket4Observation` /
 * `StockMarket4Action` shapes (games/stock-market-4/src/types.ts) — not imported, since `bots/**`
 * is deliberately not a Yarn workspace member (see `docs/adr/0001-monorepo-and-boundary.md`; every
 * other TypeScript bot on the platform does the same, e.g.
 * `bots/rock-paper-scissors/only-rock/src/index.ts`'s own `RpsObservation`). Only the fields this
 * strategy actually reads are included; kept field-for-field faithful to the real game so nothing
 * here silently drifts from what a real match actually sends.
 */

export type CalendarDate = string;

export interface DailyBar {
  date: CalendarDate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SecurityMarketObservation {
  ticker: string;
  bar: DailyBar | null;
  history: DailyBar[];
}

export type CorporateActionType =
  'CASH_DIVIDEND' | 'STOCK_SPLIT' | 'REVERSE_SPLIT' | 'BUYBACK' | 'ACQUISITION' | 'DELISTING';

export interface CorporateAction {
  type: CorporateActionType;
  ticker: string;
  date: CalendarDate;
  announcedDate?: CalendarDate | undefined;
  [key: string]: unknown;
}

export interface PositionObservation {
  ticker: string;
  shares: number;
  averageEntryPriceCents: number;
  realizedPnlCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
}

export interface EquityPoint {
  date: CalendarDate;
  equityCents: number;
}

export interface RiskStats {
  borrowFeesPaidCents: number;
  marginCalls: number;
  forcedLiquidations: number;
}

export interface PortfolioObservation {
  cashCents: number;
  equityCents: number;
  positions: PositionObservation[];
  equityHistory: EquityPoint[];
  buyingPowerCents: number;
  maintenanceRequirementCents: number;
  belowMaintenance: boolean;
  riskStats: RiskStats;
}

export type OrderSide = 'BUY' | 'SELL';

export interface Fill {
  ticker: string;
  side: OrderSide;
  kind: 'MARKET' | 'LIMIT';
  requestedQuantity: number;
  filledQuantity: number;
  priceCents: number;
  feeCents: number;
}

export type MarketDataMode = 'historical' | 'synthetic';

/** What this bot actually receives each round. `research` is intentionally `unknown` here too —
 * see `research/types.ts` for how this bot (and only this bot) chooses to interpret it. */
export interface StockMarket4Observation {
  round: number;
  totalRounds: number;
  opponentIds: string[];
  marketDataMode: MarketDataMode;
  date: CalendarDate | null;
  securities: SecurityMarketObservation[];
  corporateActions: CorporateAction[];
  portfolio: PortfolioObservation;
  fills: Fill[];
  research: unknown;
}

export type OrderRequest =
  | { kind: 'MARKET'; ticker: string; side: OrderSide; quantity: number }
  | { kind: 'LIMIT'; ticker: string; side: OrderSide; quantity: number; limitPrice: number };

export interface StockMarket4Action {
  orders: OrderRequest[];
}
