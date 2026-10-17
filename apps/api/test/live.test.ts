import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIbkrAdapter,
  mapIbkrOrderState,
  type HttpTransport,
} from '../src/lib/live/brokers/ibkrClientPortal.js';
import { createSimAdapter, initSimAccount } from '../src/lib/live/brokers/simBroker.js';
import {
  defaultLiveStoreDbPath,
  getTicket,
  savePortfolio,
  saveTicket,
} from '../src/lib/live/liveStore.js';
import {
  approveTicket,
  botPortfolioFor,
  proposeTicket,
  rejectTicket,
} from '../src/lib/live/liveService.js';
import { evaluateOrders, type RiskGateInput } from '../src/lib/live/riskGate.js';
import { DEFAULT_RISK_LIMITS, type LivePortfolio } from '../src/lib/live/types.js';
import type { MarketUniverse } from '../src/lib/marketUniverses.js';

let counter = 0;
function gate(overrides: Partial<RiskGateInput>): ReturnType<typeof evaluateOrders> {
  return evaluateOrders({
    botOrders: [],
    pricesUsd: { AAA: 10, JPN: 20 },
    heldShares: new Map([['AAA', 100]]),
    botCashUsd: 10_000,
    botEquityUsd: 11_000,
    lotSizeByTicker: new Map([
      ['AAA', 1],
      ['JPN', 100],
    ]),
    limits: { maxOrderNotionalUsd: 5_000, maxDailyTurnoverPct: 50, maxPositionWeightPct: 40 },
    killSwitch: false,
    newClientOrderId: () => `c${String(++counter)}`,
    ...overrides,
  });
}

describe('evaluateOrders (risk gate)', () => {
  it('passes an ordinary in-limit order unchanged', () => {
    const [order] = gate({
      botOrders: [{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 50 }],
    });
    expect(order).toMatchObject({
      quantity: 50,
      notionalUsd: 500,
      blocked: false,
      orderType: 'MKT',
    });
  });

  it('rounds to whole lots and blocks below one lot', () => {
    const [ok, tooSmall] = gate({
      botOrders: [
        { kind: 'MARKET', ticker: 'JPN', side: 'BUY', quantity: 150 },
        { kind: 'MARKET', ticker: 'JPN', side: 'BUY', quantity: 99 },
      ],
    });
    expect(ok).toMatchObject({ requestedQuantity: 150, quantity: 100, blocked: false });
    expect(tooSmall).toMatchObject({ quantity: 0, blocked: true });
  });

  it('clamps a SELL to the shares held and never shorts', () => {
    const [clamped, short] = gate({
      botOrders: [
        { kind: 'MARKET', ticker: 'AAA', side: 'SELL', quantity: 250 },
        { kind: 'MARKET', ticker: 'JPN', side: 'SELL', quantity: 100 },
      ],
    });
    expect(clamped).toMatchObject({ quantity: 100, blocked: false });
    expect(short?.blocked).toBe(true);
  });

  it('blocks on notional, weight, unmapped contract, and the kill switch', () => {
    const [big] = gate({
      botOrders: [{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 600 }],
    });
    expect(big?.checks.find((c) => c.rule === 'max_order_notional')?.ok).toBe(false);
    const [heavy] = gate({
      limits: { ...DEFAULT_RISK_LIMITS, maxOrderNotionalUsd: 1e9, maxPositionWeightPct: 10 },
      botOrders: [{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 20 }], // 1200/11000 = 10.9%
    });
    expect(heavy?.checks.find((c) => c.rule === 'max_position_weight')?.ok).toBe(false);
    const [unmapped] = gate({
      lotSizeByTicker: new Map(),
      botOrders: [{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 1 }],
    });
    expect(unmapped?.blocked).toBe(true);
    const [killed] = gate({
      killSwitch: true,
      botOrders: [{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 1 }],
    });
    expect(killed?.blocked).toBe(true);
  });

  it('counts SELL proceeds before BUYs against cash and turnover', () => {
    const orders = gate({
      botCashUsd: 0,
      botEquityUsd: 1000,
      limits: { maxOrderNotionalUsd: 1e9, maxDailyTurnoverPct: 100, maxPositionWeightPct: 100 },
      botOrders: [
        { kind: 'MARKET', ticker: 'JPN', side: 'BUY', quantity: 100 }, // $2000 — too much
        { kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 20 }, // $200 — funded by the sell
        { kind: 'MARKET', ticker: 'AAA', side: 'SELL', quantity: 30 }, // +$300
      ],
    });
    expect(orders.map((o) => [o.side, o.ticker, o.blocked])).toEqual([
      ['SELL', 'AAA', false],
      ['BUY', 'JPN', true],
      ['BUY', 'AAA', false],
    ]);
  });
});

