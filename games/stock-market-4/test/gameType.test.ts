import {
  createMarketDataStore,
  publishDatasetVersion,
  renderCheckedThroughSql,
  writeProvisionalBar,
} from '@quant-fusion/market-data';
import { createRng } from '@quant-fusion/rng';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resumeForwardState, serializeForwardState, stockMarket4 } from '../src/game.js';

/**
 * Proves `config.gameType` (roadmap Phase 2 — see docs/adr/0011-explicit-game-types.md) does
 * exactly what it's meant to and nothing more: `'HISTORICAL'`/`'SYNTHETIC'` are byte-identical to
 * this game's pre-existing behavior (full nominal calendar, regardless of how sparse a
 * `marketDataset` actually is), and `'FORWARD_SHADOW'` is the ONE case where the effective trading
 * calendar is trimmed to what the dataset actually has — using `MIN` across the traded universe's
 * per-ticker freshness, never a dataset-wide `MAX` (see `forwardShadowCutoffDateFor` in
 * `src/game.ts` for why `MAX` would be wrong).
 */

const rng = createRng(Buffer.alloc(16, 1));
const PARTICIPANT_IDS = ['alice', 'bob'];
const DATASET_ID = 'gametype-test-dataset';
const DATASET_VERSION = '1';

function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

// Nominal calendar for startDate 2026-01-05 / endDate 2026-01-12 (no holidays): six trading days
// — 01-05, 06, 07, 08, 09, 12 (01-10/11 is a weekend).
const FAST_BARS = [
  flatBar('2026-01-05', 10),
  flatBar('2026-01-06', 10.1),
  flatBar('2026-01-07', 10.2),
  flatBar('2026-01-08', 10.3),
  flatBar('2026-01-09', 10.4), // FAST is known through 01-09
];
const SLOW_BARS = [
  flatBar('2026-01-05', 20),
  flatBar('2026-01-06', 20.1),
  flatBar('2026-01-07', 20.2), // SLOW is known only through 01-07 — the binding constraint
];
const STALE_BAR = [flatBar('2026-01-02', 5)]; // known only through a date BEFORE startDate
const BENCH_BARS = [flatBar('2026-01-02', 1)]; // deliberately even more stale than STALE_BAR
// Known only through the FIRST nominal day, no checked-through, no provisional ever recorded for
// it — mirrors the real fusion-quant-showdown incident exactly: 8 of 11 tickers had fresh
// same-day data, but the 3 JPY tickers (still on a real, ongoing market holiday, no confirmation
// yet for TODAY specifically per the checked-through "never trust same-day" rule) kept the whole
// universe's real cutoff pinned at yesterday — and, before the fix below, kept PREVIEW pinned
// there too, defeating the entire point of a mid-day preview.
const BLOCKED_BAR = [flatBar('2026-01-05', 1)];

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm4-gametype-'));
  dbPath = join(dir, 'db.sqlite');
  const store = createMarketDataStore(dbPath);
  const published = publishDatasetVersion(
    store,
    { id: DATASET_ID, version: DATASET_VERSION },
    {
      bars: {
        FAST: FAST_BARS,
        SLOW: SLOW_BARS,
        STALE: STALE_BAR,
        BENCH: BENCH_BARS,
        BLOCKED: BLOCKED_BAR,
      },
    },
  );
  if (!published.ok) throw new Error(published.reason);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function marketDatasetConfigInput(overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05',
    endDate: '2026-01-12',
    marketDataUniverse: ['FAST', 'SLOW'],
    historicalContextDays: 10,
    marketDataset: { id: DATASET_ID, version: DATASET_VERSION, dbPath },
    ...overrides,
  };
}

describe('gameType default', () => {
  it('defaults to HISTORICAL when omitted', () => {
    const result = stockMarket4.parseConfig(marketDatasetConfigInput());
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.gameType).toBe('HISTORICAL');
  });
});

