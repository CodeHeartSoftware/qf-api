# ADR-0004: Deterministic Randomness

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

Given identical bot code, game version, tournament configuration, roster, and tournament seed, a
match must be exactly reproducible (target: `yarn thunderdome replay <match-id>`). An early
strawman suggested bots receive a shared deterministic `Rng` object through the protocol/SDK. This
ADR records why that idea was rejected and what replaces it.

## Decision

### Reject a shared, cross-language-identical RNG

Requiring every bot language (TypeScript, Java, and future Python/Rust/Go) to implement one
specific PRNG algorithm bit-for-bit identically, forever, is the wrong contract: it's a permanent
tax on every new language SDK, it's only verifiable by cross-language golden vectors, and it buys
nothing — bots don't need to compute the _same_ randomness as the engine or each other; they only
need either (a) the engine's game-affecting randomness delivered as plain data, or (b) their own
private, reproducible internal randomness.

### Ownership split

1. **Randomness that affects shared game outcomes is owned exclusively by the engine/game.** It is
   never exposed to bots as an RNG handle — only its _result_ is exposed, as ordinary observation
   data (e.g. `"diceRoll": 4`). Bots react to it; they never compute it. This also closes a
   fairness hole: a bot can't probe or predict a shared RNG stream it never has access to.
2. **A bot's own internal strategy randomness is the bot's private business.** The engine hands
   each bot a derived seed once, in `init.payload.rngSeed`. Each language's bot-SDK seeds whatever
   local PRNG it likes with it. Determinism here only requires "same code + same seed ⇒ same
   output, within one process" — a property every language's PRNG already has trivially, with zero
   cross-language agreement required.

### Seed derivation

```
tournamentSeed = crypto.randomBytes(32)   // the ONLY place true entropy enters the system;
                                           // generated once at tournament creation, persisted immutably

deriveSeed(purpose, ...parts) = HMAC-SHA256(key = tournamentSeed, msg = [purpose, ...parts].join(":"))

matchSeed       = deriveSeed("match", matchId)                 // engine-internal only; never persisted
                                                                 // or transmitted — recomputed from
                                                                 // tournamentSeed + matchId at replay time
participantSeed = deriveSeed("bot", matchId, participantId)   // sent ONLY to that one participant,
                                                                 // as init.payload.rngSeed
```

`matchId` is a stable, deterministic string assigned by the tournament format during
schedule/bracket generation (e.g. derived from tournament id + round + pairing index), not random
per attempt. Purpose-tag domain separation (`"match"` vs `"bot"`, and finer game-internal tags like
`"shuffle"`) means a correlation or bug in one derivation stream can't leak into another. Each bot
sees only its own `rngSeed` — never another participant's, never the engine's `matchSeed` — a
fairness property as much as a determinism one.

### Real concurrency vs. determinism

Bot containers respond in real, non-deterministic wall-clock time. For simultaneous-action
rounds, the resolution of collected actions must never depend on _arrival order_ — only seeded
engine RNG or a fixed canonical order (e.g. sorted `participantId`) may break ties or decide
ordering effects. This is stated as a hard rule for every `GameDefinition.resolve()` implementation
and enforced in code review / game-abstraction tests, not just documented.

### Dependency on immutable bot images

Full end-to-end reproducibility (`replay <match-id>` producing the same result from the same
bots) requires bot container images to be referenced by immutable digest, not a mutable tag, at
match-run time. This is a registry/build concern (ADR-0001/runtime), flagged here as load-bearing
for this ADR's guarantee, not solved by the RNG design itself.

### Reproducibility caveat

Replaying from a **persisted match record** (the actual action/event log) is fully deterministic.
Re-running the same bots live again is _not_ guaranteed to reproduce identical timeouts or
forfeits, since those depend on real wall-clock bot behavior at run time, not on the seed alone.
This must be stated plainly in user-facing docs rather than implied away.

> **Implementation note (Phase 5):** `packages/rng` uses sfc32 ("Simple Fast Counter") as the
> concrete `Rng` implementation seeded from `deriveSeed`'s output — chosen for being small,
> fast, and safe to seed directly from raw external bits (unlike an LCG, it has no short cycle
> for adversarial seeds). It is not cryptographically secure, which is fine: the seed itself is
> the secret/entropy boundary, not the generator's internal state. `entropy.ts` is the one
> module allowed to touch `crypto.randomBytes`/`Math.random()`, and this is now an enforced
> ESLint rule (`no-restricted-properties`/`no-restricted-imports` in `eslint.config.js`), not
> just a documented convention.

## Consequences

- New bot-language SDKs never need to agree on a PRNG algorithm with anything else — only with
  themselves, seed-for-seed.
- `yarn thunderdome replay <match-id>` reconstructs `matchSeed` and every `participantSeed` purely
  from `tournamentSeed` + `matchId`, with zero additional per-match RNG state to store.
- Any place a game needs a random game-affecting outcome, it must go through the engine-provided
  `Rng` inside `resolve()`/`initialize()` and be delivered to bots as observation data — never as a
  handed-off RNG object.
