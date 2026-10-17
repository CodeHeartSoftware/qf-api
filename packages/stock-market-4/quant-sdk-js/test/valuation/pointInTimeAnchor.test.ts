import { describe, expect, it } from 'vitest';
import type { SecurityConfig } from '../../src/config.js';
import type { DailyBar } from '../../src/marketTypes.js';
import {
  assertPointInTimeAnchors,
  resolveStaticBaseAnchor,
} from '../../src/valuation/pointInTimeAnchor.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

const CONFIG_ANCHOR = { bear: 10, base: 20, bull: 30 };

function security(ticker: string, anchorAsOf?: string): SecurityConfig<null> {
  return {
    ticker,
    targetEntityId: `entity-${ticker}`,
    sharesOutstanding: 1,
    valuation: {
      baseBusinessValuePerShare: CONFIG_ANCHOR,
      ...(anchorAsOf === undefined ? {} : { anchorAsOf }),
      domainOptionValueBaselinePerShare: { bear: 0, base: 0, bull: 0 },
      domain: null,
      sensitivities: {
        manufacturingCapabilityToBaseValuePerShare: 0,
        manufacturingCapabilityToDomainOptionPerShare: 0,
        hypothesisConfidenceToDomainOptionPerShare: 0,
        supplierCaptureToDomainOptionPerShare: 0,
      },
    },
  };
}

describe('resolveStaticBaseAnchor', () => {
  it('first_observed anchors on the earliest bar seen, never a later one', () => {
    const history = [bar('2026-07-01', 8), bar('2026-07-02', 50)];
    expect(
      resolveStaticBaseAnchor(CONFIG_ANCHOR, history, 99, {
        mode: 'first_observed',
        bandPct: 0.25,
      }),
    ).toEqual({
      bear: 6,
      base: 8,
      bull: 10,
    });
  });

  it('first_observed falls back to the current price on the very first round', () => {
    expect(
      resolveStaticBaseAnchor(CONFIG_ANCHOR, [], 40, { mode: 'first_observed', bandPct: 0.5 }),
    ).toEqual({
      bear: 20,
      base: 40,
      bull: 60,
    });
  });

  it('defaults to first_observed when no policy is given', () => {
    expect(resolveStaticBaseAnchor(CONFIG_ANCHOR, [bar('2026-07-01', 4)], 99).base).toBe(4);
  });

  it('config mode returns the config anchor unchanged', () => {
    expect(
      resolveStaticBaseAnchor(CONFIG_ANCHOR, [bar('2026-07-01', 4)], 99, { mode: 'config' }),
    ).toBe(CONFIG_ANCHOR);
  });
});

describe('assertPointInTimeAnchors', () => {
  it('rejects config anchors dated after the first trading date, or undated', () => {
    expect(() => {
      assertPointInTimeAnchors(
        [security('A', '2026-09-09'), security('B')],
        { mode: 'config' },
        '2026-07-01',
      );
    }).toThrow(/A \(anchorAsOf 2026-09-09\), B \(anchorAsOf missing\)/);
  });

  it('accepts config anchors knowable on or before the first trading date', () => {
    expect(() => {
      assertPointInTimeAnchors([security('A', '2026-09-09')], { mode: 'config' }, '2026-09-09');
    }).not.toThrow();
  });

  it('is a no-op for first_observed, which cannot look ahead', () => {
    expect(() => {
      assertPointInTimeAnchors(
        [security('A')],
        { mode: 'first_observed', bandPct: 0.25 },
        '2026-07-01',
      );
    }).not.toThrow();
  });
});
