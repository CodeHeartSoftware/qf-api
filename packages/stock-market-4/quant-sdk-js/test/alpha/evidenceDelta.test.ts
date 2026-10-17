import { describe, expect, it } from 'vitest';
import { computeEvidenceDeltaAlpha } from '../../src/alpha/evidenceDelta.js';
import type { ModelEffect } from '../../src/research/interpretEvents.js';

describe('computeEvidenceDeltaAlpha', () => {
  it('is silent (zero value, zero confidence) when there are no relevant effects', () => {
    const result = computeEvidenceDeltaAlpha({ ticker: 'X', date: null, effects: [] });
    expect(result).toEqual({
      factor: 'evidence_delta',
      ticker: 'X',
      date: null,
      value: 0,
      confidence: 0,
    });
  });

  it('ignores supplier_capture effects — those belong to commercialization.ts, not this alpha', () => {
    const effects: ModelEffect[] = [
      {
        factor: 'supplier_capture',
        direction: 'positive',
        magnitude: 1,
        confidence: 1,
        rationale: 'x',
      },
    ];
    const result = computeEvidenceDeltaAlpha({ ticker: 'X', date: null, effects });
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('is positive for a positive manufacturing_capability effect, negative for a negative one', () => {
    const positive = computeEvidenceDeltaAlpha({
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
    expect(positive.value).toBeGreaterThan(0);

    const negative = computeEvidenceDeltaAlpha({
      ticker: 'X',
      date: null,
      effects: [
        {
          factor: 'hypothesis:h',
          direction: 'negative',
          magnitude: 1,
          confidence: 1,
          rationale: 'x',
        },
      ],
    });
    expect(negative.value).toBeLessThan(0);
  });

  it('a neutral effect contributes nothing to value but still counts toward confidence averaging', () => {
    const result = computeEvidenceDeltaAlpha({
      ticker: 'X',
      date: null,
      effects: [
        {
          factor: 'manufacturing_capability',
          direction: 'neutral',
          magnitude: 0,
          confidence: 1,
          rationale: 'x',
        },
      ],
    });
    expect(result.value).toBe(0);
    expect(result.confidence).toBeGreaterThan(0);
  });
});
