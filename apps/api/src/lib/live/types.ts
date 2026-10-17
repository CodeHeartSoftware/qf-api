// Live (real-account) trading — a bot managing a broker account, as opposed to a simulated
// forward match. The bot itself is unchanged: `apps/cli`'s `live decide` hands it an observation
// built from the broker's real positions/cash, and its orders go through `riskGate.ts` and a human
// approval step before any broker ever sees them.

/** `ibkr` = Interactive Brokers via the local Client Portal Gateway (paper accounts only, unless
 * `QUANT_FUSION_ALLOW_LIVE_TRADING=1`); `sim` = an in-app paper simulator that fills at the bot's own
 * reference prices — for trying the whole workflow with no broker at all. */
export type BrokerKind = 'ibkr' | 'sim';

/** How one tracked ticker maps onto a broker contract. IBKR identifies every instrument by a
 * numeric `conid`; `lotSize` is the exchange's minimum trading unit (100 on the Tokyo Stock
 * Exchange, 1 almost everywhere else) — proposed quantities are rounded DOWN to it. */
export interface ContractMapping {
  ticker: string;
  conid: number;
  exchange?: string;
  currency: string;
  lotSize: number;
}

export interface RiskLimits {
  /** Largest single order, in USD notional at the bot's reference price. */
  maxOrderNotionalUsd: number;
  /** Total notional traded per ticket, as % of the bot-visible equity. */
  maxDailyTurnoverPct: number;
  /** Largest post-trade position, as % of the bot-visible equity (BUYs only). */
  maxPositionWeightPct: number;
  /** Caps how much of the account the bot is allowed to manage: the bot sees
   * `min(cash, maxCapitalUsd - its positions' value)` as its cash. Omit to give it the whole
   * account's cash. */
  maxCapitalUsd?: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOrderNotionalUsd: 5_000,
  maxDailyTurnoverPct: 25,
  maxPositionWeightPct: 30,
};

export interface LivePortfolio {
  id: string;
  name: string;
  botId: string;
  broker: BrokerKind;
  /** IBKR account id (`DU…` for paper). Unused for `sim`. */
  accountId?: string;
  /** Client Portal Gateway base URL; defaults to `https://localhost:5000`. */
  gatewayUrl?: string;
  universeId: string;
  contracts: ContractMapping[];
  risk: RiskLimits;
  /** When on, every proposed order is blocked and approval is refused. */
  killSwitch: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerPosition {
  /** Our ticker when the broker contract is mapped; `undefined` for a holding outside the
   * portfolio's mapped universe (shown, never handed to the bot). */
  ticker?: string;
  conid?: number;
  description: string;
  shares: number;
  /** Per-share average cost in `currency`. */
  averageCost: number;
  currency: string;
  /** Broker-reported market value in USD, when the broker gives one. */
  marketValueUsd?: number;
}

export interface BrokerAccountSnapshot {
  accountId: string;
  asOf: string;
  cashUsd: number;
  netLiquidationUsd: number;
  positions: BrokerPosition[];
}

export type OrderSide = 'BUY' | 'SELL';

export interface BrokerOrderRequest {
  ticker: string;
  side: OrderSide;
  quantity: number;
  orderType: 'MKT' | 'LMT';
  /** In the contract's own currency. */
  limitPrice?: number;
  /** In the contract's own currency — what `sim` fills at. */
  referencePrice: number;
  contract?: ContractMapping;
  clientOrderId: string;
}

export type BrokerOrderState =
  'pending' | 'submitted' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';

export interface BrokerOrderStatus {
  clientOrderId: string;
  brokerOrderId?: string;
  state: BrokerOrderState;
  filledQuantity: number;
  averageFillPrice?: number;
  /** Anything the broker said about the order (warnings it was confirmed through, rejections). */
  messages: string[];
}

export interface BrokerConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  message?: string;
}

export interface ContractCandidate {
  conid: number;
  symbol: string;
  description: string;
  exchange?: string;
  currency?: string;
}

export interface BrokerAdapter {
  kind: BrokerKind;
  connectionStatus(): Promise<BrokerConnectionStatus>;
  snapshot(): Promise<BrokerAccountSnapshot>;
  placeOrders(orders: BrokerOrderRequest[]): Promise<BrokerOrderStatus[]>;
  orderStatuses(clientOrderIds: string[]): Promise<BrokerOrderStatus[]>;
  searchContracts(symbol: string): Promise<ContractCandidate[]>;
}

export interface RiskCheck {
  rule: string;
  ok: boolean;
  message: string;
}

export interface ProposedOrder {
  clientOrderId: string;
  ticker: string;
  side: OrderSide;
  /** What the bot asked for. */
  requestedQuantity: number;
  /** After lot rounding and SELL clamping — what would actually be sent. */
  quantity: number;
  orderType: 'MKT' | 'LMT';
  limitPriceUsd?: number;
  referencePriceUsd: number;
  notionalUsd: number;
  checks: RiskCheck[];
  /** Any failed check blocks the order — it's shown on the ticket but never sent. */
  blocked: boolean;
  status?: BrokerOrderStatus;
}

export type TicketStatus =
  'pending_approval' | 'rejected' | 'expired' | 'submitted' | 'completed' | 'failed';

/** One bot decision for one real account, awaiting (or past) human approval. */
export interface OrderTicket {
  id: string;
  portfolioId: string;
  botId: string;
  createdAt: string;
  /** The latest market-data date the bot decided on. */
  decisionDate: string;
  status: TicketStatus;
  snapshot: BrokerAccountSnapshot;
  /** What the bot was told it had, after `maxCapitalUsd` and unmapped holdings are applied. */
  botEquityUsd: number;
  orders: ProposedOrder[];
  /** `QUANT_DECISION_JSON` rationale lines the bot emitted, when it emits them. */
  rationale: unknown[];
  decidedAt?: string;
  submittedAt?: string;
  error?: string;
}
