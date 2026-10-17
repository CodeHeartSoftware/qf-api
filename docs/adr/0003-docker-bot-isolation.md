# ADR-0003: Docker Bot Isolation

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

Submitted bot code must be treated as untrusted. It must not read platform source, secrets, or
other bots; must not access the network by default; must not consume unbounded CPU/memory; and
must not run indefinitely. One bot's crash, timeout, or protocol violation must never crash the
tournament engine or affect other participants.

## Decision

### One container per participant per match

The engine process itself never runs inside a bot's container. For an N-participant match, the
orchestrator spawns N independent containers and holds N independent stdin/stdout pipes — bots
never talk to each other directly, not even over a network (which is disabled by default anyway).
Containers are controlled programmatically via `dockerode`, not by shelling out to the `docker`
CLI, so exit codes, `OOMKilled` status, and stream handling are typed rather than string-parsed.

### No bind mounts, ever

Bot images are fully self-contained at build time (built from `bots/<game-id>/<bot-id>/` in isolation — ADR-0001).
There is nothing on the host filesystem to mount into a running bot container. This is what
actually satisfies "no filesystem access to the repo or other bots" — it's a build-time property,
not a mount-time restriction to remember to apply correctly every time.

### Container hardening (baseline)

```
--network none
--memory=<N> --memory-swap=<N>      (swap fully disabled — no slow-degradation/timing side channel)
--cpus=<N>
--pids-limit=<N>
--read-only                          (root filesystem read-only)
--tmpfs /tmp:rw,noexec,nosuid,size=<N>   (small writable scratch only, non-executable)
--user <non-root uid:gid>
--cap-drop=ALL
--security-opt no-new-privileges
--security-opt seccomp=default
--ulimit nofile=<N>:<N>
--stop-timeout=<N>
```

Resource limits (CPU/memory/pids) are fairness/containment, not the timeout mechanism — a
throttled-but-not-OOM-killed bot could otherwise legitimately run "forever" within its CPU share.
Timeouts are enforced independently by the orchestrator (below).

**Flagged limitation, not silently accepted as sufficient long-term**: hardened plain Docker +
default seccomp is a fairness/accident boundary, adequate against buggy or lazy submissions, but
not a hardened defense against a determined container-escape attempt from arbitrary community
code. Evaluating gVisor (`--runtime=runsc`) or Firecracker as a stronger isolation boundary is
recorded here as a deliberate near-term follow-up, not an oversight — v1 ships hardened Docker
given delivery constraints.

### Lifecycle state machine

```
SPAWNING → AWAITING_READY → RUNNING (per round: AWAITING_ACTION*) → MATCH_END_SENT → GRACE_PERIOD → TERMINATED
```

1. **SPAWNING** — container created/started, stdio opened. A Docker API failure here terminates
   only that participant's state machine; siblings are unaffected.
2. Engine sends `init`, starts an init-timeout. → **AWAITING_READY**.
3. Valid `ready` with a compatible `protocolVersion` within the timeout → **RUNNING**. Otherwise:
   forfeit (`INIT_TIMEOUT` / `PROTOCOL_VIOLATION` / `PROTOCOL_VERSION_UNSUPPORTED`); kill this
   container only.
4. **RUNNING**, per round: send `observation`(s). Each `awaitingAction: true` participant gets an
   independent per-turn deadline timer. Outcomes: valid on-time action → recorded; on-time but
   malformed envelope → `PROTOCOL_VIOLATION`; on-time but game-illegal → `ILLEGAL_ACTION`; no
   action before deadline → `TURN_TIMEOUT`; unexpected exit — inspect `OOMKilled`: true →
   `RESOURCE_LIMIT_EXCEEDED`, false → `BOT_CRASHED`. An engine/Docker-API-side error is always
   `ENGINE_ERROR`, never attributed to a bot, and voids/pauses the match for investigation.
5. Normal completion: engine sends `result`(scope="match") + `match-end` → **MATCH_END_SENT**.
6. **GRACE_PERIOD**: close stdin, wait briefly for voluntary exit → SIGTERM → brief wait → SIGKILL.
   The game outcome is already decided before this step; an overrun teardown affects only
   logs/diagnostics, never the result.
