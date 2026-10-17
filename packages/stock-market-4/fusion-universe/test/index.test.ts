import { describe, expect, it } from 'vitest';
import {
  findByEntityId,
  findByTicker,
  PORTFOLIO_ENTITY_IDS,
  TRACKED_SECURITIES,
  TRACKED_TICKERS,
} from '../src/index.js';

describe('TRACKED_SECURITIES', () => {
  it('has exactly 11 entries', () => {
    expect(TRACKED_SECURITIES.length).toBe(11);
  });

  it('has no duplicate tickers or entity ids', () => {
    expect(new Set(TRACKED_SECURITIES.map((s) => s.ticker)).size).toBe(11);
    expect(new Set(TRACKED_SECURITIES.map((s) => s.entityId)).size).toBe(11);
  });

  it('every entityId follows the "entity-<slug>" convention', () => {
    for (const security of TRACKED_SECURITIES) {
      expect(security.entityId).toMatch(/^entity-[a-z0-9-]+$/);
    }
  });

  it('usdRate is 1 for USD tickers and a real conversion factor otherwise', () => {
    for (const security of TRACKED_SECURITIES) {
      if (security.currency === 'USD') {
        expect(security.usdRate).toBe(1);
      } else {
        expect(security.usdRate).toBeGreaterThan(0);
        expect(security.usdRate).toBeLessThan(1);
      }
    }
  });

  it('PORTFOLIO_ENTITY_IDS and TRACKED_TICKERS derive from the same 11 entries', () => {
    expect(PORTFOLIO_ENTITY_IDS.size).toBe(11);
    expect(TRACKED_TICKERS.size).toBe(11);
  });

  it('findByTicker and findByEntityId round-trip for a known security', () => {
    const elmt = findByTicker('ELMT');
    expect(elmt?.entityId).toBe('entity-elmt');
    expect(findByEntityId('entity-elmt')).toEqual(elmt);
  });

  it('returns undefined for an unknown ticker or entity id', () => {
    expect(findByTicker('NOT-A-REAL-TICKER')).toBeUndefined();
    expect(findByEntityId('entity-not-a-real-entity')).toBeUndefined();
  });
});
