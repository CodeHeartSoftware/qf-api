import { describe, expect, it } from 'vitest';
import { latestResearchDate } from '../src/commands/matchForwardStatus.js';

describe('latestResearchDate', () => {
  it('returns the latest observedAt day, ignoring later publishedAt and other timestamps', () => {
    const dataset = {
      evidence: [
        { id: 'a', observedAt: '2026-05-01T00:00:00Z', publishedAt: '2027-01-01T00:00:00Z' },
        { id: 'b', observedAt: '2026-09-10T14:00:00Z' },
      ],
      scenarios: [{ id: 's', horizonEnd: '2030-12-31T00:00:00Z' }],
      assertions: [{ provenance: { observedAt: '2026-08-02T00:00:00-04:00' } }],
    };
    expect(latestResearchDate(dataset)).toBe('2026-09-10');
  });

  it('finds observedAt nested at any depth', () => {
    expect(
      latestResearchDate({
        a: { b: [{ c: { provenance: { observedAt: '2026-09-21T00:00:00Z' } } }] },
      }),
    ).toBe('2026-09-21');
  });

  it('returns undefined when nothing has an observedAt', () => {
    expect(
      latestResearchDate({ evidence: [{ publishedAt: '2027-01-01T00:00:00Z' }] }),
    ).toBeUndefined();
  });
});
