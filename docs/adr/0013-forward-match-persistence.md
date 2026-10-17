# ADR-0013: Forward Match Persistence and Resume

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

Phase 2 (ADR-0011) added `config.gameType: 'FORWARD_SHADOW'` to `stock-market-4`, but left it
explicitly "a bounded, single-process, non-resumable run" — a match plays whatever data currently
exists, once, then exits; a later invocation against a grown dataset starts an entirely new match
from round 0. Phase 3's job is to remove that limitation: the same forward match should be able to
run for weeks or months, one process invocation at a time, resuming exactly where the last one left
off, with crash/restart equivalence as a first-class correctness requirement.

Nothing in `@thunderdome/engine` supports this today. `runMatch` (`packages/engine/src/
match-runner.ts`) always calls `game.initialize()` itself, always loops until `isTerminal`/
forfeit/timeout, and never exposes the final `TState` to its caller — there is no way to get "the
state as of round N" back out of it, and no way to hand it an existing state to continue from.
`StockMarket4State.marketData` is also a live, non-serializable SQLite handle (ADR-0010).

A subtler problem surfaced during design: `stock-market-4`'s `isTerminal(state)` is ambiguous for
a `FORWARD_SHADOW` match. It becomes true BOTH when the dataset has genuinely caught up through
`config.endDate` (permanently done) AND merely when currently-known data has run out for now
(temporary — more will arrive later). Treating "isTerminal tripped" as "this forward match is
over" would permanently close a match the first time it ran out of today's data, breaking the
whole "same instance runs for weeks" requirement. This ADR's design has to resolve that ambiguity
explicitly, not just add persistence around the existing (ambiguous) signal.

## Decision

Five pieces, together:

**1. `games/stock-market-4/src/game.ts` gains three new exported functions** — not part of
`GameDefinition` (that contract has no serialize/resume hook, and isn't gaining one for a single
game's sake):

- `serializeForwardState(state)` — flattens the resumable parts of `StockMarket4State` into a
  plain, `JSON.stringify`-safe snapshot (the four top-level `Map`s, plus the nested
  `PortfolioAccount.positions` Map, converted to entry arrays). `marketData` (the live handle) is
  omitted entirely; `config`/`participantIds` are the caller's own top-level fields, not
  duplicated inside the snapshot.
- `resumeForwardState({ config, participantIds, snapshot })` — the resume-time counterpart to
  `initialize()`, used INSTEAD of it. Rebuilds `marketData` fresh via the already-existing
  `buildMarketDataProvider(config)` and RECOMPUTES `forwardShadowCutoffDate` fresh via the
  already-existing `forwardShadowCutoffDateFor` — never trusts a persisted cutoff, since the
  dataset may have grown (ADR-0012) since the snapshot was taken. Validates the untrusted
  `snapshot` argument against a real Zod schema (`StockMarket4ForwardSnapshotSchema`, `types.ts`)
  — the actual trust boundary for its shape, since `@thunderdome/forward-match-store` (below)
  keeps it fully opaque on its own end.
- `isForwardMatchFullyResolved(state)` — true only once `forwardShadowCutoffDate >=
config.endDate`; always true for `'HISTORICAL'`/`'SYNTHETIC'`. This is the fix for the
  `isTerminal` ambiguity above: a caller managing a persisted match's lifecycle uses THIS, never
  `isTerminal`, to decide whether to mark it `'completed'` or leave it `'active'` for a future
  resume.

`effectiveTradingCalendar`/`isTerminal`/`resolve`/`getObservation`/`getResult` need zero changes —
none of them care how `state` was constructed, only its field values, which `resumeForwardState`
faithfully reconstructs. Crash/restart equivalence is proven entirely at this level
(`test/forwardResumability.test.ts`): a match "restarted" via a REAL `JSON.stringify`/`JSON.parse`
round-trip through these two functions — once per round, in the worst case — produces
byte-identical bot observations and final results to one that never stopped, including the case
where the dataset genuinely grows between "restarts." No OS-level process spawn is needed for this
proof: `StockMarket4State` is confirmed to be the complete source of truth, with no module-level
cache a real process boundary would lose that a JSON round-trip doesn't already equally lose.

**2. `packages/engine/src/match-runner.ts` is refactored, not extended.** The per-round loop body
is extracted into a private `playOneRound` helper, and a new exported `runAvailableRounds` is
built on top of it — it takes an ALREADY-CONSTRUCTED `state` (skips `initialize()`) and exposes
`finalState` in its return value, which `MatchOutcome` deliberately never does. `runMatch` becomes
a thin wrapper: `initialize()`, then delegate its whole loop to `runAvailableRounds`, then map the
result back onto `MatchOutcome`. There is exactly one real loop implementation, not two — proven
by `packages/engine/test/match-runner.test.ts`'s full pre-existing suite passing unchanged.
`runAvailableRounds`'s own `onRoundResolved` hook is awaited (unlike `runMatch`'s fire-and-forget,
events-only version) and carries `state`, because a resumable caller's persistence write must land
before either the next round starts or the process is allowed to exit — throwing from it aborts
the loop rather than silently continuing to play rounds whose results might never be persisted.
`GameDefinition`'s actual interface is untouched.

