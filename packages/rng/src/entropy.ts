import { createHmac, randomBytes } from 'node:crypto';

/**
 * The single entropy boundary (docs/adr/0004-deterministic-randomness.md): this is the ONLY
 * function in the platform allowed to call into real system randomness. A tournament calls it
 * exactly once, at creation, and persists the result immutably. Everything else — the engine's
 * per-match Rng, each participant's own rngSeed — is deterministically derived from it via
 * `deriveSeed`, never generated independently.
 */
export function generateTournamentSeed(): Buffer {
  return randomBytes(32);
}

/**
 * `deriveSeed(purpose, ...parts) = HMAC-SHA256(key=tournamentSeed, msg=[purpose,...parts])`.
 * Purpose-tag domain separation means a correlation or bug in one derivation stream (e.g.
 * `"match"`) can't leak into another (e.g. `"bot"`) even though both trace back to the same
 * root seed.
 */
export function deriveSeed(tournamentSeed: Buffer, purpose: string, ...parts: string[]): Buffer {
  const message = [purpose, ...parts].join(':');
  return createHmac('sha256', tournamentSeed).update(message).digest();
}

/** Wire-format encoding for a seed (e.g. `init.payload.rngSeed` — a required, non-empty string). */
export function seedToHex(seed: Buffer): string {
  return seed.toString('hex');
}

export function seedFromHex(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}
