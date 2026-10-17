import { createRng } from '@quant-fusion/rng';
import { describe, expect, it } from 'vitest';
import { getCurrentStandings, stockMarket4 } from '../src/game.js';
import type { StockMarket4Action } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

// This game's manifest declares minParticipants: 1, maxParticipants: 10 — these
// tests use 2 participant(s) as a representative roster within that range.
const PARTICIPANT_IDS = ['alice', 'bob'];

/** A `{ participantId -> action }` map with every participant defaulted to an empty order list —
 * typed explicitly so a test can `.set()` a real order list for one participant afterward without
 * TypeScript narrowing the map's value type to the empty-array literal it started from. */
function noopActions(): Map<string, StockMarket4Action> {
  return new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
}

const ZERO_RISK_STATS = { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 };

/** `computePerformanceMetrics`'s output for a flat equity curve (no trades at all) — every
 * metric is 0 or undefined-as-null, since there's no variation to measure. */
const FLAT_PERFORMANCE_METRICS = {
  totalReturn: 0,
  maxDrawdown: 0,
  annualizedVolatility: 0,
  sharpeRatio: null,
};

/** The expected `PortfolioObservation` for an all-cash portfolio under the default (margin-off)
 * risk config — buying power/maintenance requirement are always 0 in a cash-only account (see
 * `PortfolioObservation`'s own doc comments). */
