import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TRACKED_SECURITIES } from '@quant-fusion/fusion-universe';
import { createMarketDataStore, queryBarsAsOf } from '@quant-fusion/market-data';
import { resolveMarketUniverse } from '../customUniverses.js';
import { emitFreshForwardConfig } from '../emitForwardConfig.js';
import type { MarketUniverse } from '../marketUniverses.js';
import { parseQuantDecisions } from '../parseQuantDecisions.js';
import { defaultForwardMatchStoreDbPath } from '../paths.js';
import { runCli, type CommandResult } from '../subprocess.js';
import { ALLOW_LIVE_TRADING_ENV, createIbkrAdapter } from './brokers/ibkrClientPortal.js';
import { createSimAdapter } from './brokers/simBroker.js';
import { defaultLiveStoreDbPath, getTicket, saveTicket } from './liveStore.js';
import { evaluateOrders, type BotOrder } from './riskGate.js';
import type {
  BrokerAccountSnapshot,
  BrokerAdapter,
  BrokerOrderRequest,
  LivePortfolio,
  OrderTicket,
  TicketStatus,
} from './types.js';

/** A ticket older than this can't be approved — the bot decided on prices that are stale by then. */
export const TICKET_TTL_MS = 18 * 60 * 60 * 1000;
const LIVE_DECISION_MARKER = 'LIVE_DECISION_JSON:';

export function createBroker(rootDir: string, portfolio: LivePortfolio): BrokerAdapter {
  if (portfolio.broker === 'sim') return createSimAdapter(rootDir, portfolio.id);
  if (portfolio.accountId === undefined) throw new Error('IBKR portfolios need an accountId.');
  return createIbkrAdapter({
    accountId: portfolio.accountId,
    ...(portfolio.gatewayUrl !== undefined ? { gatewayUrl: portfolio.gatewayUrl } : {}),
    contracts: portfolio.contracts,
    allowLiveTrading: process.env[ALLOW_LIVE_TRADING_ENV] === '1',
  });
}

/** USD per one unit of `currency`, from the tracked security's flat rate (the same rate the
 * market-data store converts that ticker's prices with — see the FX caveat in `fusion-universe`). */
function usdRateFor(ticker: string, currency: string): number {
  if (currency === 'USD') return 1;
  const tracked = TRACKED_SECURITIES.find((s) => s.ticker === ticker);
  if (tracked?.currency !== currency) {
    throw new Error(`No USD conversion rate for ${ticker} in ${currency}.`);
  }
  return tracked.usdRate;
}

function defaultLotSize(ticker: string): number {
  return TRACKED_SECURITIES.find((s) => s.ticker === ticker)?.currency === 'JPY' ? 100 : 1;
}

/** Lot size per tradable ticker: IBKR needs a mapped contract; the simulator can trade anything
 * in the universe (with the exchange's usual lot size, to keep proposals realistic). */
export function lotSizesFor(
  portfolio: LivePortfolio,
  universe: MarketUniverse,
): Map<string, number> {
  if (portfolio.broker === 'sim') {
    return new Map(universe.tickers.map((t) => [t, defaultLotSize(t)]));
  }
  return new Map(portfolio.contracts.map((c) => [c.ticker, c.lotSize]));
}

function latestClosesUsd(universe: MarketUniverse, rootDir: string): Record<string, number> {
  const store = createMarketDataStore(defaultForwardMatchStoreDbPath(rootDir));
  const identity = { id: universe.datasetId, version: universe.datasetVersion };
  const today = new Date().toISOString().slice(0, 10);
  const prices: Record<string, number> = {};
  for (const ticker of universe.tickers) {
    const close = queryBarsAsOf(store, identity, ticker, today, 1).at(-1)?.close;
    if (close !== undefined) prices[ticker] = close;
  }
  return prices;
}

/** What the bot is told it holds: only mapped, in-universe positions (converted to USD cents),
 * and cash capped by `maxCapitalUsd`. Exported for tests. */
