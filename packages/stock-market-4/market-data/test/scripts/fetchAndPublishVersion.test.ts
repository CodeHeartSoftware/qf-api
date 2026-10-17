import { describe, expect, it } from 'vitest';
import { compareOverlap, parseAcceptedDiffs } from '../../scripts/fetchAndPublishVersion.js';

const bar = (date: string, close: number) => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});
const tolerance = { pct: 2, abs: 0.005 };

describe('compareOverlap', () => {
  it('passes shared closes within tolerance and ignores non-shared dates', () => {
    const check = compareOverlap(
      'A',
      [bar('2026-01-02', 10.1), bar('2026-01-05', 99)],
      [bar('2026-01-02', 10)],
      tolerance,
    );
    expect(check.overlappingDays).toBe(1);
    expect(check.maxClosePctDiff).toBeCloseTo(1);
    expect(check.violations).toEqual([]);
  });

  it('flags a unit change, e.g. a split applied twice', () => {
    const check = compareOverlap(
      'A',
      [bar('2026-07-01', 4.9)],
      [bar('2026-07-01', 19.6)],
      tolerance,
    );
    expect(check.violations.map((v) => v.date)).toEqual(['2026-07-01']);
  });

  it('tolerates half-cent rounding in old data on a sub-$1 stock', () => {
    expect(
      compareOverlap('A', [bar('2026-09-16', 0.1333)], [bar('2026-09-16', 0.13)], tolerance)
        .violations,
    ).toEqual([]);
  });

  it('skips explicitly accepted dates', () => {
    const check = compareOverlap(
      'A',
      [bar('2026-09-09', 0.21)],
      [bar('2026-09-09', 0.1763)],
      tolerance,
      new Set(['2026-09-09']),
    );
    expect(check.overlappingDays).toBe(0);
    expect(check.violations).toEqual([]);
  });
});

describe('parseAcceptedDiffs', () => {
  it('groups dates by ticker', () => {
    const parsed = parseAcceptedDiffs('FREEM@2026-09-09, FREEM@2026-09-10,ELMT@2026-08-01');
    expect([...(parsed.get('FREEM') ?? [])]).toEqual(['2026-09-09', '2026-09-10']);
    expect([...(parsed.get('ELMT') ?? [])]).toEqual(['2026-08-01']);
  });

  it('rejects a malformed entry', () => {
    expect(() => parseAcceptedDiffs('FREEM-2026-09-09')).toThrow(/TICKER@YYYY-MM-DD/);
  });
});
