import { describe, expect, it } from 'vitest';
import { parseResearchValue } from '../../src/common/values.js';

describe('ResearchValue', () => {
  it('accepts every primitive JSON type', () => {
    expect(parseResearchValue('a string').ok).toBe(true);
    expect(parseResearchValue(42).ok).toBe(true);
    expect(parseResearchValue(true).ok).toBe(true);
    expect(parseResearchValue(null).ok).toBe(true);
  });

  it('accepts nested arrays and objects', () => {
    const value = {
      name: 'ELMT',
      tags: ['tungsten', 'hts'],
      nested: { deeper: [1, 2, { ok: true }] },
    };
    expect(parseResearchValue(value)).toEqual({ ok: true, value });
  });

  it('rejects non-JSON values like undefined, functions, and symbols', () => {
    expect(parseResearchValue(undefined).ok).toBe(false);
    expect(parseResearchValue(() => 1).ok).toBe(false);
    expect(parseResearchValue(Symbol('x')).ok).toBe(false);
  });

  it('rejects an array containing a non-JSON value', () => {
    expect(parseResearchValue([1, 2, undefined]).ok).toBe(false);
  });
});
