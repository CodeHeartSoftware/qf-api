/**
 * The seeded PRNG bots and games consume (docs/adr/0004-deterministic-randomness.md). Never
 * shared across processes/languages bit-for-bit — determinism only requires "same code + same
 * seed => same output within one process," which any PRNG trivially satisfies.
 */
export interface Rng {
  /** A float in [0, 1). */
  nextFloat(): number;
  /** An integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** A uniformly-chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/**
 * sfc32 ("Simple Fast Counter"): a small, fast, public-domain PRNG well-suited to being seeded
 * directly from raw bits (unlike an LCG, it has no simple short cycle for adversarial seeds).
 * Not cryptographically secure — nothing here needs to be; the seed itself is the secret/entropy
 * boundary (entropy.ts), not the generator's internal state.
 */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  let stateA = a;
  let stateB = b;
  let stateC = c;
  let stateD = d;
  return () => {
    stateA |= 0;
    stateB |= 0;
    stateC |= 0;
    stateD |= 0;
    const t = (((stateA + stateB) | 0) + stateD) | 0;
    stateD = (stateD + 1) | 0;
    stateA = stateB ^ (stateB >>> 9);
    stateB = (stateC + (stateC << 3)) | 0;
    stateC = (stateC << 21) | (stateC >>> 11);
    stateC = (stateC + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Seeds a fresh `Rng` from at least 16 bytes (e.g. the output of `deriveSeed`). */
export function createRng(seed: Buffer): Rng {
  if (seed.byteLength < 16) {
    throw new Error('createRng requires a seed of at least 16 bytes');
  }

  const next = sfc32(
    seed.readUInt32LE(0),
    seed.readUInt32LE(4),
    seed.readUInt32LE(8),
    seed.readUInt32LE(12),
  );

  // Discard the first several outputs so early draws aren't a thin function of the seed's own
  // raw bit pattern — a common practice for generators seeded directly from external bits.
  for (let i = 0; i < 12; i += 1) {
    next();
  }

  return {
    nextFloat(): number {
      return next();
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('nextInt requires a positive integer maxExclusive');
      }
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('pick requires a non-empty array');
      }
      const index = Math.floor(next() * items.length);
      // index is mathematically within [0, items.length) given the non-empty check above.
      return items[index] as T;
    },
  };
}
