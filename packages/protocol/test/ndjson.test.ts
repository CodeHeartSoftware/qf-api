import { describe, expect, it } from 'vitest';
import { LineFramingError, NdjsonReader } from '../src/ndjson.js';

describe('NdjsonReader', () => {
  it('returns nothing until a newline arrives', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"a":1}')).toEqual([]);
    expect(reader.pending()).toBe('{"a":1}');
  });

  it('emits a complete line once terminated', () => {
    const reader = new NdjsonReader();
    reader.push('{"a":1}');
    expect(reader.push('\n')).toEqual(['{"a":1}']);
    expect(reader.pending()).toBe('');
  });

  it('emits multiple lines delivered in one chunk', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"a":1}\n{"b":2}\n{"c":3}\n')).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('buffers a line split across many small chunks', () => {
    const reader = new NdjsonReader();
    const json = '{"hello":"world"}';
    for (const char of json) {
      expect(reader.push(char)).toEqual([]);
    }
    expect(reader.push('\n')).toEqual([json]);
  });

  it('retains a trailing partial line after emitting complete ones', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"a":1}\npartial')).toEqual(['{"a":1}']);
    expect(reader.pending()).toBe('partial');
  });

  it('throws LineFramingError once a single line exceeds the configured limit', () => {
    const reader = new NdjsonReader(16);
    expect(() => reader.push('a'.repeat(17))).toThrow(LineFramingError);
  });

  it('throws once an unterminated buffered line exceeds the limit, even split across pushes', () => {
    const reader = new NdjsonReader(10);
    reader.push('12345');
    expect(() => reader.push('678901')).toThrow(LineFramingError);
  });

  it('does not throw for a line exactly at the limit', () => {
    const reader = new NdjsonReader(5);
    expect(() => reader.push('abcde\n')).not.toThrow();
  });
});
