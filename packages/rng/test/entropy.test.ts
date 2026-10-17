import { describe, expect, it } from 'vitest';
import { deriveSeed, generateTournamentSeed, seedFromHex, seedToHex } from '../src/entropy.js';

describe('generateTournamentSeed', () => {
  it('returns 32 bytes', () => {
    expect(generateTournamentSeed().byteLength).toBe(32);
  });

  it('is different on every call', () => {
    const a = generateTournamentSeed();
    const b = generateTournamentSeed();
    expect(a.equals(b)).toBe(false);
  });
});

describe('deriveSeed', () => {
  const tournamentSeed = Buffer.from('a'.repeat(64), 'hex');

  it('is deterministic for the same inputs', () => {
    const a = deriveSeed(tournamentSeed, 'match', 'match-001');
    const b = deriveSeed(tournamentSeed, 'match', 'match-001');
    expect(a.equals(b)).toBe(true);
  });

  it('produces different output for different purposes (domain separation)', () => {
    const match = deriveSeed(tournamentSeed, 'match', 'match-001');
    const bot = deriveSeed(tournamentSeed, 'bot', 'match-001');
    expect(match.equals(bot)).toBe(false);
  });

  it('produces different output for different parts', () => {
    const a = deriveSeed(tournamentSeed, 'bot', 'match-001', 'p1');
    const b = deriveSeed(tournamentSeed, 'bot', 'match-001', 'p2');
    expect(a.equals(b)).toBe(false);
  });

  it('produces different output for a different tournament seed', () => {
    const otherTournamentSeed = Buffer.from('b'.repeat(64), 'hex');
    const a = deriveSeed(tournamentSeed, 'match', 'match-001');
    const b = deriveSeed(otherTournamentSeed, 'match', 'match-001');
    expect(a.equals(b)).toBe(false);
  });

  it('returns a 32-byte HMAC-SHA256 digest', () => {
    expect(deriveSeed(tournamentSeed, 'match', 'match-001').byteLength).toBe(32);
  });
});

describe('seedToHex / seedFromHex', () => {
  it('round-trips', () => {
    const seed = generateTournamentSeed();
    expect(seedFromHex(seedToHex(seed)).equals(seed)).toBe(true);
  });

  it('produces a lowercase hex string of the expected length', () => {
    const seed = Buffer.alloc(32, 0xab);
    expect(seedToHex(seed)).toBe('ab'.repeat(32));
  });
});
