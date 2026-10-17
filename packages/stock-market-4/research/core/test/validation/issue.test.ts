import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatValidationIssues, fromZodSafeParse } from '../../src/validation/issue.js';

describe('fromZodSafeParse', () => {
  it('passes through a successful parse as ok:true', () => {
    const schema = z.object({ name: z.string() });
    const result = fromZodSafeParse(schema.safeParse({ name: 'ARC' }));
    expect(result).toEqual({ ok: true, value: { name: 'ARC' } });
  });

  it('maps zod issues to structured ValidationIssue entries with dot-joined paths', () => {
    const schema = z.object({ nested: z.object({ value: z.number() }) });
    const result = fromZodSafeParse(schema.safeParse({ nested: { value: 'not-a-number' } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('nested.value');
    expect(result.issues[0]?.code).toBe('invalid_type');
    expect(result.issues[0]?.message.length).toBeGreaterThan(0);
  });
});

describe('formatValidationIssues', () => {
  it('joins issues with their path prefixed', () => {
    const formatted = formatValidationIssues([
      { path: 'a.b', code: 'x', message: 'is bad' },
      { path: '', code: 'y', message: 'also bad' },
    ]);
    expect(formatted).toBe('a.b: is bad; also bad');
  });

  it('returns an empty string for no issues', () => {
    expect(formatValidationIssues([])).toBe('');
  });
});
