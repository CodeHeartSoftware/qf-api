import { describe, expect, it } from 'vitest';
import { isValidResearchId, parseResearchId } from '../../src/common/ids.js';

describe('ResearchId', () => {
  it('accepts a non-empty string', () => {
    const result = parseResearchId('entity-arc');
    expect(result).toEqual({ ok: true, value: 'entity-arc' });
  });

  it('rejects an empty string', () => {
    const result = parseResearchId('');
    expect(result.ok).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    const result = parseResearchId('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(parseResearchId(123).ok).toBe(false);
    expect(parseResearchId(null).ok).toBe(false);
    expect(parseResearchId(undefined).ok).toBe(false);
  });

  it('does not silently trim a valid id with surrounding whitespace', () => {
    const result = parseResearchId(' entity-arc ');
    expect(result).toEqual({ ok: true, value: ' entity-arc ' });
  });

  it('isValidResearchId narrows unknown to ResearchId', () => {
    const raw: unknown = 'entity-arc';
    expect(isValidResearchId(raw)).toBe(true);
    expect(isValidResearchId('')).toBe(false);
  });
});