describe('IBKR Client Portal adapter (fake gateway)', () => {
  function fakeGateway(handlers: Record<string, (body: unknown) => unknown>) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const transport: HttpTransport = (method, url, body) => {
      const path = url.replace('https://localhost:5000/v1/api', '');
      calls.push({ method, path, body });
      const handler = handlers[`${method} ${path}`];
      return Promise.resolve(
        handler === undefined
          ? { status: 404, json: { error: `no fake for ${path}` } }
          : { status: 200, json: handler(body) },
      );
    };
    return { transport, calls };
  }
  const fujikura = { ticker: 'FUJIKURA', conid: 111, currency: 'JPY', lotSize: 100 };
  const contracts = [fujikura];

  it('maps ledger + positions into a snapshot, tagging mapped conids with our ticker', async () => {
    const { transport } = fakeGateway({
      'GET /portfolio/accounts': () => [{ accountId: 'DU1' }],
      'GET /portfolio/DU1/ledger': () => ({
        BASE: { cashbalance: 5000, netliquidationvalue: 9000 },
      }),
      'GET /portfolio/DU1/positions/0': () => [
        { conid: 111, position: 200, avgCost: 3000, currency: 'JPY', contractDesc: '5803' },
        {
          conid: 999,
          position: 5,
          avgCost: 10,
          currency: 'USD',
          mktValue: 60,
          contractDesc: 'OTHER',
        },
      ],
    });
    const snapshot = await createIbkrAdapter({ accountId: 'DU1', contracts, transport }).snapshot();
    expect(snapshot).toMatchObject({ cashUsd: 5000, netLiquidationUsd: 9000 });
    expect(snapshot.positions[0]).toMatchObject({
      ticker: 'FUJIKURA',
      shares: 200,
      currency: 'JPY',
    });
    expect(snapshot.positions[1]?.ticker).toBeUndefined();
  });

  it('places an order through IBKR’s confirmation-reply chain and records the messages', async () => {
    const { transport, calls } = fakeGateway({
      'GET /iserver/accounts': () => ({ accounts: ['DU1'] }),
      'POST /iserver/account/DU1/orders': () => [
        { id: 'r1', message: ['Order exceeds 5% of ADV'] },
      ],
      'POST /iserver/reply/r1': () => [{ order_id: '42', order_status: 'PreSubmitted' }],
    });
    const [status] = await createIbkrAdapter({
      accountId: 'DU1',
      contracts,
      transport,
    }).placeOrders([
      {
        ticker: 'FUJIKURA',
        side: 'BUY',
        quantity: 100,
        orderType: 'MKT',
        referencePrice: 3000,
        contract: fujikura,
        clientOrderId: 'c1',
      },
    ]);
    expect(status).toMatchObject({
      brokerOrderId: '42',
      state: 'submitted',
      messages: ['Order exceeds 5% of ADV'],
    });
    expect(calls.find((c) => c.path === '/iserver/account/DU1/orders')?.body).toMatchObject({
      orders: [
        { conid: 111, cOID: 'c1', side: 'BUY', quantity: 100, orderType: 'MKT', tif: 'DAY' },
      ],
    });
  });

  it('refuses to place orders on a non-paper account', async () => {
    const { transport, calls } = fakeGateway({});
    await expect(
      createIbkrAdapter({ accountId: 'U123', contracts, transport }).placeOrders([]),
    ).rejects.toThrow(/not an IBKR paper account/);
    expect(calls).toEqual([]);
  });

  it('maps IBKR order statuses', () => {
    expect(mapIbkrOrderState('Filled', 100, 100)).toBe('filled');
    expect(mapIbkrOrderState('Submitted', 40, 100)).toBe('partially_filled');
    expect(mapIbkrOrderState('Inactive', 0, 100)).toBe('rejected');
    expect(mapIbkrOrderState('PreSubmitted', 0, 100)).toBe('submitted');
  });
});

