import { describe, expect, it } from 'vitest';
import { ALL_ALPHA_FACTORS, activeFactorsForMode, applyAblation } from '../src/ablation.js';
import type { AlphaSignal } from '../src/alpha/types.js';

function signals(): AlphaSignal[] {
  return ALL_ALPHA_FACTORS.map((factor) => ({
    factor,
    ticker: 'X',
    date: null,
    value: 1,
    confidence: 1,
  }));
}

describe('activeFactorsForMode', () => {
  it('full keeps every factor', () => {
    expect(activeFactorsForMode('full')).toEqual(ALL_ALPHA_FACTORS);
  });

  it('research_only drops momentum only', () => {
    expect(activeFactorsForMode('research_only')).not.toContain('momentum');
    expect(activeFactorsForMode('research_only')).toContain('evidence_delta');
  });

  it('price_only and null_research both keep only momentum', () => {
    expect(activeFactorsForMode('price_only')).toEqual(['momentum']);
    expect(activeFactorsForMode('null_research')).toEqual(['momentum']);
  });
});

describe('applyAblation', () => {
  it('full is a no-op', () => {
    expect(applyAblation(signals(), 'full')).toHaveLength(ALL_ALPHA_FACTORS.length);
  });

  it('research_only removes momentum from the signal list entirely', () => {
    const result = applyAblation(signals(), 'research_only');
    expect(result.some((s) => s.factor === 'momentum')).toBe(false);
    expect(result).toHaveLength(ALL_ALPHA_FACTORS.length - 1);
  });

  it('price_only keeps only momentum', () => {
    const result = applyAblation(signals(), 'price_only');
    expect(result).toHaveLength(1);
    expect(result[0]?.factor).toBe('momentum');
  });

  it('null_research is currently equivalent to price_only (same mechanism, different experimental framing)', () => {
    expect(applyAblation(signals(), 'null_research')).toEqual(
      applyAblation(signals(), 'price_only'),
    );
  });
});
