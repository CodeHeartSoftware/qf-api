import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  isSupportedProtocolVersion,
  parseProtocolVersion,
} from '../src/version.js';

describe('parseProtocolVersion', () => {
  it('parses a well-formed MAJOR.MINOR string', () => {
    expect(parseProtocolVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseProtocolVersion('1.7')).toEqual({ major: 1, minor: 7 });
  });

  it('rejects malformed version strings', () => {
    expect(parseProtocolVersion('1')).toBeUndefined();
    expect(parseProtocolVersion('1.0.0')).toBeUndefined();
    expect(parseProtocolVersion('v1.0')).toBeUndefined();
    expect(parseProtocolVersion('')).toBeUndefined();
  });
});

describe('isSupportedProtocolVersion', () => {
  it('accepts the current version', () => {
    expect(isSupportedProtocolVersion(CURRENT_PROTOCOL_VERSION)).toBe(true);
  });

  it('accepts a higher minor within a supported major (additive-only forward compatibility)', () => {
    expect(isSupportedProtocolVersion('1.99')).toBe(true);
  });

  it('rejects an unsupported major version', () => {
    expect(isSupportedProtocolVersion('2.0')).toBe(false);
  });

  it('rejects a malformed version string', () => {
    expect(isSupportedProtocolVersion('not-a-version')).toBe(false);
  });
});
