import { describe, expect, it } from 'vitest';
import { roundHalfUp, toCents, toDollars } from '../src/money.js';

describe('toCents', () => {
  it('converts dollars to integer cents', () => {
    expect(toCents(10.5)).toBe(1050);
  });

  it('rounds away floating-point noise', () => {
    expect(toCents(19.99)).toBe(1999);
  });
});

describe('toDollars', () => {
  it('converts integer cents back to dollars', () => {
    expect(toDollars(1050)).toBe(10.5);
  });
});

describe('roundHalfUp', () => {
  it('rounds .5 up rather than to even', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-2);
  });
});