describe('FORWARD_SHADOW config validation', () => {
  it('rejects inline historicalPrices — forward data cannot be fully authored up front', () => {
    const result = stockMarket4.parseConfig({
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      marketDataUniverse: ['FAST'],
      gameType: 'FORWARD_SHADOW',
      historicalPrices: { FAST: FAST_BARS },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('config.marketDataset');
  });

  it('accepts a marketDataset-backed config', () => {
    const result = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('FORWARD_SHADOW calendar trimming', () => {
  it("stops at the traded universe's earliest lagging ticker (MIN), not the latest (MAX)", () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });

    // SLOW is known only through 01-07 (3 trading days: 01-05, 06, 07) — FAST's extra 01-08/01-09
    // coverage must NOT extend the match, proving MIN, not MAX, governs the cutoff.
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.totalRounds).toBe(3);
    expect(observation.gameType).toBe('FORWARD_SHADOW');

    let current = state;
    const actions = new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
    let rounds = 0;
    while (!stockMarket4.isTerminal(current)) {
      current = stockMarket4.resolve({ state: current, actions, rng }).nextState;
      rounds++;
    }
    expect(rounds).toBe(3);

    const result = stockMarket4.getResult(current);
    expect(result.totalRounds).toBe(3);
    expect(result.gameType).toBe('FORWARD_SHADOW');
  });

  it('benchmarkTicker freshness never gates the cutoff', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW', benchmarkTicker: 'BENCH' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    // BENCH is stale back to 01-02, far before SLOW's own 01-07 cutoff — if benchmarkTicker were
    // (wrongly) included in the MIN, this match would have zero playable rounds instead of 3.
    expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(3);
  });

  it('throws at initialize() when there are zero playable trading days', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({
        gameType: 'FORWARD_SHADOW',
        marketDataUniverse: ['FAST', 'STALE'],
      }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    expect(() =>
      stockMarket4.initialize({ config: configResult.value, participantIds: PARTICIPANT_IDS, rng }),
    ).toThrow(/no playable trading days/);
  });
});

describe('FORWARD_SHADOW confirmed-checked-through (market holidays)', () => {
  it("a confirmed-checked-through watermark unblocks the cutoff past a lagging ticker's last bar", () => {
    // SLOW's own bars still stop at 01-07, but ingestion has POSITIVELY CONFIRMED (via
    // @quant-fusion/market-data's ticker_checked_through watermark) that it has no trading day on
    // 01-08 or 01-09 either — e.g. a real market holiday. FAST is known through 01-09. Without the
    // watermark this would stop at 3 rounds (see the MIN-vs-MAX test above); with it, the cutoff
    // should advance all the way to FAST's own 01-09, since SLOW's absence through that date is
    // confirmed, not merely unchecked.
    const store = createMarketDataStore(dbPath);
    store.db.exec(
      renderCheckedThroughSql({ id: DATASET_ID, version: DATASET_VERSION }, [
        { ticker: 'SLOW', checkedThroughDate: '2026-01-09', checkedAt: '2026-01-10T00:00:00.000Z' },
      ]),
    );

    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });

    expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(5);
  });

  it('an UNconfirmed lag still gates the cutoff exactly as before — no watermark, no shortcut', () => {
    // Same FAST/SLOW setup as the MIN-vs-MAX test, but explicitly re-asserted here alongside the
    // confirmed-checked-through case above, so a future change can't silently make EVERY lag
    // permissive instead of only a positively-confirmed one.
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });

    expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(3);
  });
});

