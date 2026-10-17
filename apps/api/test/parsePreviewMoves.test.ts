import { describe, expect, it } from 'vitest';
import { parsePreviewMoves } from '../src/lib/parsePreviewMoves.js';

describe('parsePreviewMoves', () => {
  it('extracts every PREVIEW_MOVE_JSON line, ignoring everything else', () => {
    const output = [
      'quant-v0:',
      '  OPTX: BUY 2,271',
      'PREVIEW_MOVE_JSON:{"participantId":"quant-v0","ticker":"OPTX","side":"BUY","quantity":2271,"changed":false}',
      '  ELMT: SELL 480',
      'PREVIEW_MOVE_JSON:{"participantId":"quant-v0","ticker":"ELMT","side":"SELL","quantity":480,"changed":true}',
    ].join('\n');

    expect(parsePreviewMoves(output)).toEqual([
      { participantId: 'quant-v0', ticker: 'OPTX', side: 'BUY', quantity: 2271, changed: false },
      { participantId: 'quant-v0', ticker: 'ELMT', side: 'SELL', quantity: 480, changed: true },
    ]);
  });

  it('omits quantity when the line has none (a HOLD or an unrecognized order shape)', () => {
    const output =
      'PREVIEW_MOVE_JSON:{"participantId":"quant-v0","ticker":"AMSC","side":"HOLD","changed":false}';
    expect(parsePreviewMoves(output)).toEqual([
      { participantId: 'quant-v0', ticker: 'AMSC', side: 'HOLD', changed: false },
    ]);
  });

  it('returns an empty array when no move marker is present', () => {
    expect(parsePreviewMoves('No trades — held every position.')).toEqual([]);
  });

  it('skips a malformed JSON line rather than throwing', () => {
    const output = [
      'PREVIEW_MOVE_JSON:{"participantId":"quant-v0","ticker":"OPTX","side":"BUY","quantity":1,"changed":false}',
      'PREVIEW_MOVE_JSON:{not valid json',
    ].join('\n');
    expect(parsePreviewMoves(output)).toEqual([
      { participantId: 'quant-v0', ticker: 'OPTX', side: 'BUY', quantity: 1, changed: false },
    ]);
  });

  it('skips a line whose JSON is well-formed but missing required fields', () => {
    const output = 'PREVIEW_MOVE_JSON:{"participantId":"quant-v0","ticker":"OPTX"}';
    expect(parsePreviewMoves(output)).toEqual([]);
  });
});