function allCashPortfolio(
  cashCents: number,
  equityHistory: { date: string; equityCents: number }[] = [
    { date: '2026-01-05', equityCents: cashCents },
  ],
) {
  return {
    cashCents,
    equityCents: cashCents,
    positions: [],
    buyingPowerCents: 0,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: ZERO_RISK_STATS,
    equityHistory,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** A flat OHLC bar (open = high = low = close) — trivially satisfies the schema's
 * high>=open/close and low<=open/close invariants without the test needing to reason about them. */
function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

/** One bar per weekday (never a weekend) from `startDate` to `endDate` inclusive, prices counting
 * up by 1 per day starting at `startPrice` — a small, independent fixture generator (deliberately
 * not reusing `src/market/calendar.ts`, so these tests don't test the implementation against
 * itself). */
function weekdayBars(startDate: string, endDate: string, startPrice = 100) {
  const bars: ReturnType<typeof flatBar>[] = [];
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  let price = startPrice;
  for (let ms = Date.parse(`${startDate}T00:00:00Z`); ms <= endMs; ms += MS_PER_DAY) {
    const date = new Date(ms).toISOString().slice(0, 10);
    if (!isWeekend(date)) {
      bars.push(flatBar(date, price));
      price += 1;
    }
  }
  return bars;
}

function baseConfigInput(overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05', // Monday
    endDate: '2026-01-09', // Friday — 5 trading days, no weekend crossed
    marketDataUniverse: ['NVDA'],
    historicalContextDays: 3,
    historicalPrices: { NVDA: weekdayBars('2025-12-29', '2026-01-09') },
    ...overrides,
  };
}

function initialState(overrides: Record<string, unknown> = {}) {
  const configResult = stockMarket4.parseConfig(baseConfigInput(overrides));
  if (!configResult.ok) {
    throw new Error(configResult.reason);
  }
  return stockMarket4.initialize({
    config: configResult.value,
    participantIds: PARTICIPANT_IDS,
    rng,
  });
}

describe('stockMarket4.parseConfig', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const result = stockMarket4.parseConfig(baseConfigInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decisionTime).toBe('12:00');
      expect(result.value.decisionTimezone).toBe('America/New_York');
      expect(result.value.startingCapital).toBe(100_000);
      expect(result.value.tradingHolidays).toEqual([]);
      expect(result.value.marketDataMode).toBe('historical');
    }
  });

  it('accepts an explicit synthetic marketDataMode', () => {
    const result = stockMarket4.parseConfig(baseConfigInput({ marketDataMode: 'synthetic' }));
    expect(result.ok && result.value.marketDataMode).toBe('synthetic');
  });

  it('rejects an unrecognized marketDataMode', () => {
    expect(stockMarket4.parseConfig(baseConfigInput({ marketDataMode: 'simulated' })).ok).toBe(
      false,
    );
  });

  it('defaults riskFreeRate to 0 and accepts no benchmarkTicker', () => {
    const result = stockMarket4.parseConfig(baseConfigInput());
    expect(result.ok && result.value.riskFreeRate).toBe(0);
    expect(result.ok && result.value.benchmarkTicker).toBeUndefined();
  });

  it('accepts a benchmarkTicker with a historicalPrices entry, even outside marketDataUniverse', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        benchmarkTicker: 'SPY',
        historicalPrices: {
          NVDA: weekdayBars('2025-12-29', '2026-01-09'),
          SPY: weekdayBars('2025-12-29', '2026-01-09', 400),
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a benchmarkTicker with no historicalPrices entry', () => {
    const result = stockMarket4.parseConfig(baseConfigInput({ benchmarkTicker: 'SPY' }));
    expect(result.ok).toBe(false);
  });

  it('rejects startDate on or after endDate', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({ startDate: '2026-06-01', endDate: '2026-01-01' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate ticker in marketDataUniverse', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({ marketDataUniverse: ['NVDA', 'NVDA'] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty marketDataUniverse', () => {
    expect(stockMarket4.parseConfig(baseConfigInput({ marketDataUniverse: [] })).ok).toBe(false);
  });

  it('rejects a marketDataUniverse ticker with no historicalPrices entry', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({ marketDataUniverse: ['NVDA', 'AMD'] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a historicalPrices series not sorted by strictly increasing date', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        historicalPrices: { NVDA: [flatBar('2026-01-02', 101), flatBar('2026-01-01', 100)] },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a bar whose high/low is inconsistent with its open/close', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        historicalPrices: {
          NVDA: [{ date: '2026-01-05', open: 100, high: 90, low: 80, close: 100, volume: 1 }],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a corporate action naming a ticker not in marketDataUniverse', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        corporateActions: [
          { type: 'CASH_DIVIDEND', ticker: 'AMD', date: '2026-01-06', perShare: 1 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an announcedDate after the effective date', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        corporateActions: [
          {
            type: 'ACQUISITION',
            ticker: 'NVDA',
            date: '2026-01-06',
            announcedDate: '2026-01-07',
            cashPerShare: 150,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a STOCK_SPLIT that does not increase share count', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        corporateActions: [
          { type: 'STOCK_SPLIT', ticker: 'NVDA', date: '2026-01-06', fromShares: 2, toShares: 1 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a REVERSE_SPLIT that does not decrease share count', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        corporateActions: [
          {
            type: 'REVERSE_SPLIT',
            ticker: 'NVDA',
            date: '2026-01-06',
            fromShares: 1,
            toShares: 2,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a valid corporate action and defaults to an empty list', () => {
    expect(stockMarket4.parseConfig(baseConfigInput()).ok).toBe(true);
    const result = stockMarket4.parseConfig(baseConfigInput());
    if (result.ok) {
      expect(result.value.corporateActions).toEqual([]);
    }
  });

  it('defaults researchTimeline to an empty list and accepts an arbitrary opaque payload', () => {
    const empty = stockMarket4.parseConfig(baseConfigInput());
    expect(empty.ok && empty.value.researchTimeline).toEqual([]);

    const result = stockMarket4.parseConfig(
      baseConfigInput({
        researchTimeline: [
          { date: '2026-01-01', payload: { anything: 'goes', nested: { arrays: [1, 2, 3] } } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a researchTimeline not sorted by strictly increasing date', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        researchTimeline: [
          { date: '2026-01-05', payload: {} },
          { date: '2026-01-01', payload: {} },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate date in researchTimeline', () => {
    const result = stockMarket4.parseConfig(
      baseConfigInput({
        researchTimeline: [
          { date: '2026-01-01', payload: {} },
          { date: '2026-01-01', payload: {} },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('stockMarket4.initialize', () => {
  it('rejects a participant roster outside [1, 10]', () => {
    const configResult = stockMarket4.parseConfig(baseConfigInput());
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    expect(() =>
      stockMarket4.initialize({ config: configResult.value, participantIds: [], rng }),
    ).toThrow();
  });
});

describe('stockMarket4.getObservation', () => {
  it("reports every other participant's id from each participant's own perspective", () => {
    const state = initialState();
    const [first, ...restFromFirst] = PARTICIPANT_IDS;
    const last = PARTICIPANT_IDS.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    expect(stockMarket4.getObservation(state, first).opponentIds).toEqual(restFromFirst);
    expect(stockMarket4.getObservation(state, last).opponentIds).toEqual(
      PARTICIPANT_IDS.slice(0, -1),
    );
  });

  it("reports the real trading date for the current round — the match's own startDate at round 0", () => {
    const state = initialState();
    expect(stockMarket4.getObservation(state, 'alice').date).toBe('2026-01-05');
  });

  it("today's bar and the trailing history window, capped at historicalContextDays", () => {
    const state = initialState();
    const observation = stockMarket4.getObservation(state, 'alice');
    const [security] = observation.securities;
    if (security === undefined) {
      throw new Error('expected one security in the observation');
    }
    expect(security.ticker).toBe('NVDA');
    expect(security.bar).toEqual(flatBar('2026-01-05', 105)); // 2026-01-05 is the 6th weekday from 2025-12-29
    // historicalContextDays: 3 -> today plus the 2 trading days before it.
    expect(security.history.map((bar) => bar.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-05',
    ]);
  });

  it('never includes a bar dated after the current round — no future leakage', () => {
    let state = initialState();
    const actions = noopActions();
    state = stockMarket4.resolve({ state, actions, rng }).nextState; // now on 2026-01-06

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.date).toBe('2026-01-06');
    const [security] = observation.securities;
    if (security === undefined) {
      throw new Error('expected one security in the observation');
    }
    expect(security.bar?.date).toBe('2026-01-06');
    expect(security.history.every((bar) => bar.date <= '2026-01-06')).toBe(true);
    expect(security.history.some((bar) => bar.date > '2026-01-06')).toBe(false);
  });

  it('shows a split-adjusted, continuous price series once the split has happened — no fake cliff', () => {
    // NVDA closes at 400 on 01-05/01-06, then a 2-for-1 split takes effect exactly on 01-07
    // (the raw close there is 202, roughly half of 404 — a real post-split price).
    let state = initialState({
      historicalContextDays: 5,
      historicalPrices: {
        NVDA: [
          { date: '2025-12-30', open: 96, high: 96, low: 96, close: 96, volume: 1 },
          { date: '2025-12-31', open: 98, high: 98, low: 98, close: 98, volume: 1 },
          { date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { date: '2026-01-02', open: 102, high: 102, low: 102, close: 102, volume: 1 },
          { date: '2026-01-05', open: 400, high: 400, low: 400, close: 400, volume: 1 },
          { date: '2026-01-06', open: 404, high: 404, low: 404, close: 404, volume: 1 },
          { date: '2026-01-07', open: 202, high: 202, low: 202, close: 202, volume: 1 },
        ],
      },
      corporateActions: [
        { type: 'STOCK_SPLIT', ticker: 'NVDA', date: '2026-01-07', fromShares: 1, toShares: 2 },
      ],
    });
    const actions = noopActions();

    // Round 0 (2026-01-05): the split hasn't happened yet — raw, unadjusted price.
    expect(stockMarket4.getObservation(state, 'alice').securities[0]?.bar?.close).toBe(400);
    expect(stockMarket4.getObservation(state, 'alice').corporateActions).toEqual([]);

    state = stockMarket4.resolve({ state, actions, rng }).nextState; // now 2026-01-06
    state = stockMarket4.resolve({ state, actions, rng }).nextState; // now 2026-01-07

    // Round 2 (2026-01-07): the split has happened — every prior bar reads back scaled by 0.5,
    // continuous with 01-07's own (already post-split) close, not as a cliff.
    const observation = stockMarket4.getObservation(state, 'alice');
    const security = observation.securities[0];
    expect(security?.history.map((b) => b.close)).toEqual([50, 51, 200, 202, 202]);
    expect(observation.corporateActions).toHaveLength(1);
    expect(observation.corporateActions[0]?.type).toBe('STOCK_SPLIT');
  });

  it('reports a null bar (a genuine data gap) rather than carrying the prior close forward', () => {
    const state = initialState({
      historicalPrices: {
        NVDA: weekdayBars('2025-12-29', '2026-01-09').filter((bar) => bar.date !== '2026-01-05'),
      },
    });
    const observation = stockMarket4.getObservation(state, 'alice');
    const [security] = observation.securities;
    expect(security?.bar).toBeNull();
    expect(security?.history.some((bar) => bar.date === '2026-01-05')).toBe(false);
  });

  it("is undefined before the match reaches the timeline's first research entry", () => {
    const state = initialState({
      researchTimeline: [{ date: '2026-01-06', payload: { thesis: 'bullish' } }],
    });
    // round 0 is 2026-01-05 — one day before the research entry becomes knowable.
    expect(stockMarket4.getObservation(state, 'alice').research).toBeUndefined();
  });

  it('delivers the latest knowable research payload, opaque and untouched', () => {
    let state = initialState({
      researchTimeline: [
        { date: '2026-01-05', payload: { thesis: 'neutral', confidence: 0.5 } },
        { date: '2026-01-06', payload: { thesis: 'bullish', confidence: 0.8 } },
      ],
    });
    const actions = noopActions();

    expect(stockMarket4.getObservation(state, 'alice').research).toEqual({
      thesis: 'neutral',
      confidence: 0.5,
    });

    state = stockMarket4.resolve({ state, actions, rng }).nextState; // now 2026-01-06
    expect(stockMarket4.getObservation(state, 'alice').research).toEqual({
      thesis: 'bullish',
      confidence: 0.8,
    });
  });
});

describe('stockMarket4.getPendingActions / validateAction', () => {
  it('requires an action from every participant each round', () => {
    const state = initialState();
    expect(stockMarket4.getPendingActions(state)).toEqual(
      PARTICIPANT_IDS.map((participantId) => ({ participantId, required: true })),
    );
  });

  it('accepts an empty order list and rejects a malformed action', () => {
    const state = initialState();
    const [firstParticipantId] = PARTICIPANT_IDS;
    if (firstParticipantId === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    expect(stockMarket4.validateAction(state, firstParticipantId, { orders: [] }).ok).toBe(true);
    expect(stockMarket4.validateAction(state, firstParticipantId, {}).ok).toBe(false);
    expect(stockMarket4.validateAction(state, firstParticipantId, { noop: true }).ok).toBe(false);
  });

  it('accepts a well-formed MARKET/LIMIT order', () => {
    const state = initialState();
    const [firstParticipantId] = PARTICIPANT_IDS;
    if (firstParticipantId === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    expect(
      stockMarket4.validateAction(state, firstParticipantId, {
        orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
      }).ok,
    ).toBe(true);
    expect(
      stockMarket4.validateAction(state, firstParticipantId, {
        orders: [{ kind: 'LIMIT', ticker: 'NVDA', side: 'SELL', quantity: 5, limitPrice: 100 }],
      }).ok,
    ).toBe(true);
  });

  it('rejects an order naming a ticker not in marketDataUniverse', () => {
    const state = initialState();
    const [firstParticipantId] = PARTICIPANT_IDS;
    if (firstParticipantId === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    const result = stockMarket4.validateAction(state, firstParticipantId, {
      orders: [{ kind: 'MARKET', ticker: 'AMD', side: 'BUY', quantity: 10 }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('stockMarket4.resolve / isTerminal / getResult / getStandingOutcomes', () => {
  it('counts only trading days — a weekend inside the date range does not add a round', () => {
    // 2026-01-02 (Fri) -> 2026-01-05 (Mon) spans 4 raw calendar days but only 2 trading days.
    let state = initialState({
      startDate: '2026-01-02',
      endDate: '2026-01-05',
      historicalPrices: { NVDA: weekdayBars('2025-12-25', '2026-01-05') },
    });
    const actions = noopActions();

    expect(stockMarket4.isTerminal(state)).toBe(false);
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    expect(stockMarket4.isTerminal(state)).toBe(false);
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    expect(stockMarket4.isTerminal(state)).toBe(true);

    const result = stockMarket4.getResult(state);
    expect(result).toEqual({
      participantIds: PARTICIPANT_IDS,
      totalRounds: 2,
      gameType: 'HISTORICAL',
      marketDataMode: 'historical',
      // No trades were made — final equity is just the untouched starting capital, in cents.
      finalEquityCents: { alice: 100_000_00, bob: 100_000_00 },
      riskStats: { alice: ZERO_RISK_STATS, bob: ZERO_RISK_STATS },
      performanceMetrics: { alice: FLAT_PERFORMANCE_METRICS, bob: FLAT_PERFORMANCE_METRICS },
      benchmarkReturn: null,
      // 2026-01-02 (first trading day) close 106 -> 2026-01-05 (final trading day) close 107 —
      // see weekdayBars(startPrice=100)'s one-weekday-per-increment fixture.
      securityPrices: [{ symbol: 'NVDA', startingPrice: 106, finalPrice: 107 }],
      portfolioSummaries: {
        alice: { cash: 100_000, equity: 100_000, bankrupt: false, positions: [] },
        bob: { cash: 100_000, equity: 100_000, bankrupt: false, positions: [] },
      },
    });
    expect(stockMarket4.getStandingOutcomes(result)).toEqual(
      PARTICIPANT_IDS.map((participantId) => ({
        participantId,
        rank: 1,
        score: 100_000_00,
        outcome: 'draw',
      })),
    );
  });

  it('an organizer-declared trading holiday removes a round the same way a weekend does', () => {
    // Mon-Fri (5 trading days) minus one declared holiday -> 4 rounds.
    let state = initialState({ tradingHolidays: ['2026-01-07'] });
    const actions = noopActions();
    for (let i = 0; i < 4; i++) {
      expect(stockMarket4.isTerminal(state)).toBe(false);
      state = stockMarket4.resolve({ state, actions, rng }).nextState;
    }
    expect(stockMarket4.isTerminal(state)).toBe(true);
    expect(stockMarket4.getResult(state).totalRounds).toBe(4);
  });
});

describe('getCurrentStandings', () => {
  it("reflects the current round's marks/fills, safe to call on a non-terminal state", () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    expect(stockMarket4.isTerminal(state)).toBe(false);

    const feeCents = Math.round(10 * 105_00 * 0.001);
    const summary = getCurrentStandings(state);
    expect(summary.asOfDate).toBe('2026-01-06'); // round 1 — same date getObservation marks at

    const alice = summary.standings.find((s) => s.participantId === 'alice');
    const bob = summary.standings.find((s) => s.participantId === 'bob');
    expect(alice?.equityCents).toBe(100_000_00 - 10 * 105_00 - feeCents + 10 * 106_00);
    expect(bob?.equityCents).toBe(100_000_00);
    expect(alice?.rank).toBe(1);
    expect(bob?.rank).toBe(2);
    expect(alice?.lastFills).toEqual([
      {
        ticker: 'NVDA',
        side: 'BUY',
        kind: 'MARKET',
        requestedQuantity: 10,
        filledQuantity: 10,
        priceCents: 105_00,
        feeCents,
      },
    ]);
    expect(bob?.lastFills).toEqual([]);
  });

  it('ranks by current equity, ties sharing a rank (both still flat at match start)', () => {
    const summary = getCurrentStandings(initialState());
    expect(summary.standings.map((s) => s.rank)).toEqual([1, 1]);
  });

  it('lastFills only ever reflects the MOST RECENT round, never an earlier one', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    // Round 2: alice submits no new orders — still holds the position, but traded nothing today.
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;

    const summary = getCurrentStandings(state);
    const alice = summary.standings.find((s) => s.participantId === 'alice');
    expect(alice?.positions).toEqual([expect.objectContaining({ ticker: 'NVDA', shares: 10 })]);
    expect(alice?.lastFills).toEqual([]);
  });

  it('previousFills reflects the round BEFORE lastFills, not the same round twice', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    // Round 2: alice trades nothing new.
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;

    const summary = getCurrentStandings(state);
    const alice = summary.standings.find((s) => s.participantId === 'alice');
    expect(alice?.lastFills).toEqual([]);
    expect(alice?.previousFills).toEqual([
      expect.objectContaining({ ticker: 'NVDA', side: 'BUY', filledQuantity: 10 }),
    ]);
  });

  it('computes benchmarkReturn as-of the CURRENT round, not the whole match window', () => {
    let state = initialState({ benchmarkTicker: 'NVDA' });
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;

    const summary = getCurrentStandings(state);
    expect(summary.asOfDate).toBe('2026-01-06');
    // (106 - 105) / 105 as-of-now — NOT the full match's (109 - 105) / 105 `getResult` would
    // report once the match is actually terminal.
    expect(summary.benchmarkReturn).toBeCloseTo((106 - 105) / 105, 10);
  });

  it("is safe to call once terminal, reporting the match's last trading day", () => {
    let state = initialState();
    const actions = noopActions();
    for (let i = 0; i < 5; i++) {
      state = stockMarket4.resolve({ state, actions, rng }).nextState;
    }
    expect(stockMarket4.isTerminal(state)).toBe(true);

    const summary = getCurrentStandings(state);
    expect(summary.asOfDate).toBe('2026-01-09');
  });

  it('reports REAL market value once terminal — unlike getObservation, which zeroes positions out once its own `date` goes null', () => {
    // Regression test: an earlier version of getCurrentStandings called getObservation directly,
    // whose own `date` is `calendar[state.round] ?? null` with NO further fallback — exactly
    // `null` once state.round reaches calendar.length (the ordinary post-invocation state for a
    // FORWARD_SHADOW match that just caught up to everything currently known), which zeroes every
    // position's marketValueCents (see PortfolioObservation's own doc comment on `date === null`).
    // That's correct for a BOT's own observation, but wrong for a host-side standings summary.
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState; // round 0 (2026-01-05, close 105)
    for (let i = 0; i < 4; i++) {
      state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
    }
    expect(stockMarket4.isTerminal(state)).toBe(true);
    // getObservation itself is now cash-only, by design — confirms the premise above.
    expect(
      stockMarket4.getObservation(state, 'alice').portfolio.positions[0]?.marketValueCents,
    ).toBe(0);

    const summary = getCurrentStandings(state);
    const alice = summary.standings.find((s) => s.participantId === 'alice');
    // Marked at 2026-01-09's real close (109), not zeroed out.
    expect(alice?.positions).toEqual([
      expect.objectContaining({ ticker: 'NVDA', shares: 10, marketValueCents: 10 * 109_00 }),
    ]);
    expect(alice?.equityCents).not.toBe(alice?.cashCents);
  });
});

describe('order execution', () => {
  it('starts every participant with an all-cash portfolio at startingCapital', () => {
    const state = initialState();
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.portfolio).toEqual(allCashPortfolio(100_000_00));
    expect(observation.fills).toEqual([]);
  });

  it('fills a MARKET BUY at the round it was submitted for, at that day close, deducting cash', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'BUY',
        kind: 'MARKET',
        requestedQuantity: 10,
        filledQuantity: 10,
        priceCents: 105_00,
        feeCents: Math.round(10 * 105_00 * 0.001),
      },
    ]);
    const feeCents = Math.round(10 * 105_00 * 0.001);
    expect(observation.portfolio.cashCents).toBe(100_000_00 - 10 * 105_00 - feeCents);
    // This observation is fetched AFTER round 0 resolved, so it's now round 1 (2026-01-06,
    // close $106) — the position is marked at TODAY's close, not frozen at yesterday's fill price.
    expect(observation.portfolio.positions).toEqual([
      {
        ticker: 'NVDA',
        shares: 10,
        averageEntryPriceCents: 105_00,
        realizedPnlCents: 0,
        marketValueCents: 10 * 106_00,
        unrealizedPnlCents: 10 * 106_00 - 10 * 105_00,
      },
    ]);
  });

  it('a bot with no bob action still keeps its own untouched portfolio unaffected by alice trading', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    // One round resolved -> two equity readings (the pre-trading seed, plus round 0's own),
    // both dated 2026-01-05 since round 0 IS config.startDate.
    expect(stockMarket4.getObservation(state, 'bob').portfolio).toEqual(
      allCashPortfolio(100_000_00, [
        { date: '2026-01-05', equityCents: 100_000_00 },
        { date: '2026-01-05', equityCents: 100_000_00 },
      ]),
    );
  });

  it('caps a BUY to what cash affords rather than rejecting the whole order', () => {
    let state = initialState({ startingCapital: 1000 }); // $1,000, NVDA closes at $105 round 0
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 100 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const fill = stockMarket4.getObservation(state, 'alice').fills[0];
    expect(fill?.requestedQuantity).toBe(100);
    expect(fill?.filledQuantity).toBeLessThan(100);
    expect(fill?.filledQuantity).toBeGreaterThan(0);
    // Affording strictly more would have overdrawn cash below zero.
    const nextFillPrice = fill?.priceCents ?? 0;
    const spentCents = (fill?.filledQuantity ?? 0) * nextFillPrice + (fill?.feeCents ?? 0);
    expect(spentCents).toBeLessThanOrEqual(1000_00);
  });

  it('caps a SELL to shares actually held rather than opening a short', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const fill = stockMarket4.getObservation(state, 'alice').fills[0];
    expect(fill).toEqual({
      ticker: 'NVDA',
      side: 'SELL',
      kind: 'MARKET',
      requestedQuantity: 10,
      filledQuantity: 0,
      priceCents: 105_00,
      feeCents: 0,
    });
    expect(stockMarket4.getObservation(state, 'alice').portfolio.cashCents).toBe(100_000_00);
  });

  it('a BUY then a SELL in the same order list is processed in submission order', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [
        { kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 },
        { kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 4 },
      ],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills.map((f) => f.filledQuantity)).toEqual([10, 4]);
    expect(observation.portfolio.positions[0]?.shares).toBe(6);
  });

  it('a LIMIT BUY only fills when the day low reaches the limit price', () => {
    const state = initialState(); // round 0: NVDA is a flat bar (open=high=low=close=105)
    const actionsTooLow = noopActions();
    actionsTooLow.set('alice', {
      orders: [{ kind: 'LIMIT', ticker: 'NVDA', side: 'BUY', quantity: 5, limitPrice: 100 }],
    });
    const afterTooLow = stockMarket4.resolve({ state, actions: actionsTooLow, rng }).nextState;
    expect(stockMarket4.getObservation(afterTooLow, 'alice').fills[0]?.filledQuantity).toBe(0);

    const actionsReachable = noopActions();
    actionsReachable.set('alice', {
      orders: [{ kind: 'LIMIT', ticker: 'NVDA', side: 'BUY', quantity: 5, limitPrice: 105 }],
    });
    const afterReachable = stockMarket4.resolve({
      state,
      actions: actionsReachable,
      rng,
    }).nextState;
    const fill = stockMarket4.getObservation(afterReachable, 'alice').fills[0];
    expect(fill?.filledQuantity).toBe(5);
    expect(fill?.priceCents).toBe(105_00);
  });

  it('an order for a ticker with no bar that day (a data gap) does not fill', () => {
    let state = initialState({
      historicalPrices: {
        NVDA: weekdayBars('2025-12-29', '2026-01-09').filter((bar) => bar.date !== '2026-01-05'),
      },
    });
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    expect(stockMarket4.getObservation(state, 'alice').fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'BUY',
        kind: 'MARKET',
        requestedQuantity: 10,
        filledQuantity: 0,
        priceCents: 0,
        feeCents: 0,
      },
    ]);
    expect(stockMarket4.getObservation(state, 'alice').portfolio.cashCents).toBe(100_000_00);
  });

  it('settles a same-day CASH_DIVIDEND onto a held position before that round trades', () => {
    let state = initialState({
      corporateActions: [
        { type: 'CASH_DIVIDEND', ticker: 'NVDA', date: '2026-01-06', perShare: 2 },
      ],
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState; // round 0 (01-05): buy 10

    const cashAfterBuy = stockMarket4.getObservation(state, 'alice').portfolio.cashCents;
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState; // round 1 (01-06): dividend pays

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.portfolio.cashCents).toBe(cashAfterBuy + 10 * 2_00);
  });

  it('settles a same-day STOCK_SPLIT onto a held position (share count/cost basis rescale, equity unchanged)', () => {
    let state = initialState({
      historicalContextDays: 5,
      historicalPrices: {
        NVDA: [
          { date: '2025-12-30', open: 96, high: 96, low: 96, close: 96, volume: 1 },
          { date: '2025-12-31', open: 98, high: 98, low: 98, close: 98, volume: 1 },
          { date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { date: '2026-01-02', open: 102, high: 102, low: 102, close: 102, volume: 1 },
          { date: '2026-01-05', open: 400, high: 400, low: 400, close: 400, volume: 1 },
          { date: '2026-01-06', open: 202, high: 202, low: 202, close: 202, volume: 1 },
          { date: '2026-01-07', open: 202, high: 202, low: 202, close: 202, volume: 1 },
        ],
      },
      corporateActions: [
        { type: 'STOCK_SPLIT', ticker: 'NVDA', date: '2026-01-06', fromShares: 1, toShares: 2 },
      ],
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState; // round 0 (01-05): buy 10 @ 400

    const beforeSplit = stockMarket4.getObservation(state, 'alice').portfolio;
    expect(beforeSplit.positions[0]).toMatchObject({ shares: 10, averageEntryPriceCents: 400_00 });

    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState; // round 1 (01-06): split

    const afterSplit = stockMarket4.getObservation(state, 'alice').portfolio;
    expect(afterSplit.positions[0]).toMatchObject({ shares: 20, averageEntryPriceCents: 200_00 });
    // Total cost basis (shares x average entry) is exactly preserved by the split — proof the
    // split itself neither creates nor destroys value, independent of any later mark price.
    const before = beforeSplit.positions[0];
    const after = afterSplit.positions[0];
    if (before === undefined || after === undefined) {
      throw new Error('expected a position in both observations');
    }
    expect(after.shares * after.averageEntryPriceCents).toBe(
      before.shares * before.averageEntryPriceCents,
    );
  });
});

describe('risk & financing', () => {
  const MARGIN_RISK = {
    allowShortSelling: true,
    initialMarginRatio: 0.5,
    maintenanceMarginRatio: 0.3,
    borrowableShares: 1000,
    borrowFeeAnnualized: 0,
  };

  it('defaults to a cash-only account: buying power/maintenance requirement are 0', () => {
    const state = initialState();
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.portfolio.buyingPowerCents).toBe(0);
    expect(observation.portfolio.maintenanceRequirementCents).toBe(0);
  });

  it('allows opening a short and reports buying power once margin is enabled', () => {
    let state = initialState({ risk: MARGIN_RISK, transactionFeeRate: 0 });
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills[0]).toMatchObject({ side: 'SELL', filledQuantity: 10 });
    expect(observation.portfolio.positions[0]?.shares).toBe(-10);
    expect(observation.portfolio.buyingPowerCents).toBeGreaterThan(0);
  });

  it('charges a daily borrow fee on a short position, deducted from cash', () => {
    let state = initialState({
      risk: { ...MARGIN_RISK, borrowFeeAnnualized: 0.03 },
      transactionFeeRate: 0,
    });
    const shortOrder = noopActions();
    shortOrder.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'SELL', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions: shortOrder, rng }).nextState; // round 0: open short
    const cashAfterShort = stockMarket4.getObservation(state, 'alice').portfolio.cashCents;

    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState; // round 1: fee accrues
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.portfolio.cashCents).toBeLessThan(cashAfterShort);
    expect(observation.portfolio.riskStats.borrowFeesPaidCents).toBeGreaterThan(0);
  });

  it('force-liquidates a margin position once equity falls below the maintenance requirement', () => {
    // $1,000 starting cash, initialMarginRatio 0.5 -> buying power = $2,000 = 20 shares @ $100.
    // NVDA then crashes to $20 the next day: 20 shares @ $20 = $400 equity vs. -$1,000 margin debt
    // = deeply negative equity, well below even a shrunken maintenance requirement.
    let state = initialState({
      risk: MARGIN_RISK,
      transactionFeeRate: 0,
      startingCapital: 1000,
      historicalPrices: {
        NVDA: [
          { date: '2026-01-05', open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { date: '2026-01-06', open: 20, high: 20, low: 20, close: 20, volume: 1 },
          { date: '2026-01-07', open: 20, high: 20, low: 20, close: 20, volume: 1 },
        ],
      },
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 20 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState; // round 0: buy 20 @ $100

    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState; // round 1: crash + margin call

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills).toEqual([
      {
        ticker: 'NVDA',
        side: 'SELL',
        kind: 'MARKET',
        requestedQuantity: 20,
        filledQuantity: 20,
        priceCents: 20_00,
        feeCents: 0,
      },
    ]);
    // Fully closed out (0 shares), but still reported — same "still informative even at 0
    // shares" convention as an ordinary fill closing a position out (see PositionObservation).
    expect(observation.portfolio.positions).toEqual([
      {
        ticker: 'NVDA',
        shares: 0,
        averageEntryPriceCents: 0,
        realizedPnlCents: (20_00 - 100_00) * 20, // sold at $20 what cost $100 -> a $1,600 loss
        marketValueCents: 0,
        unrealizedPnlCents: 0,
      },
    ]);
    expect(observation.portfolio.riskStats.marginCalls).toBe(1);
    expect(observation.portfolio.riskStats.forcedLiquidations).toBe(1);
    // Even fully liquidated, this account is wiped out: equity is deeply negative while the
    // maintenance requirement itself has shrunk to 0 (no exposure left), so belowMaintenance
    // stays true — exactly the "even fully liquidating didn't cure it" case documented on
    // PortfolioObservation.belowMaintenance, not a pending call to action a bot could still avert.
    expect(observation.portfolio.equityCents).toBeLessThan(0);
    expect(observation.portfolio.belowMaintenance).toBe(true);
  });

  it('never force-liquidates in a cash-only account, no matter how far a position falls', () => {
    let state = initialState({
      transactionFeeRate: 0,
      historicalPrices: {
        NVDA: [
          { date: '2026-01-05', open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { date: '2026-01-06', open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ],
      },
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState;
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;

    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.fills).toEqual([]); // no forced trade — cash accounts can't be margin-called
    expect(observation.portfolio.positions[0]?.shares).toBe(10);
  });
});

describe('bot isolation', () => {
  it('redactConfigForBots strips the full future price tape, corporate-action list, and research timeline', () => {
    const configResult = stockMarket4.parseConfig(
      baseConfigInput({
        corporateActions: [
          { type: 'CASH_DIVIDEND', ticker: 'NVDA', date: '2026-01-07', perShare: 1 },
        ],
        researchTimeline: [{ date: '2026-01-06', payload: { thesis: 'bullish' } }],
      }),
    );
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    const redacted = stockMarket4.redactConfigForBots?.(configResult.value) as Record<
      string,
      unknown
    >;
    expect(redacted.historicalPrices).toEqual({});
    expect(redacted.corporateActions).toEqual([]);
    expect(redacted.researchTimeline).toEqual([]);
  });

  it('redactConfigForBots leaves every other (uniform, non-time-series) config field untouched', () => {
    const configResult = stockMarket4.parseConfig(baseConfigInput());
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    const redacted = stockMarket4.redactConfigForBots?.(configResult.value) as Record<
      string,
      unknown
    >;
    expect(redacted.startDate).toBe(configResult.value.startDate);
    expect(redacted.endDate).toBe(configResult.value.endDate);
    expect(redacted.marketDataUniverse).toEqual(configResult.value.marketDataUniverse);
    expect(redacted.startingCapital).toBe(configResult.value.startingCapital);
    expect(redacted.transactionFeeRate).toBe(configResult.value.transactionFeeRate);
    expect(redacted.risk).toEqual(configResult.value.risk);
  });

  it('onMissingAction substitutes an empty order list rather than forfeiting the whole match', () => {
    const state = initialState();
    for (const reason of ['timeout', 'invalid', 'disconnected'] as const) {
      const decision = stockMarket4.onMissingAction?.({ state, participantId: 'alice', reason });
      expect(decision).toEqual({ policy: 'substitute', action: { orders: [] } });
    }
  });

  it("never includes another participant's portfolio, fills, or anything else about them", () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const bobObservation = stockMarket4.getObservation(state, 'bob');
    // bob's own view is untouched by alice's trade...
    expect(bobObservation.portfolio).toEqual(
      allCashPortfolio(100_000_00, [
        { date: '2026-01-05', equityCents: 100_000_00 },
        { date: '2026-01-05', equityCents: 100_000_00 },
      ]),
    );
    expect(bobObservation.fills).toEqual([]);
    // ...and nothing in bob's observation names alice or exposes her portfolio/fills at all —
    // opponentIds is the only place another participant's identity legitimately appears.
    expect(bobObservation.opponentIds).toEqual(['alice']);
    expect(JSON.stringify(bobObservation)).not.toContain('"shares":10');
  });
});

describe('synthetic mode', () => {
  /** A purely synthetic series — no relation to any real ticker's actual history, generated by a
   * simple deterministic formula rather than supplied real data. This is the whole point: as far
   * as this game is concerned, it's just another `historicalPrices` entry — see `marketDataMode`'s
   * own doc comment in types.ts for why there is no separate synthetic code path to test. */
  function syntheticSeries(startDate: string, days: number, startPrice = 50) {
    const bars: ReturnType<typeof flatBar>[] = [];
    let ms = Date.parse(`${startDate}T00:00:00Z`);
    let price = startPrice;
    let produced = 0;
    while (produced < days) {
      const date = new Date(ms).toISOString().slice(0, 10);
      if (!isWeekend(date)) {
        bars.push(flatBar(date, price));
        price += produced % 2 === 0 ? 3 : -1; // an arbitrary synthetic wiggle, not real data
        produced++;
      }
      ms += MS_PER_DAY;
    }
    return bars;
  }

  it('reports marketDataMode on both the observation and the final result', () => {
    const state = initialState({
      marketDataMode: 'synthetic',
      historicalPrices: { NVDA: syntheticSeries('2025-12-29', 10) },
    });
    expect(stockMarket4.getObservation(state, 'alice').marketDataMode).toBe('synthetic');
    expect(stockMarket4.getResult(state).marketDataMode).toBe('synthetic');
  });

  it('defaults to historical when marketDataMode is not declared', () => {
    const state = initialState();
    expect(stockMarket4.getObservation(state, 'alice').marketDataMode).toBe('historical');
    expect(stockMarket4.getResult(state).marketDataMode).toBe('historical');
  });

  it('trades against a synthetic series through the exact same execution pipeline as historical data', () => {
    let state = initialState({
      marketDataMode: 'synthetic',
      historicalPrices: { NVDA: syntheticSeries('2025-12-29', 10) },
    });
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;

    const observation = stockMarket4.getObservation(state, 'alice');
    // Round 0 (2026-01-05) is the 6th weekday from 2025-12-29 in this synthetic series, same
    // indexing convention as the historical-mode fixture — price 50, +3/-1 alternating from day 0.
    expect(observation.fills[0]).toMatchObject({ side: 'BUY', filledQuantity: 10 });
    expect(observation.portfolio.positions[0]?.shares).toBe(10);
  });

  it('applies corporate actions to a synthetic series exactly as it would to historical data', () => {
    let state = initialState({
      marketDataMode: 'synthetic',
      historicalContextDays: 5,
      historicalPrices: {
        NVDA: [
          { date: '2026-01-05', open: 400, high: 400, low: 400, close: 400, volume: 1 },
          { date: '2026-01-06', open: 200, high: 200, low: 200, close: 200, volume: 1 },
        ],
      },
      corporateActions: [
        { type: 'STOCK_SPLIT', ticker: 'NVDA', date: '2026-01-06', fromShares: 1, toShares: 2 },
      ],
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState; // round 0: buy 10 @ 400
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState; // round 1: split settles

    expect(stockMarket4.getObservation(state, 'alice').portfolio.positions[0]).toMatchObject({
      shares: 20,
      averageEntryPriceCents: 200_00,
    });
  });
});

describe('benchmarks & metrics', () => {
  it("accumulates each participant's equity history across the whole match", () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;

    const history = stockMarket4.getObservation(state, 'alice').portfolio.equityHistory;
    // Seed point (pre-trading) + one per resolved round so far (2).
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ date: '2026-01-05', equityCents: 100_000_00 });
    expect(history.every((point) => typeof point.equityCents === 'number')).toBe(true);
  });

  it("reports non-flat performance metrics for a participant who traded, and flat for one who didn't", () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    for (let i = 0; i < 5; i++) {
      expect(stockMarket4.isTerminal(state)).toBe(false);
      state = stockMarket4.resolve({
        state,
        actions: i === 0 ? actions : noopActions(),
        rng,
      }).nextState;
    }
    expect(stockMarket4.isTerminal(state)).toBe(true);

    const result = stockMarket4.getResult(state);
    // NVDA's default fixture price rises every day, so alice (long from round 0) shows a real gain.
    expect(result.performanceMetrics.alice?.totalReturn).toBeGreaterThan(0);
    expect(result.performanceMetrics.bob).toEqual(FLAT_PERFORMANCE_METRICS);
  });

  it('computes benchmarkReturn as buy-and-hold over the exact dates the match actually played', () => {
    let state = initialState({
      benchmarkTicker: 'SPY',
      historicalPrices: {
        NVDA: weekdayBars('2025-12-29', '2026-01-09'),
        SPY: [
          { date: '2025-12-29', open: 300, high: 300, low: 300, close: 300, volume: 1 }, // before the match — must not be used
          { date: '2026-01-05', open: 400, high: 400, low: 400, close: 400, volume: 1 }, // round 0
          { date: '2026-01-09', open: 440, high: 440, low: 440, close: 440, volume: 1 }, // round 4 (last)
        ],
      },
    });
    for (let i = 0; i < 5; i++) {
      state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
    }
    expect(stockMarket4.getResult(state).benchmarkReturn).toBeCloseTo((440 - 400) / 400, 10);
  });

  it('reports benchmarkReturn as null when no benchmarkTicker is declared', () => {
    let state = initialState();
    for (let i = 0; i < 5; i++) {
      state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
    }
    expect(stockMarket4.getResult(state).benchmarkReturn).toBeNull();
  });
});

describe('getStandingOutcomes ranking', () => {
  it('ranks higher final equity as the winner', () => {
    let state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    for (let i = 0; i < 5; i++) {
      state = stockMarket4.resolve({
        state,
        actions: i === 0 ? actions : noopActions(),
        rng,
      }).nextState;
    }
    const outcomes = stockMarket4.getStandingOutcomes(stockMarket4.getResult(state));
    const alice = outcomes.find((o) => o.participantId === 'alice');
    const bob = outcomes.find((o) => o.participantId === 'bob');
    expect(alice).toMatchObject({ rank: 1, outcome: 'win' });
    expect(bob).toMatchObject({ rank: 2, outcome: 'loss' });
    expect(alice?.score ?? 0).toBeGreaterThan(bob?.score ?? 0);
  });

  it('compresses ranks across a tie (1, 1, 3), not (1, 1, 2)', () => {
    const configResult = stockMarket4.parseConfig(baseConfigInput());
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    let state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: ['a', 'b', 'c'],
      rng,
    });
    const buyOrder = {
      orders: [{ kind: 'MARKET' as const, ticker: 'NVDA', side: 'BUY' as const, quantity: 10 }],
    };
    const noop = { orders: [] };
    const firstRoundActions = new Map([
      ['a', buyOrder],
      ['b', buyOrder],
      ['c', noop],
    ]);
    const laterRoundActions = new Map([
      ['a', noop],
      ['b', noop],
      ['c', noop],
    ]);
    for (let i = 0; i < 5; i++) {
      state = stockMarket4.resolve({
        state,
        actions: i === 0 ? firstRoundActions : laterRoundActions,
        rng,
      }).nextState;
    }
    const outcomes = stockMarket4.getStandingOutcomes(stockMarket4.getResult(state));
    const rankOf = (id: string) => outcomes.find((o) => o.participantId === id)?.rank;
    // a and b made the identical trade -> tie for 1st; c never traded NVDA's rising price -> 3rd,
    // not 2nd, since two participants already occupy rank 1.
    expect(rankOf('a')).toBe(1);
    expect(rankOf('b')).toBe(1);
    expect(rankOf('c')).toBe(3);
  });

  it('reports a solo win for a single-participant match', () => {
    const configResult = stockMarket4.parseConfig(baseConfigInput());
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: ['alice'],
      rng,
    });
    const outcomes = stockMarket4.getStandingOutcomes(stockMarket4.getResult(state));
    expect(outcomes).toEqual([
      { participantId: 'alice', rank: 1, score: 100_000_00, outcome: 'win' },
    ]);
  });
});

describe('audit trail (resolve events)', () => {
  it("reports the round's date, every participant's fills, and empty lists for a quiet round", () => {
    const state = initialState();
    const actions = noopActions();
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 10 }],
    });
    const outcome = stockMarket4.resolve({ state, actions, rng });
    const data = outcome.events[0]?.data as {
      date: string;
      fills: Record<string, unknown[]>;
      marginCalledParticipantIds: string[];
      corporateActionsSettled: unknown[];
    };
    expect(data.date).toBe('2026-01-05');
    expect(data.fills.alice).toHaveLength(1);
    expect(data.fills.bob).toEqual([]);
    expect(data.marginCalledParticipantIds).toEqual([]);
    expect(data.corporateActionsSettled).toEqual([]);
  });

  it('reports settled corporate actions on the round they take effect', () => {
    const state = initialState({
      corporateActions: [
        { type: 'CASH_DIVIDEND', ticker: 'NVDA', date: '2026-01-06', perShare: 1 },
      ],
    });
    const round0 = stockMarket4.resolve({ state, actions: noopActions(), rng });
    expect(
      (round0.events[0]?.data as { corporateActionsSettled: unknown[] }).corporateActionsSettled,
    ).toEqual([]);

    const round1 = stockMarket4.resolve({
      state: round0.nextState,
      actions: noopActions(),
      rng,
    });
    expect(
      (round1.events[0]?.data as { corporateActionsSettled: unknown[] }).corporateActionsSettled,
    ).toEqual([{ type: 'CASH_DIVIDEND', ticker: 'NVDA', date: '2026-01-06', perShare: 1 }]);
  });

  it('reports which participant got margin-called on the round it happens', () => {
    let state = initialState({
      risk: {
        allowShortSelling: true,
        initialMarginRatio: 0.5,
        maintenanceMarginRatio: 0.3,
        borrowableShares: 1000,
        borrowFeeAnnualized: 0,
      },
      transactionFeeRate: 0,
      startingCapital: 1000,
      historicalPrices: {
        NVDA: [
          { date: '2026-01-05', open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { date: '2026-01-06', open: 20, high: 20, low: 20, close: 20, volume: 1 },
        ],
      },
    });
    const buy = noopActions();
    buy.set('alice', { orders: [{ kind: 'MARKET', ticker: 'NVDA', side: 'BUY', quantity: 20 }] });
    state = stockMarket4.resolve({ state, actions: buy, rng }).nextState; // round 0: buy on margin

    const round1 = stockMarket4.resolve({ state, actions: noopActions(), rng }); // round 1: crash
    const data = round1.events[0]?.data as { marginCalledParticipantIds: string[] };
    expect(data.marginCalledParticipantIds).toEqual(['alice']);
  });
});