describe('live service with the simulated broker', () => {
  let rootDir: string;
  const universe: MarketUniverse = {
    id: 'fusion',
    game: 'stock-market-4',
    label: 'Fusion',
    datasetId: 'x',
    datasetVersion: '1',
    tickers: ['ELMT', 'KMT', 'FUJIKURA'],
  };
  function portfolio(overrides: Partial<LivePortfolio> = {}): LivePortfolio {
    return {
      id: 'p1',
      name: 'Sim',
      botId: 'quant-v0',
      broker: 'sim',
      universeId: 'fusion',
      contracts: [],
      risk: { maxOrderNotionalUsd: 50_000, maxDailyTurnoverPct: 100, maxPositionWeightPct: 100 },
      killSwitch: false,
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
      ...overrides,
    };
  }
  const decision = {
    botId: 'quant-v0',
    date: '2026-10-06',
    orders: [
      { kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 100 },
      { kind: 'MARKET', ticker: 'FUJIKURA', side: 'BUY', quantity: 150 },
    ],
    pricesUsd: { ELMT: 10, KMT: 30, FUJIKURA: 40 },
  };
  const deps = {
    emitConfig: () => Promise.resolve({ ok: true as const, config: {} }),
    latestPrices: () => decision.pricesUsd,
    decide: () =>
      Promise.resolve({
        ok: true,
        exitCode: 0,
        stdout: '',
        output: `QUANT_DECISION_JSON:{"ticker":"ELMT"}\nLIVE_DECISION_JSON:${JSON.stringify(decision)}\n`,
      }),
  };

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'sm4-live-'));
    await initSimAccount(rootDir, 'p1', 20_000);
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('proposes a ticket, then approval fills it in the sim account', async () => {
    const p = portfolio();
    savePortfolio(defaultLiveStoreDbPath(rootDir), p);
    const ticket = await proposeTicket(rootDir, p, deps);
    expect(ticket.status).toBe('pending_approval');
    expect(ticket.rationale).toEqual([{ ticker: 'ELMT' }]);
    // FUJIKURA rounds 150 → 100 (TSE lot size).
    expect(ticket.orders.map((o) => [o.ticker, o.quantity, o.blocked])).toEqual([
      ['ELMT', 100, false],
      ['FUJIKURA', 100, false],
    ]);

    const approved = await approveTicket(rootDir, p, ticket.id);
    expect(approved.status).toBe('completed');
    expect(approved.orders.every((o) => o.status?.state === 'filled')).toBe(true);
    const snapshot = await createSimAdapter(rootDir, 'p1').snapshot();
    expect(snapshot.cashUsd).toBeCloseTo(20_000 - 1000 - 4000 - 2);
    await expect(approveTicket(rootDir, p, ticket.id)).rejects.toThrow(/already completed/);
  });

  it('refuses approval with the kill switch on, and expires stale tickets', async () => {
    const p = portfolio();
    const ticket = await proposeTicket(rootDir, p, deps);
    await expect(approveTicket(rootDir, { ...p, killSwitch: true }, ticket.id)).rejects.toThrow(
      /Kill switch/,
    );
    const dbPath = defaultLiveStoreDbPath(rootDir);
    saveTicket(dbPath, { ...ticket, createdAt: '2026-01-01T00:00:00.000Z' });
    await expect(approveTicket(rootDir, p, ticket.id)).rejects.toThrow(/expired/);
    expect(getTicket(dbPath, ticket.id)?.status).toBe('expired');
  });

  it('records a rejection without sending anything', async () => {
    const p = portfolio();
    const ticket = await proposeTicket(rootDir, p, deps);
    expect(rejectTicket(rootDir, p, ticket.id).status).toBe('rejected');
    expect((await createSimAdapter(rootDir, 'p1').snapshot()).positions).toEqual([]);
  });

  it('caps the bot-visible cash at maxCapitalUsd and ignores unmapped holdings', () => {
    const bot = botPortfolioFor(
      portfolio({ risk: { ...DEFAULT_RISK_LIMITS, maxCapitalUsd: 5_000 } }),
      universe,
      {
        accountId: 'x',
        asOf: '',
        cashUsd: 50_000,
        netLiquidationUsd: 0,
        positions: [
          { ticker: 'ELMT', description: '', shares: 100, averageCost: 9, currency: 'USD' },
          { description: 'unmapped', shares: 10, averageCost: 1, currency: 'USD' },
        ],
      },
      { ELMT: 10 },
    );
    expect(bot.cashUsd).toBe(4_000);
    expect(bot.equityUsd).toBe(5_000);
    expect(bot.portfolio.positions).toEqual([
      { ticker: 'ELMT', shares: 100, averageEntryPriceCents: 900 },
    ]);
  });
});