7. **Match wall-clock safety net** (implemented — `packages/engine/src/match-runner.ts`'s
   `matchDeadlineMs`): an independent budget for the whole match (distinct from per-turn
   timeouts) that ends the match if exceeded, regardless of why. In practice this isn't only a
   Docker/runtime concern — it's just as often triggered by a legitimate game-state cycle where
   every participant responds correctly and on time, every round, and the game itself simply
   never satisfies `isTerminal()` (e.g. two bots whose strategies converge into an infinite draw
   loop; reproduced for real with `copycat-rps` vs a bot that always plays the same throw). Since
   no participant is at fault in that case, this ended up **not** matching either option this ADR
   originally anticipated (blame a straggler, or `ENGINE_ERROR`): it's its own outcome,
   `status: 'match-timeout'`, with every participant sharing the same rank as an explicit draw —
   so a hung match can never linger indefinitely, and isn't misreported as anyone's fault.

### Resource cleanup: three layers, not one

The state machine above assumes something eventually drives every lifecycle through
**GRACE_PERIOD** to **TERMINATED**. What guarantees that actually happens, given how many ways a
match can go wrong? Three independent layers, deliberately not just one:

1. **Every failure path inside one match run tears down every container it started**
   (`apps/cli/src/lib/match-execution.ts`'s `runSingleMatch`, `packages/runtime/src/
docker-bot-process.ts`'s `DockerBotProcess.start()`). A later participant's own container
   failing to start, a bot failing to initialize, or `runMatch()` itself throwing unexpectedly
   all still leave zero containers behind — a single `try`/`catch`/`finally` aborts every
   lifecycle tracked so far rather than special-casing each failure mode, and `start()` itself
   removes a container it just created if `attach()`/`start()` fails right after creation
   (otherwise nothing would ever call `container.wait()`, so `reportExit()` — the only thing that
   removes a container — would never fire).
2. **A process-level interrupt tears down whatever's currently running.** Closing the terminal,
   or an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` — without a handler, either kills the CLI
   process immediately and leaves every currently-running bot container behind, since nothing
   else would ever tell them to stop. `apps/cli/src/index.ts` registers one that calls
   `abortActiveMatch()` (a small module-level registry in `match-execution.ts` of whichever
   lifecycles the one in-flight match currently has open — `match run`/`tournament run` never run
   more than one match at a time) before exiting. A tournament interrupted this way leaves its
   persisted record (ADR-0009) in `status: 'running'` forever, honestly reflecting that it never
   reached a terminal state — the same as any other mid-tournament crash.
3. **`yarn thunderdome cleanup` is the explicit backstop** for whatever slips past both —
   most notably a `SIGKILL` (or a host crash) that never gives the process a chance to run any of
   its own cleanup code at all. It force-removes every container carrying the
   `thunderdome.matchId` label (`packages/runtime/src/cleanup.ts`), regardless of which process
   created it or whether that process is still alive — formalizing what had been a manual `docker
ps -a --filter label=thunderdome.matchId | xargs docker rm -f` habit during this project's own
   development.

Layers 1 and 2 make leaked containers rare in practice; layer 3 is what makes a leak recoverable
even when they aren't — nothing here assumes the in-process cleanup always gets to run.

### Failure taxonomy → forfeit reason

| Failure mode                                             | Reason                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Process crash / nonzero exit, not OOM                    | `BOT_CRASHED`                           |
| No action before per-turn deadline                       | `TURN_TIMEOUT`                          |
| Malformed JSON / envelope violation / unexpected message | `PROTOCOL_VIOLATION`                    |
| Structurally valid but game-illegal action               | `ILLEGAL_ACTION`                        |
| cgroup OOM kill / pids-limit hit                         | `RESOURCE_LIMIT_EXCEEDED`               |
| Engine/orchestrator bug, Docker API failure              | `ENGINE_ERROR` (never charged to a bot) |
| Bot sends `resign`                                       | `RESIGNED`                              |

This table is `ParticipantOutcome.forfeitReason` — a per-_bot_ fault. The whole-match wall-clock
cap (item 7 above) is deliberately not in it: nobody's forfeited, so it's a match-level
`status: 'match-timeout'`, not a `ForfeitReason`. `MATCH_TIMEOUT` remains defined in
`@thunderdome/protocol`'s `ForfeitReason` enum for a still-unbuilt, narrower future case (forcibly
terminating one specific bot's own lifecycle rather than ending the whole match) — it isn't
produced by this mechanism.

Every one of these terminates in a `ParticipantOutcome { participantId, outcome, forfeitReason? }`
recorded on the match — the structural mechanism guaranteeing that bad bot behavior forfeits that
bot, never crashes the engine or affects other participants.

## Consequences

- Every match produces an explicit, typed reason for every non-completion outcome — no silent
  "something went wrong."
- Resource limits are configuration (per game, per tournament), not hardcoded engine constants.
- A documented gap (container-escape hardening beyond seccomp) exists and is tracked, not hidden.
