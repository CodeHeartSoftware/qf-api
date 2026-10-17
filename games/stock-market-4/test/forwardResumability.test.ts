import {
  appendBars,
  createMarketDataStore,
  publishDatasetVersion,
} from '@quant-fusion/market-data';
import { createRng } from '@quant-fusion/rng';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isForwardMatchFullyResolved,
  resumeForwardState,
  serializeForwardState,
  stockMarket4,
} from '../src/game.js';
import type { StockMarket4Action, StockMarket4State } from '../src/types.js';

/**
 * Proves the roadmap Phase 3 crash/restart-equivalence requirement: a match "restarted" between
 * any two rounds (state serialized to real JSON, discarded entirely, then rebuilt via
 * `resumeForwardState`) must produce IDENTICAL observations and results to a match that never
 * stopped. Done entirely at the game level, with no OS process spawn — `StockMarket4State` is
 * confirmed to be the complete source of truth (no module-level caches this test could miss), so a
 * real `JSON.stringify`/`JSON.parse` round-trip through `serializeForwardState`/`resumeForwardState`
 * is exactly as strong a proof as an actual process boundary would be, while also catching a
 * subtler class of bug (e.g. a stray `undefined`/`NaN` field JSON would silently corrupt) that
 * merely reusing the in-memory object would not.
 */

const rng = createRng(Buffer.alloc(16, 1));
const PARTICIPANT_IDS = ['alice', 'bob'];
const DATASET_ID = 'forward-resumability-dataset';
const DATASET_VERSION = '1';

function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

// A run of trading days: 2026-01-05 (Mon) through 2026-01-09 (Fri), five trading days.
const ALL_DATES = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
const FAST_BARS = ALL_DATES.map((date, i) => flatBar(date, 10 + i));
const SLOW_BARS = ALL_DATES.map((date, i) => flatBar(date, 20 + i));

function noopActions(): Map<string, StockMarket4Action> {
  return new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
}

/** alice buys on round 0 so portfolio/fills/equity math is actually exercised across a restart,
 * not just replayed with empty actions. */
function actionsFor(round: number): Map<string, StockMarket4Action> {
  const actions = noopActions();
  if (round === 0) {
    actions.set('alice', {
      orders: [{ kind: 'MARKET', ticker: 'FAST', side: 'BUY', quantity: 5 }],
    });
  }
  return actions;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm4-forward-resumability-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Each caller gets its OWN store directory (a subdirectory of the per-test `dir`) — a test that
 * runs both a continuous match and a separately-restarted match side by side needs two
 * independent SQLite files, since `publishDatasetVersion` fails if `(id, version)` already exists
 * and the two runs otherwise grow their datasets on completely different schedules. */
function seedDataset(storeDir: string, barsThroughIndex: number): void {
  mkdirSync(storeDir, { recursive: true });
  const store = createMarketDataStore(join(storeDir, `${DATASET_ID}.sqlite`));
  const published = publishDatasetVersion(
    store,
    { id: DATASET_ID, version: DATASET_VERSION },
    {
      bars: {
        FAST: FAST_BARS.slice(0, barsThroughIndex + 1),
        SLOW: SLOW_BARS.slice(0, barsThroughIndex + 1),
      },
    },
  );
  if (!published.ok) throw new Error(published.reason);
}

function growDataset(storeDir: string, barThroughIndex: number): void {
  const store = createMarketDataStore(join(storeDir, `${DATASET_ID}.sqlite`));
  const identity = { id: DATASET_ID, version: DATASET_VERSION };
  const appended = appendBars(store, identity, {
    bars: {
      FAST: FAST_BARS.slice(barThroughIndex, barThroughIndex + 1),
      SLOW: SLOW_BARS.slice(barThroughIndex, barThroughIndex + 1),
    },
  });
  if (!appended.ok) throw new Error(appended.reason);
}

function configInput(storeDir: string, overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05',
    endDate: '2026-01-09',
    marketDataUniverse: ['FAST', 'SLOW'],
    historicalContextDays: 10,
    gameType: 'FORWARD_SHADOW',
    marketDataset: {
      id: DATASET_ID,
      version: DATASET_VERSION,
      dbPath: join(storeDir, `${DATASET_ID}.sqlite`),
    },
    ...overrides,
  };
}

/** Every observation for every participant, one entry per round actually played — the thing Run A
 * and Run B must match exactly, round for round. */
function observeAll(state: StockMarket4State): unknown {
  return Object.fromEntries(
    PARTICIPANT_IDS.map((id) => [id, stockMarket4.getObservation(state, id)]),
  );
}

/** Runs a match to completion in one continuous, unbroken loop — no restart. Seeds its own,
 * fully-grown dataset in `storeDir` (all trading days present from the start). */
