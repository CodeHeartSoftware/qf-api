import { describe, expect, it } from 'vitest';
import type { StockMarket4Observation } from '@quant-fusion/quant-sdk-js';
import { createDecideAction } from '../src/index.js';

/** A bare-minimum observation with no research payload at all — the shape a very first round, or
 * a game-engine hiccup, could plausibly hand this bot. Full behavior against real research/price
 * data is exercised by `../../quant-v0/backtest/walkForward.ts` (this bot is wired in there as a
 * participant, not duplicated into a second harness) — this test only guards the trivial fallback
 * path and basic wiring. */
function emptyObservation(): StockMarket4Observation {
  return {
    date: '2026-09-24',
    securities: [],
    research: undefined,
    portfolio: {
      cashCents: 10_000_000,
      buyingPowerCents: 0,
      equityCents: 10_000_000,
      positions: [],
    },
  } as unknown as StockMarket4Observation;
}

describe('quant-lite createDecideAction', () => {
  it('returns no orders when there is no research snapshot yet', () => {
    const decideAction = createDecideAction();
    const action = decideAction(emptyObservation());
    expect(action).toEqual({ orders: [] });
  });

  it('is deterministic for identical inputs', () => {
    const decideAction = createDecideAction();
    const observation = emptyObservation();
    expect(decideAction(observation)).toEqual(decideAction(observation));
  });
});
