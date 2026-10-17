import { describe, expect, it } from 'vitest';
import { researchAsOf } from '../../src/research/timeline.js';
import type { ResearchEntry } from '../../src/types.js';

const TIMELINE: ResearchEntry[] = [
  { date: '2026-01-01', payload: { confidence: 0.5 } },
  { date: '2026-01-05', payload: { confidence: 0.7 } },
  { date: '2026-01-10', payload: { confidence: 0.9 } },
];

describe('researchAsOf', () => {
  it('returns the most recent entry at or before the given date', () => {
    expect(researchAsOf(TIMELINE, '2026-01-06')).toEqual({ confidence: 0.7 });
  });

  it('returns the exact entry on its own date', () => {
    expect(researchAsOf(TIMELINE, '2026-01-05')).toEqual({ confidence: 0.7 });
  });

  it('returns the latest entry once the date is past the whole timeline', () => {
    expect(researchAsOf(TIMELINE, '2026-06-01')).toEqual({ confidence: 0.9 });
  });

  it('is undefined before the first entry — no lookahead', () => {
    expect(researchAsOf(TIMELINE, '2025-12-31')).toBeUndefined();
  });

  it('is undefined for an empty timeline', () => {
    expect(researchAsOf([], '2026-01-05')).toBeUndefined();
  });

  it('never leaks a future entry, no matter its shape', () => {
    const result = researchAsOf(TIMELINE, '2026-01-09');
    expect(result).toEqual({ confidence: 0.7 }); // not the 01-10 entry
  });

  it('treats payload as fully opaque — passes through any JSON shape untouched', () => {
    const weird: ResearchEntry[] = [{ date: '2026-01-01', payload: [1, 'two', { three: true }] }];
    expect(researchAsOf(weird, '2026-01-01')).toEqual([1, 'two', { three: true }]);
  });
});
