import { describe, expect, it } from 'vitest';
import {
  compareResearchTimestamps,
  isAtOrBefore,
  isValidResearchTimestamp,
  parseResearchTimestamp,
  toEpochMillis,
} from '../../src/common/timestamps.js';

describe('ResearchTimestamp', () => {
  it('accepts a UTC "Z" timestamp', () => {
    expect(parseResearchTimestamp('2026-09-08T12:00:00Z').ok).toBe(true);
  });

  it('accepts a numeric-offset timestamp', () => {
    expect(parseResearchTimestamp('2026-09-08T08:00:00-04:00').ok).toBe(true);
  });

  it('rejects a bare local timestamp with no timezone', () => {
    const result = parseResearchTimestamp('2026-09-08T12:00:00');
    expect(result.ok).toBe(false);
  });

  it('rejects a plain date with no time component', () => {
    expect(parseResearchTimestamp('2026-09-08').ok).toBe(false);
  });

  it('rejects malformed strings and non-strings', () => {
    expect(parseResearchTimestamp('not a timestamp').ok).toBe(false);
    expect(parseResearchTimestamp(1757332800000).ok).toBe(false);
    expect(isValidResearchTimestamp(null)).toBe(false);
  });

  it('isValidResearchTimestamp narrows unknown', () => {
    expect(isValidResearchTimestamp('2026-09-08T12:00:00Z')).toBe(true);
  });
});

describe('toEpochMillis', () => {
  it('converts a Z timestamp to the correct epoch millis', () => {
    expect(toEpochMillis('2026-09-08T12:00:00Z')).toBe(Date.UTC(2026, 8, 8, 12, 0, 0));
  });

  it('treats equal instants written with different offsets identically', () => {
    expect(toEpochMillis('2026-09-08T12:00:00Z')).toBe(toEpochMillis('2026-09-08T08:00:00-04:00'));
  });

  it('throws for an invalid timestamp', () => {
    expect(() => toEpochMillis('not a timestamp')).toThrow();
  });
});

describe('compareResearchTimestamps', () => {
  it('orders an earlier timestamp before a later one, regardless of offset', () => {
    expect(compareResearchTimestamps('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toBe(-1);
    expect(compareResearchTimestamps('2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(1);
  });

  it('treats equal instants as equal even when written with different offsets', () => {
    expect(compareResearchTimestamps('2026-09-08T12:00:00Z', '2026-09-08T08:00:00-04:00')).toBe(0);
  });
});

describe('isAtOrBefore', () => {
  it('is true for an earlier timestamp and false for a later one', () => {
    expect(isAtOrBefore('2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z')).toBe(true);
    expect(isAtOrBefore('2027-01-01T00:00:00Z', '2026-12-31T23:59:59Z')).toBe(false);
  });

  it('is true for the exact same instant', () => {
    expect(isAtOrBefore('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(true);
  });
});