function runContinuous(storeDir: string): { observationsByRound: unknown[]; result: unknown } {
  seedDataset(storeDir, FAST_BARS.length - 1);
  const configResult = stockMarket4.parseConfig(configInput(storeDir));
  if (!configResult.ok) throw new Error(configResult.reason);
  let state = stockMarket4.initialize({
    config: configResult.value,
    participantIds: PARTICIPANT_IDS,
    rng,
  });
  const observationsByRound: unknown[] = [];
  while (!stockMarket4.isTerminal(state)) {
    observationsByRound.push(observeAll(state));
    state = stockMarket4.resolve({ state, actions: actionsFor(state.round), rng }).nextState;
  }
  return { observationsByRound, result: stockMarket4.getResult(state) };
}

/**
 * Plays a match whose dataset starts with only round 0's data and grows one day at a time as play
 * catches up to it — the genuine FORWARD_SHADOW scenario. `restartEveryRound` controls the ONLY
 * thing this function varies between two calls that should otherwise be indistinguishable: whether
 * a real "restart" (serialize to actual JSON text, discard the in-memory object entirely, parse it
 * back, rebuild live state from just the plain snapshot + config) is injected before every round,
 * or state simply carries over in memory. Both take the identical growth schedule (seed round 0,
 * append one more day each time the match would otherwise stall on "no more data yet"), so
 * `totalRounds`/every other observed field advances on the same schedule in both — restarting is
 * the only variable, which is the actual thing this test suite exists to prove doesn't matter.
 */
function playGrowingMatch(
  storeDir: string,
  restartEveryRound: boolean,
): { observationsByRound: unknown[]; result: unknown } {
  seedDataset(storeDir, 0); // only round 0's data exists at match creation
  const configResult = stockMarket4.parseConfig(configInput(storeDir));
  if (!configResult.ok) throw new Error(configResult.reason);

  let state: StockMarket4State = stockMarket4.initialize({
    config: configResult.value,
    participantIds: PARTICIPANT_IDS,
    rng,
  });
  const observationsByRound: unknown[] = [];
  let grown = 0;

  for (;;) {
    if (restartEveryRound) {
      const json = JSON.stringify(serializeForwardState(state));
      const snapshot = JSON.parse(json) as ReturnType<typeof serializeForwardState>;
      state = resumeForwardState({
        config: configResult.value,
        participantIds: PARTICIPANT_IDS,
        snapshot,
      });
    }

    if (stockMarket4.isTerminal(state)) {
      if (isForwardMatchFullyResolved(state) || grown >= FAST_BARS.length - 1) break;
      grown += 1;
      growDataset(storeDir, grown);
      if (!restartEveryRound) {
        // No restart to pick up the fresh cutoff via — re-derive state the same way a restart
        // would have, so both branches see new data land the exact same way.
        state = resumeForwardState({
          config: configResult.value,
          participantIds: PARTICIPANT_IDS,
          snapshot: serializeForwardState(state),
        });
      }
      continue;
    }

    observationsByRound.push(observeAll(state));
    state = stockMarket4.resolve({ state, actions: actionsFor(state.round), rng }).nextState;
  }

  return { observationsByRound, result: stockMarket4.getResult(state) };
}

