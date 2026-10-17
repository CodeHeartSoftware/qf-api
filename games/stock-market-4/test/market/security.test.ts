import { describe, expect, it } from 'vitest';
import {
  parseSecurity,
  resolveMarketDataUniverse,
  resolveSecurityAsOf,
} from '../../src/market/security.js';
import type { Security } from '../../src/types.js';

function nvidia(overrides: Partial<Security> = {}): Security {
  return {
    id: 'security-nvda',
    assetType: 'equity',
    lifecycle: [
      { effectiveDate: '1999-01-22', state: 'trading', ticker: 'NVDA', name: 'NVIDIA Corporation' },
    ],
    ...overrides,
  };
}

describe('SecuritySchema (via parseSecurity)', () => {
  it('accepts a minimal valid security', () => {
    expect(parseSecurity(nvidia()).ok).toBe(true);
  });

  it('requires a non-empty lifecycle', () => {
    expect(parseSecurity(nvidia({ lifecycle: [] })).ok).toBe(false);
  });

  it('requires lifecycle to be sorted by strictly increasing effectiveDate', () => {
    const outOfOrder = nvidia({
      lifecycle: [
        {
          effectiveDate: '2020-01-01',
          state: 'trading',
          ticker: 'NVDA',
          name: 'NVIDIA Corporation',
        },
        { effectiveDate: '1999-01-22', state: 'ipo', ticker: 'NVDA', name: 'NVIDIA Corporation' },
      ],
    });
    expect(parseSecurity(outOfOrder).ok).toBe(false);

    const duplicateDate = nvidia({
      lifecycle: [
        {
          effectiveDate: '2020-01-01',
          state: 'trading',
          ticker: 'NVDA',
          name: 'NVIDIA Corporation',
        },
        {
          effectiveDate: '2020-01-01',
          state: 'delisted',
          ticker: 'NVDA',
          name: 'NVIDIA Corporation',
        },
      ],
    });
    expect(parseSecurity(duplicateDate).ok).toBe(false);
  });

  it('rejects an invalid assetType or lifecycle state', () => {
    expect(parseSecurity(nvidia({ assetType: 'option' as never })).ok).toBe(false);
    expect(
      parseSecurity(
        nvidia({
          lifecycle: [
            { effectiveDate: '2020-01-01', state: 'vaporized' as never, ticker: 'NVDA', name: 'x' },
          ],
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('resolveSecurityAsOf', () => {
  // A security whose ticker changed — models something like a corporate rename/ticker change
  // without creating a new security identity (spec §12).
  const renamed: Security = {
    id: 'security-example',
    assetType: 'equity',
    lifecycle: [
      { effectiveDate: '2020-01-01', state: 'ipo', ticker: 'OLDTICK', name: 'Old Name Inc.' },
      { effectiveDate: '2022-06-01', state: 'trading', ticker: 'NEWTICK', name: 'New Name Inc.' },
    ],
  };

  it('returns undefined before the security had any recorded lifecycle', () => {
    expect(resolveSecurityAsOf(renamed, '2019-12-31')).toBeUndefined();
  });

  it('returns the record in effect on its own effectiveDate', () => {
    expect(resolveSecurityAsOf(renamed, '2020-01-01')?.ticker).toBe('OLDTICK');
  });

  it('returns the most recent record without ever seeing a later one', () => {
    expect(resolveSecurityAsOf(renamed, '2022-05-31')?.ticker).toBe('OLDTICK');
    expect(resolveSecurityAsOf(renamed, '2022-06-01')?.ticker).toBe('NEWTICK');
    expect(resolveSecurityAsOf(renamed, '2030-01-01')?.ticker).toBe('NEWTICK');
  });
});

describe('resolveMarketDataUniverse', () => {
  const securities: Security[] = [
    nvidia(),
    {
      id: 'security-amd',
      assetType: 'equity',
      lifecycle: [
        {
          effectiveDate: '1979-01-01',
          state: 'trading',
          ticker: 'AMD',
          name: 'Advanced Micro Devices',
        },
      ],
    },
  ];

  it('resolves every declared ticker to its stable security id', () => {
    const result = resolveMarketDataUniverse(['NVDA', 'AMD'], securities, '2026-01-01');
    expect(result).toEqual({ ok: true, value: ['security-nvda', 'security-amd'] });
  });

  it('fails closed on an unknown ticker rather than silently dropping it', () => {
    const result = resolveMarketDataUniverse(['NVDA', 'FAKE'], securities, '2026-01-01');
    expect(result.ok).toBe(false);
  });

  it('fails closed on a ticker not yet knowable as of the given date', () => {
    const result = resolveMarketDataUniverse(['NVDA'], securities, '1990-01-01');
    expect(result.ok).toBe(false);
  });

  it('fails closed on an ambiguous ticker resolving to more than one security', () => {
    const collision: Security[] = [nvidia(), { ...nvidia(), id: 'security-nvda-duplicate' }];
    const result = resolveMarketDataUniverse(['NVDA'], collision, '2026-01-01');
    expect(result.ok).toBe(false);
  });
});
