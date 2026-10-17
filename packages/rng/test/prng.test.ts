import { describe, expect, it } from 'vitest';
import { createRng } from '../src/prng.js';

function seed(byte: number): Buffer {
  return Buffer.alloc(16, byte);
}

describe('createRng', () => {
  it('requires at least 16 bytes of seed', () => {
    expect(() => createRng(Buffer.alloc(8))).toThrow();
  });

  it('is fully deterministic for the same seed', () => {
    const rngA = createRng(seed(7));
    const rngB = createRng(seed(7));
    const drawsA = Array.from({ length: 50 }, () => rngA.nextFloat());
    const drawsB = Array.from({ length: 50 }, () => rngB.nextFloat());
    expect(drawsA).toEqual(drawsB);
  });

  it('produces a different sequence for a different seed', () => {
    const rngA = createRng(seed(1));
    const rngB = createRng(seed(2));
    const drawsA = Array.from({ length: 10 }, () => rngA.nextFloat());
    const drawsB = Array.from({ length: 10 }, () => rngB.nextFloat());
    expect(drawsA).not.toEqual(drawsB);
  });

  it('nextFloat stays within [0, 1)', () => {
    const rng = createRng(seed(3));
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt stays within [0, maxExclusive) and covers the range over many draws', () => {
    const rng = createRng(seed(4));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('nextInt rejects a non-positive or non-integer maxExclusive', () => {
    const rng = createRng(seed(5));
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(-1)).toThrow();
    expect(() => rng.nextInt(1.5)).toThrow();
  });

  it('pick always returns an element that was actually in the array', () => {
    const rng = createRng(seed(6));
    const items = ['rock', 'paper', 'scissors'];
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('pick rejects an empty array', () => {
    const rng = createRng(seed(9));
    expect(() => rng.pick([])).toThrow();
  });
});
