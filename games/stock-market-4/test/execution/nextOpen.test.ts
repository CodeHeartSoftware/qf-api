import { createRng } from '@quant-fusion/rng';
import { describe, expect, it } from 'vitest';
import { resolveOrdersForPortfolio, type ExecutionContext } from '../../src/execution/orders.js';
import { serializeForwardState, stockMarket4 } from '../../src/game.js';
import { createPortfolio } from '../../src/portfolio/accounting.js';
import {
  StockMarket4ForwardSnapshotSchema,
  type DailyBar,
  type ExecutionConfig,
  type OrderRequest,
  type RiskConfig,
  type StockMarket4Action,
} from '../../src/types.js';

const CASH_ONLY: RiskConfig = {
  allowShortSelling: false,
  borrowableShares: 0,
  borrowFeeAnnualized: 0,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

const BASE: ExecutionConfig = {
  fillTiming: 'next_open',
  halfSpreadBps: 0,
  impactCoefficientBps: 0,
  maxAdvParticipation: null,
  advWindowDays: 20,
};

function context(overrides: Partial<ExecutionConfig> = {}, adv?: number): ExecutionContext {
  return {
    config: { ...BASE, ...overrides },
    advSharesByTicker: adv === undefined ? new Map() : new Map([['ACME', adv]]),
  };
}

const BAR: DailyBar = {
  date: '2026-01-06',
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1000,
};
const bars = new Map([['ACME', BAR]]);
const buy = (quantity: number): OrderRequest => ({
  kind: 'MARKET',
  ticker: 'ACME',
  side: 'BUY',
  quantity,
});

function fillFor(order: OrderRequest, execution: ExecutionContext, cashCents = 10_000_000_00) {
  const { fills } = resolveOrdersForPortfolio(
    createPortfolio(cashCents),
    [order],
    bars,
    0,
    CASH_ONLY,
    execution,
  );
  const fill = fills[0];
  if (fill === undefined) throw new Error('expected a fill');
  return fill;
}

describe('resolveOrdersForPortfolio execution model', () => {
  it('fills a MARKET order at the OPEN under next_open', () => {
    expect(fillFor(buy(10), context()).priceCents).toBe(100_00);
  });

  it('charges half the spread against the trader on both sides', () => {
    expect(fillFor(buy(10), context({ halfSpreadBps: 50 })).priceCents).toBe(100_50);
    const { fills } = resolveOrdersForPortfolio(
      {
        cashCents: 0,
        positions: new Map([
          ['ACME', { shares: 10, averageEntryPriceCents: 90_00, realizedPnlCents: 0 }],
        ]),
      },
      [{ kind: 'MARKET', ticker: 'ACME', side: 'SELL', quantity: 10 }],
      bars,
      0,
      CASH_ONLY,
      context({ halfSpreadBps: 50 }),
    );
    expect(fills[0]?.priceCents).toBe(99_50);
  });

  it('adds square-root impact relative to average daily volume', () => {
    // 100 shares against 10,000 ADV: 100 bps * sqrt(0.01) = 10 bps on top of the open.
    expect(fillFor(buy(100), context({ impactCoefficientBps: 100 }, 10_000)).priceCents).toBe(
      100_10,
    );
  });

  it('caps a fill at the configured share of average daily volume', () => {
    const fill = fillFor(buy(500), context({ maxAdvParticipation: 0.1 }, 1_000));
    expect(fill.requestedQuantity).toBe(500);
    expect(fill.filledQuantity).toBe(100);
  });

  it('applies no volume cap or impact to a ticker with no volume history', () => {
    const fill = fillFor(
      buy(500),
      context({ maxAdvParticipation: 0.1, impactCoefficientBps: 100 }),
    );
    expect(fill.filledQuantity).toBe(500);
    expect(fill.priceCents).toBe(100_00);
  });

  it('fills a LIMIT at its own price with no spread, but still volume-capped', () => {
    const limit: OrderRequest = {
      kind: 'LIMIT',
      ticker: 'ACME',
      side: 'BUY',
      quantity: 500,
      limitPrice: 95,
    };
    const fill = fillFor(limit, context({ halfSpreadBps: 50, maxAdvParticipation: 0.1 }, 1_000));
    expect(fill.priceCents).toBe(95_00);
    expect(fill.filledQuantity).toBe(100);
  });
});

// Opens and closes differ every day, so a fill's price says which one it used.
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
const SERIES: DailyBar[] = [
  { date: '2025-12-31', open: 99, high: 99, low: 99, close: 99, volume: 1000 },
  ...DAYS.map((date, i) => ({
    date,
    open: 100 + i * 10,
    high: 106 + i * 10,
    low: 100 + i * 10,
    close: 105 + i * 10,
    volume: 1000,
  })),
];

function nextOpenState() {
  const parsed = stockMarket4.parseConfig({
    startDate: DAYS[0],
    endDate: DAYS.at(-1),
    marketDataUniverse: ['ACME'],
    historicalContextDays: 5,
    historicalPrices: { ACME: SERIES },
    transactionFeeRate: 0,
    execution: { fillTiming: 'next_open' },
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return stockMarket4.initialize({
    config: parsed.value,
    participantIds: ['alice'],
    rng: createRng(Buffer.alloc(16, 1)),
  });
}

const actions = (orders: OrderRequest[]): Map<string, StockMarket4Action> =>
  new Map([['alice', { orders }]]);

describe('next_open fill timing through the game', () => {
  it("fills an order at the NEXT day's open, and the next observation already shows it", () => {
    let state = nextOpenState();
    const rng = createRng(Buffer.alloc(16, 1));

    // Day 1: the bot sees the 105 close and buys — nothing fills today.
    state = stockMarket4.resolve({ state, actions: actions([buy(10)]), rng }).nextState;
    expect(state.lastFills.get('alice')).toEqual([]);
    expect(state.pendingOrders.get('alice')).toEqual([buy(10)]);

    // Day 2's observation (taken after day 2's close) must show the fill at day 2's OPEN (110),
    // so the bot never mistakes yesterday's order for an unfilled one and resubmits it.
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills).toEqual([
      expect.objectContaining({ filledQuantity: 10, priceCents: 110_00 }),
    ]);
    expect(observation.portfolio.positions).toEqual([
      expect.objectContaining({ ticker: 'ACME', shares: 10 }),
    ]);

    // Resolving day 2 commits exactly that fill — and nothing more, even with no new orders.
    state = stockMarket4.resolve({ state, actions: actions([]), rng }).nextState;
    expect(state.lastFills.get('alice')).toEqual(observation.fills);
    expect(state.portfolios.get('alice')?.positions.get('ACME')?.shares).toBe(10);
    expect(state.pendingOrders.get('alice')).toEqual([]);
  });

  it('carries pending orders through a forward snapshot', () => {
    let state = nextOpenState();
    state = stockMarket4.resolve({
      state,
      actions: actions([buy(3)]),
      rng: createRng(Buffer.alloc(16, 1)),
    }).nextState;
    const snapshot = serializeForwardState(state);
    expect(snapshot.snapshotVersion).toBe(3);
    const parsed = StockMarket4ForwardSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed.snapshotVersion === 3 && parsed.pendingOrders).toEqual([['alice', [buy(3)]]]);
  });
});