export function botPortfolioFor(
  portfolio: LivePortfolio,
  universe: MarketUniverse,
  snapshot: BrokerAccountSnapshot,
  pricesUsd: Readonly<Record<string, number>>,
) {
  const inUniverse = new Set(universe.tickers);
  const positions = snapshot.positions.flatMap((p) =>
    p.ticker !== undefined && inUniverse.has(p.ticker) && p.shares > 0
      ? [
          {
            ticker: p.ticker,
            shares: p.shares,
            averageEntryPriceCents: Math.round(
              p.averageCost * usdRateFor(p.ticker, p.currency) * 100,
            ),
          },
        ]
      : [],
  );
  const positionsValueUsd = positions.reduce(
    (sum, p) => sum + p.shares * (pricesUsd[p.ticker] ?? p.averageEntryPriceCents / 100),
    0,
  );
  const cap = portfolio.risk.maxCapitalUsd;
  const cashUsd = Math.max(
    0,
    cap === undefined ? snapshot.cashUsd : Math.min(snapshot.cashUsd, cap - positionsValueUsd),
  );
  return {
    portfolio: { cashCents: Math.round(cashUsd * 100), positions },
    cashUsd,
    equityUsd: cashUsd + positionsValueUsd,
    heldShares: new Map(positions.map((p) => [p.ticker, p.shares])),
  };
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function parseDecision(output: string): {
  date: string;
  orders: BotOrder[];
  pricesUsd: Record<string, number>;
} {
  const line = output.split('\n').find((l) => l.startsWith(LIVE_DECISION_MARKER));
  if (line === undefined) throw new Error('The bot produced no decision — see the log.');
  return JSON.parse(line.slice(LIVE_DECISION_MARKER.length)) as {
    date: string;
    orders: BotOrder[];
    pricesUsd: Record<string, number>;
  };
}

/** Injected so a test can stand in for the real `live decide` CLI (which needs Docker). */
export type DecideFn = (rootDir: string, args: string[]) => Promise<CommandResult>;

/**
 * Reads the account, asks the bot what it would do with it, runs the risk gate, and saves the
 * result as a `pending_approval` ticket. Never sends anything to the broker.
 */
export async function proposeTicket(
  rootDir: string,
  portfolio: LivePortfolio,
  deps: {
    broker?: BrokerAdapter;
    decide?: DecideFn;
    log?: (line: string) => void;
    emitConfig?: typeof emitFreshForwardConfig;
    latestPrices?: (universe: MarketUniverse) => Record<string, number>;
  } = {},
): Promise<OrderTicket> {
  const log = deps.log ?? (() => undefined);
  const broker = deps.broker ?? createBroker(rootDir, portfolio);
  const universe = await resolveMarketUniverse(rootDir, portfolio.universeId);
  if (universe === undefined) throw new Error(`Unknown universe "${portfolio.universeId}".`);

  const connection = await broker.connectionStatus();
  if (!connection.authenticated) throw new Error(connection.message ?? 'Broker not connected.');

  log(`Reading ${portfolio.broker} account…`);
  const snapshot = await broker.snapshot();
  const latestPrices = (deps.latestPrices ?? ((u) => latestClosesUsd(u, rootDir)))(universe);
  const bot = botPortfolioFor(portfolio, universe, snapshot, latestPrices);
  log(
    `Bot manages $${bot.equityUsd.toFixed(2)} ($${bot.cashUsd.toFixed(2)} cash, ${String(bot.portfolio.positions.length)} position(s)).`,
  );

  const config = await (deps.emitConfig ?? emitFreshForwardConfig)(rootDir, {
    marketDataset: {
      id: universe.datasetId,
      version: universe.datasetVersion,
      dbPath: defaultForwardMatchStoreDbPath(rootDir),
    },
    marketDataUniverse: [...universe.tickers],
    startDate: isoDate(-60),
    endDate: isoDate(365),
    execution: 'realistic',
  });
  if (!config.ok) throw new Error(config.error);

  const tempDir = await mkdtemp(path.join(tmpdir(), 'sm4-live-'));
  let result: CommandResult;
  try {
    const configPath = path.join(tempDir, 'config.json');
    const portfolioPath = path.join(tempDir, 'portfolio.json');
    await writeFile(configPath, JSON.stringify(config.config), 'utf8');
    await writeFile(portfolioPath, JSON.stringify(bot.portfolio), 'utf8');
    log(`Asking ${portfolio.botId} for its decision…`);
    result = await (deps.decide ?? runCli)(rootDir, [
      'live',
      'decide',
      portfolio.botId,
      '--config-file',
      configPath,
      '--portfolio-file',
      portfolioPath,
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  if (!result.ok) throw new Error('`live decide` failed — see the log.');
  const decision = parseDecision(result.output);

  const orders = evaluateOrders({
    botOrders: decision.orders,
    pricesUsd: decision.pricesUsd,
    heldShares: bot.heldShares,
    botCashUsd: bot.cashUsd,
    botEquityUsd: bot.equityUsd,
    lotSizeByTicker: lotSizesFor(portfolio, universe),
    limits: portfolio.risk,
    killSwitch: portfolio.killSwitch,
    newClientOrderId: () => `qf-${randomUUID().slice(0, 18)}`,
  });

  const ticket: OrderTicket = {
    id: randomUUID(),
    portfolioId: portfolio.id,
    botId: portfolio.botId,
    createdAt: new Date().toISOString(),
    decisionDate: decision.date,
    status: 'pending_approval',
    snapshot,
    botEquityUsd: bot.equityUsd,
    orders,
    rationale: parseQuantDecisions(result.output),
  };
  saveTicket(defaultLiveStoreDbPath(rootDir), ticket);
  log(
    `Ticket ${ticket.id}: ${String(orders.filter((o) => !o.blocked).length)} sendable, ${String(orders.filter((o) => o.blocked).length)} blocked.`,
  );
  return ticket;
}

function roundPrice(price: number, currency: string): number {
  return currency === 'JPY' || currency === 'KRW'
    ? Math.round(price)
    : Math.round(price * 100) / 100;
}

/** Converts approved, unblocked ticket orders into broker orders (prices in each contract's own
 * currency). Exported for tests. */
export function brokerOrdersFor(
  portfolio: LivePortfolio,
  ticket: OrderTicket,
): BrokerOrderRequest[] {
  return ticket.orders
    .filter((o) => !o.blocked && o.quantity > 0)
    .map((o) => {
      const contract = portfolio.contracts.find((c) => c.ticker === o.ticker);
      const currency = portfolio.broker === 'ibkr' ? (contract?.currency ?? 'USD') : 'USD';
      const rate = usdRateFor(o.ticker, currency);
      return {
        ticker: o.ticker,
        side: o.side,
        quantity: o.quantity,
        orderType: o.orderType,
        ...(o.limitPriceUsd !== undefined
          ? { limitPrice: roundPrice(o.limitPriceUsd / rate, currency) }
          : {}),
        referencePrice: o.referencePriceUsd / rate,
        ...(contract !== undefined ? { contract } : {}),
        clientOrderId: o.clientOrderId,
      };
    });
}

function settledStatus(ticket: OrderTicket): TicketStatus {
  const sent = ticket.orders.filter((o) => o.status !== undefined);
  const open = sent.some(
    (o) =>
      o.status?.state === 'pending' ||
      o.status?.state === 'submitted' ||
      o.status?.state === 'partially_filled',
  );
  if (open) return 'submitted';
  return sent.length > 0 && sent.every((o) => o.status?.state === 'rejected')
    ? 'failed'
    : 'completed';
}

/** Human approval → sends every unblocked order to the broker. Re-checks the kill switch and the
 * ticket's age at approval time, not just at proposal time. */
export async function approveTicket(
  rootDir: string,
  portfolio: LivePortfolio,
  ticketId: string,
  deps: { broker?: BrokerAdapter } = {},
): Promise<OrderTicket> {
  const dbPath = defaultLiveStoreDbPath(rootDir);
  const ticket = getTicket(dbPath, ticketId);
  if (ticket?.portfolioId !== portfolio.id)
    throw new Error(`No ticket "${ticketId}" for this portfolio.`);
  if (ticket.status !== 'pending_approval') throw new Error(`Ticket is already ${ticket.status}.`);
  if (portfolio.killSwitch) throw new Error('Kill switch is on — nothing can be sent.');
  if (Date.now() - Date.parse(ticket.createdAt) > TICKET_TTL_MS) {
    const expired = { ...ticket, status: 'expired' as const, decidedAt: new Date().toISOString() };
    saveTicket(dbPath, expired);
    throw new Error('Ticket expired — propose a fresh one.');
  }

  const requests = brokerOrdersFor(portfolio, ticket);
  const now = new Date().toISOString();
  if (requests.length === 0) {
    const done = { ...ticket, status: 'completed' as const, decidedAt: now };
    saveTicket(dbPath, done);
    return done;
  }
  // Marked submitted BEFORE calling the broker: if this process dies mid-send, the ticket can
  // never be approved (and sent) a second time.
  const sending: OrderTicket = { ...ticket, status: 'submitted', decidedAt: now, submittedAt: now };
  saveTicket(dbPath, sending);
  try {
    const statuses = await (deps.broker ?? createBroker(rootDir, portfolio)).placeOrders(requests);
    const byId = new Map(statuses.map((s) => [s.clientOrderId, s]));
    const updated: OrderTicket = {
      ...sending,
      orders: sending.orders.map((o) => {
        const status = byId.get(o.clientOrderId);
        return status === undefined ? o : { ...o, status };
      }),
    };
    updated.status = settledStatus(updated);
    saveTicket(dbPath, updated);
    return updated;
  } catch (error) {
    const failed: OrderTicket = {
      ...sending,
      status: 'failed',
      error: `${error instanceof Error ? error.message : String(error)} — check the broker directly; some orders may have been sent.`,
    };
    saveTicket(dbPath, failed);
    return failed;
  }
}

export function rejectTicket(
  rootDir: string,
  portfolio: LivePortfolio,
  ticketId: string,
): OrderTicket {
  const dbPath = defaultLiveStoreDbPath(rootDir);
  const ticket = getTicket(dbPath, ticketId);
  if (ticket?.portfolioId !== portfolio.id)
    throw new Error(`No ticket "${ticketId}" for this portfolio.`);
  if (ticket.status !== 'pending_approval') throw new Error(`Ticket is already ${ticket.status}.`);
  const rejected = { ...ticket, status: 'rejected' as const, decidedAt: new Date().toISOString() };
  saveTicket(dbPath, rejected);
  return rejected;
}

/** Pulls current order states from the broker for a submitted ticket. */
export async function refreshTicket(
  rootDir: string,
  portfolio: LivePortfolio,
  ticketId: string,
  deps: { broker?: BrokerAdapter } = {},
): Promise<OrderTicket> {
  const dbPath = defaultLiveStoreDbPath(rootDir);
  const ticket = getTicket(dbPath, ticketId);
  if (ticket?.portfolioId !== portfolio.id)
    throw new Error(`No ticket "${ticketId}" for this portfolio.`);
  if (ticket.status !== 'submitted') return ticket;
  const ids = ticket.orders.filter((o) => o.status !== undefined).map((o) => o.clientOrderId);
  const statuses = await (deps.broker ?? createBroker(rootDir, portfolio)).orderStatuses(ids);
  const byId = new Map(statuses.map((s) => [s.clientOrderId, s]));
  const updated: OrderTicket = {
    ...ticket,
    orders: ticket.orders.map((o) => {
      const fresh = byId.get(o.clientOrderId);
      // Keep earlier messages (e.g. confirmations IBKR asked for at submission).
      return fresh === undefined || o.status === undefined
        ? o
        : {
            ...o,
            status: { ...fresh, messages: [...new Set([...o.status.messages, ...fresh.messages])] },
          };
    }),
  };
  updated.status = settledStatus(updated);
  saveTicket(dbPath, updated);
  return updated;
}
