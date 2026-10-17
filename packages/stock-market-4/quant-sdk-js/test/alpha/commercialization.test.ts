import { describe, expect, it } from 'vitest';
import { computeCommercializationAlpha } from '../../src/alpha/commercialization.js';

describe('computeCommercializationAlpha', () => {
  it('is silent when there is no supplier_capture effect', () => {
    const result = computeCommercializationAlpha({ ticker: 'X', date: null, effects: [] });
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('is positive for an upgrade, negative for a downgrade', () => {
    const upgrade = computeCommercializationAlpha({
      ticker: 'X',
      date: null,
      effects: [
        {
          factor: 'supplier_capture',
          direction: 'positive',
          magnitude: 1,
          confidence: 1,
          rationale: 'x',
        },
      ],
    });
    expect(upgrade.value).toBeGreaterThan(0);

    const downgrade = computeCommercializationAlpha({
      ticker: 'X',
      date: null,
      effects: [
        {
          factor: 'supplier_capture',
          direction: 'negative',
          magnitude: 1,
          confidence: 1,
          rationale: 'x',
        },
      ],
    });
    expect(downgrade.value).toBeLessThan(0);
  });

  it('ignores an unrelated effect', () => {
    const result = computeCommercializationAlpha({
      ticker: 'X',
      date: null,
      effects: [
        {
          factor: 'manufacturing_capability',
          direction: 'positive',
          magnitude: 1,
          confidence: 1,
          rationale: 'x',
        },
      ],
    });
    expect(result.value).toBe(0);
  });
});