**3. New package `@thunderdome/forward-match-store`**, modeled on `@thunderdome/tournament-store`
(ADR-0009)'s file-layout/`Result`/Zod/list conventions, with two deliberate deviations, both
because a forward match's correctness bar is explicitly higher than a tournament's own inspection
trail:

- **Atomic writes** (temp file in the SAME directory, then `rename` — same-filesystem rename is
  atomic on POSIX) instead of `tournament-store`'s plain `writeFile`. A crash mid-write must
  never leave a half-written, unparseable record behind.
- **A three-way load outcome** (`found`/`not-found`/`corrupt`), not `tournament-store`'s
  two-way `Result` (which conflates "missing" and "corrupt"). `match forward run`'s
  create-or-resume branch genuinely needs to tell these apart: "not found" means create a
  fresh match; "corrupt" must be a hard failure, never silently treated as "not found" (which
  would quietly create a brand-new match under the same id, discarding whatever trading
  history the corrupted file held).

`ForwardMatchRecord.config`/`.snapshot` are BOTH kept fully opaque (`unknown`) to this package
— it has no dependency on `@thunderdome/engine` and never inspects what it's persisting beyond
its own bookkeeping fields (`matchId`, `status`, `roundsPlayed`, timestamps). The game owns the
`snapshot` shape entirely. A `matchSeed` (hex-encoded, generated once at creation) is also
persisted and reused verbatim on every resume — a resumed bot's derived `rngSeed` must never
change across a resume.

**4. New CLI: `match forward run|list|inspect <matchId>`**, mirroring the existing `tournament
run/list/inspect` nested-dispatch pattern one level deeper. `run` is idempotent create-or-resume,
keyed by a REQUIRED, operator-chosen `matchId` (never auto-generated) — this is what satisfies the
roadmap's "discover an existing forward game and resume it, rather than creating one accidentally."
On resume, the STORED config is trusted (re-validated through the game's current `parseConfig`; a
`--config` flag on a resume invocation is ignored with a warning rather than silently overriding
history). Progress is persisted after EVERY round resolved, not once per CLI invocation — so a
crash mid-invocation loses at most the one round genuinely in flight.

Building this required extracting `apps/cli/src/lib/match-execution.ts`'s container-startup loop
(shared by `runSingleMatch` and `runHumanMatch`) into a reusable `startBotLifecycles` function, so
`match forward run` can start real Docker bot containers the same way `match run` does rather than
reimplementing bot execution.

**5. Wire protocol gains a third `MatchEndPayloadSchema.reason`: `'suspended'`** — additive,
alongside the existing `'completed'`/`'aborted'` — for the case where a `match forward run`
invocation ends because it's simply out of currently-available data, not because anything went
wrong or the match is actually over. `bot-sdk-js`'s `runBot()` exits cleanly on any `match-end`
regardless of `reason`, so this is purely a "what does this signal honestly mean" change, not a
behavior change for any bot.

## Consequences

- All pre-existing tests across every touched package pass unchanged (`packages/engine`:
  25/25 including the new `runAvailableRounds` suite; `packages/stock-market-4/market-data`: unaffected by this
  ADR, see ADR-0012; `games/stock-market-4`: 229/229 including the new
  `forwardResumability.test.ts`; `apps/cli`: 73/73 including the new `matchForward.test.ts` and
  real-Docker integration coverage; `packages/protocol`: unaffected save for the additive
  `'suspended'` value and its own new test).
- **This relies entirely on `stock-market-4` never reading its own `rng` argument** (confirmed by
  its existing determinism/acceptance tests). `@thunderdome/engine`'s `Rng` is a stateful,
  non-serializable closure shared for a match's whole lifetime — NOT resume-safe in general (no
  way to serialize/restore its internal counter across a process restart). This ADR does not fix
  that general engine gap. A future non-deterministic game attempting this same resumable pattern
  would need to solve RNG resume-safety itself first (e.g. deriving a fresh `Rng` per round from
  `(matchSeed, matchId, roundNumber)` instead of reusing one shared object) — flagged here as a
  landmine, not solved here.
- No generic `ResumableGameDefinition` engine interface was added. `match forward run` duck-types
  the three new `stock-market-4` exports off the loaded game module, the same way
  `lib/match-execution.ts` already duck-types a `GameDefinition` itself — premature to generalize
  an interface shape with only one game using it.
- Does not implement the Paper-vs-Shadow execution-mode distinction the broader roadmap describes
  (real fill into a virtual portfolio vs. decision-only tracking) — Phase 3 only makes the
  EXISTING, always-fills-a-portfolio execution mode resumable. That distinction, when it's built,
  is Phase 8's concern, layered on top of what this ADR provides.
- Does not build a decision audit trail (Phase 4), baseline bots (Phase 5), or any live external
  market-data ingestion pipeline (ADR-0012's own consequences already cover that boundary).
- `.thunderdome/forward-matches/*.json` grows unboundedly, same accepted trade-off ADR-0009 already
  made for `.thunderdome/tournaments/`.