describe('FORWARD_SHADOW resumeForwardState allowProvisional (mid-day preview)', () => {
  it('a provisional bar is INVISIBLE without allowProvisional — real resume never advances on it', () => {
    // SLOW gets a PROVISIONAL bar for 01-08 (its exchange session still open) — if this leaked
    // into a real resume, the cutoff would wrongly advance past a not-yet-final trading day,
    // exactly what "a round can only be marked complete once the trading day has ended" forbids.
    const store = createMarketDataStore(dbPath);
    writeProvisionalBar(
      store,
      { id: DATASET_ID, version: DATASET_VERSION },
      'SLOW',
      flatBar('2026-01-08', 20.3),
      '2026-01-08T15:00:00.000Z',
    );

    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const initial = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    const snapshot = serializeForwardState(initial);

    const resumedReal = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
    });
    expect(stockMarket4.getObservation(resumedReal, 'alice').totalRounds).toBe(3);
  });

  it('allowProvisional: true makes it visible — a preview sees the not-yet-final round', () => {
    const store = createMarketDataStore(dbPath);
    writeProvisionalBar(
      store,
      { id: DATASET_ID, version: DATASET_VERSION },
      'SLOW',
      flatBar('2026-01-08', 20.3),
      '2026-01-08T15:00:00.000Z',
    );

    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const initial = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    const snapshot = serializeForwardState(initial);

    const resumedPreview = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
      allowProvisional: true,
    });
    // FAST is already known through 01-09; SLOW's provisional bar extends it to 01-08 — MIN of
    // the two is now 01-08 (4 trading days: 01-05..01-08), one more than the un-flagged 3.
    expect(stockMarket4.getObservation(resumedPreview, 'alice').totalRounds).toBe(4);
  });

  it('the SAME snapshot resumed twice, with and without the flag, never mutates anything shared', () => {
    // Guards against a lazier implementation that mutates the provider/state in place — resuming
    // for preview must never have any side effect a subsequent REAL resume could observe.
    const store = createMarketDataStore(dbPath);
    writeProvisionalBar(
      store,
      { id: DATASET_ID, version: DATASET_VERSION },
      'SLOW',
      flatBar('2026-01-08', 20.3),
      '2026-01-08T15:00:00.000Z',
    );
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const initial = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    const snapshot = serializeForwardState(initial);

    resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
      allowProvisional: true,
    });
    const resumedRealAfter = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
    });
    expect(stockMarket4.getObservation(resumedRealAfter, 'alice').totalRounds).toBe(3);
  });

  it('a ticker with real, UNCONFIRMED lag (no provisional, no checked-through) never blocks preview — the real fusion-quant-showdown incident', () => {
    // BLOCKED has real data through 01-05 only, and — unlike FURUKAWA/FUJIKURA/SUMITOMO in the
    // real incident — no checked-through watermark and no provisional bar at all, the worst case.
    // A REAL resume stays capped at round 1 (01-05) forever until BLOCKED gets real data. Preview
    // must still reveal the next scheduled round (01-06) regardless — BLOCKED just shows up as a
    // genuine `bar: null` gap for that one round, the same as any other day a ticker lacks a bar.
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({
        gameType: 'FORWARD_SHADOW',
        marketDataUniverse: ['FAST', 'SLOW', 'BLOCKED'],
      }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const initial = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    // MIN(FAST 01-09, SLOW 01-07, BLOCKED 01-05) = 01-05 — exactly one playable round at init.
    expect(stockMarket4.getObservation(initial, 'alice').totalRounds).toBe(1);

    // Actually play that one round (01-05), so `state.round` advances to 1 — matching the real
    // incident's shape (round 59 already played; previewing what would be round 60).
    const actions = new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
    const played = stockMarket4.resolve({ state: initial, actions, rng }).nextState;
    const snapshot = serializeForwardState(played);

    const resumedReal = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
    });
    // Still capped at 1 total round — BLOCKED never advanced, so there's nothing new to play for
    // real; `getObservation` reports no further round (round === totalRounds).
    expect(stockMarket4.getObservation(resumedReal, 'alice').totalRounds).toBe(1);

    const resumedPreview = resumeForwardState({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      snapshot,
      allowProvisional: true,
    });
    // Reveals round 1 (01-06) for preview even though BLOCKED has nothing for it at all.
    expect(stockMarket4.getObservation(resumedPreview, 'alice').totalRounds).toBe(2);
    const observation = stockMarket4.getObservation(resumedPreview, 'alice');
    const blocked = observation.securities.find((s) => s.ticker === 'BLOCKED');
    expect(blocked?.bar).toBeNull();
    const fast = observation.securities.find((s) => s.ticker === 'FAST');
    expect(fast?.bar?.date).toBe('2026-01-06');
  });
});

describe('HISTORICAL/SYNTHETIC are unaffected by dataset sparseness', () => {
  it.each(['HISTORICAL', 'SYNTHETIC'] as const)(
    '%s always plays the full nominal calendar, even against the same lagging dataset',
    (gameType) => {
      const configResult = stockMarket4.parseConfig(marketDatasetConfigInput({ gameType }));
      if (!configResult.ok) throw new Error(configResult.reason);
      const state = stockMarket4.initialize({
        config: configResult.value,
        participantIds: PARTICIPANT_IDS,
        rng,
      });
      // Full nominal calendar (6 days), NOT trimmed to SLOW's 01-07 cutoff — SLOW's missing bars
      // on 01-08/01-09/01-12 stay ordinary per-ticker data gaps, not a match-ending condition.
      expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(6);
      expect(stockMarket4.getObservation(state, 'alice').gameType).toBe(gameType);
    },
  );
});