describe('forward-match resumability', () => {
  it('a match restarted before every round matches one that never restarts, on the same growth schedule', () => {
    const notRestarted = playGrowingMatch(join(dir, 'no-restart'), false);
    const restarted = playGrowingMatch(join(dir, 'restarted'), true);
    expect(restarted.observationsByRound).toEqual(notRestarted.observationsByRound);
    expect(restarted.result).toEqual(notRestarted.result);
  });

  it('a single mid-match restart matches a continuous run', () => {
    const restartDir = join(dir, 'restarted');
    seedDataset(restartDir, FAST_BARS.length - 1); // all data available from the start
    const configResult = stockMarket4.parseConfig(configInput(restartDir));
    if (!configResult.ok) throw new Error(configResult.reason);

    let state: StockMarket4State = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    const observationsByRound: unknown[] = [];
    let restarted = false;
    while (!stockMarket4.isTerminal(state)) {
      observationsByRound.push(observeAll(state));
      state = stockMarket4.resolve({ state, actions: actionsFor(state.round), rng }).nextState;
      if (!restarted && state.round === 2) {
        const json = JSON.stringify(serializeForwardState(state));
        state = resumeForwardState({
          config: configResult.value,
          participantIds: PARTICIPANT_IDS,
          snapshot: JSON.parse(json) as ReturnType<typeof serializeForwardState>,
        });
        restarted = true;
      }
    }

    const continuous = runContinuous(join(dir, 'continuous'));
    expect(observationsByRound).toEqual(continuous.observationsByRound);
    expect(stockMarket4.getResult(state)).toEqual(continuous.result);
  });

  it('recomputes forwardShadowCutoffDate fresh on resume rather than trusting the snapshot', () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    const initial = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    expect(initial.forwardShadowCutoffDate).toBe('2026-01-05');

    growDataset(dir, 1);
    const resumed = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot: serializeForwardState(initial), // still carries the STALE 2026-01-05 cutoff
    });
    expect(resumed.forwardShadowCutoffDate).toBe('2026-01-06');
  });

  it("isForwardMatchFullyResolved is false while data hasn't caught up to endDate, true once it has", () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    let state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    while (!stockMarket4.isTerminal(state)) {
      state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
    }
    // isTerminal is true (ran out of CURRENTLY known data), but the match isn't really over —
    // this is exactly the ambiguity isForwardMatchFullyResolved exists to resolve.
    expect(stockMarket4.isTerminal(state)).toBe(true);
    expect(isForwardMatchFullyResolved(state)).toBe(false);

    for (let i = 1; i < FAST_BARS.length; i++) {
      growDataset(dir, i);
      state = resumeForwardState({
        config: configResult.value,
        participantIds: PARTICIPANT_IDS,
        snapshot: serializeForwardState(state),
      });
      while (!stockMarket4.isTerminal(state)) {
        state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
      }
    }
    expect(isForwardMatchFullyResolved(state)).toBe(true);
  });

  it('previousFills holds the round before lastFills, shifting one round back on each resolve', () => {
    seedDataset(dir, 1);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    let state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    expect(state.previousFills.get('alice')).toEqual([]);

    // Round 0: alice buys.
    state = stockMarket4.resolve({ state, actions: actionsFor(0), rng }).nextState;
    expect(state.lastFills.get('alice')).not.toEqual([]);
    expect(state.previousFills.get('alice')).toEqual([]);

    // Round 1: alice trades nothing new — lastFills goes empty, previousFills picks up round 0's
    // fill instead of losing it outright.
    const round0Fills = state.lastFills.get('alice');
    state = stockMarket4.resolve({ state, actions: noopActions(), rng }).nextState;
    expect(state.lastFills.get('alice')).toEqual([]);
    expect(state.previousFills.get('alice')).toEqual(round0Fills);
  });

  it('resumeForwardState defaults previousFills to empty when resuming a pre-existing v1 snapshot', () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    let state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    state = stockMarket4.resolve({ state, actions: actionsFor(0), rng }).nextState;

    // A real snapshot persisted before `previousFills` existed — no such field at all, not merely
    // empty — the exact shape `resumeForwardState` must still accept.
    const current = serializeForwardState(state);
    const v2Snapshot = current;
    const v1Snapshot = {
      snapshotVersion: 1 as const,
      round: v2Snapshot.round,
      forwardShadowCutoffDate: v2Snapshot.forwardShadowCutoffDate,
      portfolios: v2Snapshot.portfolios,
      lastFills: v2Snapshot.lastFills,
      riskStats: v2Snapshot.riskStats,
      equityHistory: v2Snapshot.equityHistory,
    };
    const resumed = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot: v1Snapshot,
    });
    expect(resumed.previousFills.get('alice')).toEqual([]);
    // Everything else still round-trips normally.
    expect(resumed.lastFills.get('alice')).toEqual(state.lastFills.get('alice'));
  });

  it('resumeForwardState resumes a pre-existing v2 snapshot with no orders pending', () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    let state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    state = stockMarket4.resolve({ state, actions: actionsFor(0), rng }).nextState;

    // A real snapshot persisted before next-open execution existed — every live forward match
    // today — so there is no `pendingOrders` field at all.
    const current = serializeForwardState(state);
    if (current.snapshotVersion !== 3)
      throw new Error('expected serializeForwardState to write v3');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the field is the point
    const { pendingOrders: _dropped, ...rest } = current;
    const v2Snapshot = { ...rest, snapshotVersion: 2 as const };
    const resumed = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot: v2Snapshot,
    });
    expect(resumed.pendingOrders.get('alice')).toEqual([]);
    expect(resumed.previousFills.get('alice')).toEqual(state.previousFills.get('alice'));
  });

  it('resumeForwardState rejects a snapshot from an unsupported version', () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    const snapshot = { ...serializeForwardState(state), snapshotVersion: 99 };
    expect(() =>
      resumeForwardState({ config: configResult.value, participantIds: PARTICIPANT_IDS, snapshot }),
    ).toThrow(/invalid forward snapshot/);
  });

  it('resumeForwardState rejects malformed/untrusted input generally', () => {
    seedDataset(dir, 0);
    const configResult = stockMarket4.parseConfig(configInput(dir));
    if (!configResult.ok) throw new Error(configResult.reason);
    expect(() =>
      resumeForwardState({
        config: configResult.value,
        participantIds: PARTICIPANT_IDS,
        snapshot: { not: 'a real snapshot' },
      }),
    ).toThrow(/invalid forward snapshot/);
  });
});
