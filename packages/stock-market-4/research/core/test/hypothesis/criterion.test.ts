import { describe, expect, it } from 'vitest';
import { parseResearchCriterion } from '../../src/hypothesis/criterion.js';

describe('ResearchCriterion', () => {
  it('accepts a bare description', () => {
    expect(
      parseResearchCriterion({ description: 'Vessel qualification creates switching costs.' }).ok,
    ).toBe(true);
  });

  it('accepts a description with cited evidence', () => {
    const raw = {
      description: 'No competing supplier qualifies within 3 years.',
      evidenceIds: ['evidence-1'],
    };
    expect(parseResearchCriterion(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty description', () => {
    expect(parseResearchCriterion({ description: '' }).ok).toBe(false);
    expect(parseResearchCriterion({}).ok).toBe(false);
  });
});
