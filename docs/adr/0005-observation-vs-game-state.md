# ADR-0005: Observation vs. Game State

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

A game may internally hold information a bot must never see (an undealt deck, another
participant's private hand). The engine must never construct, infer, or redact a bot's view of the
game itself — doing so would require the engine to understand game-specific hidden-information
rules, which directly violates game-engine independence.

## Decision

`GameDefinition.getObservation(state: TState, participantId: string): TObservation` is the **sole**
authority for what a given participant may see. The engine calls it once per participant per
round and forwards the result to that participant verbatim, as the `observation` message payload
(ADR-0002). The engine never reads, diffs, or interprets `TState` itself, and never attempts to
compute a "redacted" view on the game's behalf.

This holds uniformly across every information regime:

- **No hidden information** (chess): every participant's observation can simply be the same full
  board — nothing engine-side changes; `getObservation` still runs per participant, it just
  happens to return the same value for everyone.
- **Per-participant hidden information** (a hidden-info card game): each participant's private
  hand, others' hand _sizes_ only, and shared public state are assembled entirely inside the
  game's own `getObservation` implementation.
- **Staged reveal** (information becomes public partway through a game): modeled as ordinary
  `TState` (e.g. a `phase` field) that the game's own `getObservation` consults — the engine has no
  concept of "hidden vs. revealed" at all.

> **Status update:** Connect Four (`games/connect-four`) is now the real "no hidden information"
> implementation this ADR sketched using chess. Its `getObservation` doesn't quite return the
> literal same value to both participants, though — it relabels the board to each participant's
> own `'you'`/`'opponent'` perspective (matching Rock-Paper-Scissors' own convention) rather than
> raw participant ids. Nothing hidden either way: a participant could reconstruct the other's
> exact view from their own. This is a per-game presentation choice, not a departure from the
> decision above — `getObservation` remains the sole authority regardless of what it returns.

`resolve()` similarly returns opaque, game-defined `RoundEvent[]` for replay/spectator logging
rather than the engine diffing `TState` to infer "what happened" — the same non-inspection
principle applied to history, not just current-round observations.

## Consequences

- Adding a new game with a novel information-hiding shape never requires an engine change — only a
  new `getObservation` implementation.
- Match records that persist full internal `TState` for debugging/replay must be treated as
  maintainer-only/private artifacts, distinct from anything a bot author's tooling can fetch — the
  public record is composed from observations/actions/results already, which are the only things
  ever validated as "safe for a participant to see."
- The engine's own code review checklist for a new `GameDefinition` includes verifying it never
  leaks `TState` fields through `getObservation` that the game's own design says should stay
  hidden — this is a game-author responsibility the platform can't statically verify, and is
  called out explicitly in the game-author guide.
