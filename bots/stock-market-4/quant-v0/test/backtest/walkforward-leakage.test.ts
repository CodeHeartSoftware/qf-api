import { describe, expect, it } from 'vitest';
import {
  createEqualWeightControlDecideAction,
  FULL_PRICE_SERIES_BY_TICKER,
  replayParticipant,
  sharedTradingCalendar,
  splitIntoFolds,
  trimPriceSeriesFromDate,
} from '../../backtest/walkForward.js';
import { DEFAULT_FUSION_QUANT_CONFIG } from '../../src/config.js';
import { createDecideAction } from '../../src/index.js';

/**
 * The walk-forward harness's single most important correctness property (plan Phase 1, item 9):
 * a later fold's data must NEVER reach an earlier fold's decision. Proven here empirically, not
 * just structurally: replay the full real calendar once, then replay AGAIN with the price series
 * truncated to end at fold 0's last date (simulating "fold 1/2 haven't happened yet") — the
 * truncated run's equity curve over fold 0's own dates must be BYTE-IDENTICAL to the full run's,
 * for both a fully-online-learning `quant-v0` decide action and a simple control.
 */
describe('walk-forward leakage', () => {
  const dates = sharedTradingCalendar(FULL_PRICE_SERIES_BY_TICKER);
  const folds = splitIntoFolds(dates, 3);
  const fold0EndDate = folds[0]!.endDate;

  it('a truncated replay reproduces the untruncated replay exactly up to the truncation date (quant-v0)', () => {
    const full = replayParticipant({
      decideAction: createDecideAction(),
      priceSeriesByTicker: FULL_PRICE_SERIES_BY_TICKER,
      startingCashCents: 10_000_000,
    });
    const truncated = replayParticipant({
      decideAction: createDecideAction(),
      priceSeriesByTicker: FULL_PRICE_SERIES_BY_TICKER,
      startingCashCents: 10_000_000,
      dateLimit: fold0EndDate,
    });

    const fullFold0 = full.equityHistory.filter((p) => p.date <= fold0EndDate);
    expect(JSON.stringify(truncated.equityHistory)).toBe(JSON.stringify(fullFold0));
  });

  it('a truncated replay reproduces the untruncated replay exactly up to the truncation date (equal-weight control)', () => {
    const full = replayParticipant({
      decideAction: createEqualWeightControlDecideAction(),
      priceSeriesByTicker: FULL_PRICE_SERIES_BY_TICKER,
      startingCashCents: 10_000_000,
    });
    const truncated = replayParticipant({
      decideAction: createEqualWeightControlDecideAction(),
      priceSeriesByTicker: FULL_PRICE_SERIES_BY_TICKER,
      startingCashCents: 10_000_000,
      dateLimit: fold0EndDate,
    });

    const fullFold0 = full.equityHistory.filter((p) => p.date <= fold0EndDate);
    expect(JSON.stringify(truncated.equityHistory)).toBe(JSON.stringify(fullFold0));
  });
});

describe('splitIntoFolds', () => {
  it('produces contiguous, non-overlapping, chronologically-ordered windows covering every date', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const folds = splitIntoFolds(dates, 3);
    expect(folds).toHaveLength(3);
    expect(folds[0]!.startDate).toBe(dates[0]);
    expect(folds.at(-1)!.endDate).toBe(dates.at(-1));
    for (let i = 1; i < folds.length; i++) {
      expect(folds[i]!.startDate > folds[i - 1]!.endDate).toBe(true);
    }
  });

  it('returns an empty array for no dates', () => {
    expect(splitIntoFolds([], 3)).toEqual([]);
  });
});

describe('trimPriceSeriesFromDate', () => {
  it('drops every bar before the start date, so the calendar begins on it', () => {
    const trimmed = trimPriceSeriesFromDate(FULL_PRICE_SERIES_BY_TICKER, '2026-07-01');
    const calendar = sharedTradingCalendar(trimmed);
    expect(calendar[0]! >= '2026-07-01').toBe(true);
    expect(calendar.at(-1)).toBe(sharedTradingCalendar(FULL_PRICE_SERIES_BY_TICKER).at(-1));
  });

  it('rejects a malformed date', () => {
    expect(() => trimPriceSeriesFromDate(FULL_PRICE_SERIES_BY_TICKER, '7/1/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => trimPriceSeriesFromDate(FULL_PRICE_SERIES_BY_TICKER, '')).toThrow(/YYYY-MM-DD/);
  });

  it('rejects a start date after the last available bar', () => {
    expect(() => trimPriceSeriesFromDate(FULL_PRICE_SERIES_BY_TICKER, '2099-01-01')).toThrow(/after the last/);
  });
});

describe('point-in-time valuation anchors', () => {
  const configAnchors = {
    ...DEFAULT_FUSION_QUANT_CONFIG,
    alphaEnsemble: { ...DEFAULT_FUSION_QUANT_CONFIG.alphaEnsemble, baseAnchor: { mode: 'config' as const } },
  };

  it('refuses to trade on config anchors pulled after the replay starts', () => {
    expect(() =>
      replayParticipant({
        decideAction: createDecideAction(configAnchors),
        priceSeriesByTicker: FULL_PRICE_SERIES_BY_TICKER,
        startingCashCents: 10_000_000,
      }),
    ).toThrow(/anchors are from after the first trading date/);
  });

});
