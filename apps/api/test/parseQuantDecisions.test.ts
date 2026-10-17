import { describe, expect, it } from 'vitest';
import { parseQuantDecisions } from '../src/lib/parseQuantDecisions.js';

describe('parseQuantDecisions', () => {
  it('extracts every QUANT_DECISION_JSON line, ignoring everything else', () => {
    const output = [
      'Resuming forward match "x" (5 round(s) played so far).',
      '[quant-v0] 2026-09-19 ELMT',
      '  action: BUY',
      'QUANT_DECISION_JSON:{"security":"ELMT","action":"BUY"}',
      'QUANT_DECISION_JSON:{"security":"AMSC","action":"HOLD"}',
      'Played 1 new round(s).',
    ].join('\n');

    const decisions = parseQuantDecisions(output);
    expect(decisions).toEqual([
      { security: 'ELMT', action: 'BUY' },
      { security: 'AMSC', action: 'HOLD' },
    ]);
  });

  it('returns an empty array when no bot emits the marker', () => {
    const output = 'Resuming forward match "x".\nPlayed 0 new round(s).';
    expect(parseQuantDecisions(output)).toEqual([]);
  });

  it('skips a malformed JSON line rather than throwing', () => {
    const output = [
      'QUANT_DECISION_JSON:{"security":"ELMT","action":"BUY"}',
      'QUANT_DECISION_JSON:{not valid json',
    ].join('\n');
    expect(parseQuantDecisions(output)).toEqual([{ security: 'ELMT', action: 'BUY' }]);
  });
});
