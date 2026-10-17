# ADR-0002: Universal Bot Protocol

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

The engine must communicate with bot processes written in any language (initially TypeScript,
JavaScript, Java) over a language-neutral, versioned, schema-validated JSON protocol, supporting
both sequential-turn and simultaneous-action games with 1..N participants. Malformed or invalid
bot messages must cause a controlled forfeit, never an engine crash.

## Decision

### Transport: NDJSON over stdin/stdout

Each message is one JSON value followed by `\n`, written to the bot container's stdin/stdout.
Alternatives considered and rejected:

- **gRPC/protobuf** — requires per-language codegen tooling for every bot language, including
  hobbyist submissions in whatever language shows up next. Too heavy a toolchain requirement for
  "easy to add a new language."
- **HTTP over a unix socket** — requires the bot to run a server (or the engine to), a much larger
  implementation burden than "read a line, write a line," with socket-file lifecycle to get right
  for no real benefit here.
- **JSON-RPC 2.0** — solves a more general problem (arbitrary method dispatch, request/response
  correlation) than our fixed, engine-driven lifecycle (init → repeated observe/act → end) needs.
  Its envelope ceremony (`method`/`params`/`result`/`error` unions, id matching) buys nothing our
  own envelope doesn't already provide via `type` + `roundId`.
- **Raw JSON with length-prefix framing** — marginally more compact/robust, but far easier to get
  wrong per-language (framing bugs are a classic newcomer mistake) and not `docker logs`-debuggable.

NDJSON wins on "trivial to implement correctly in any language" and human debuggability, which are
both explicit platform priorities. Two hardening rules make it safe: (1) every SDK must use its
language's standard JSON serializer — never hand-rolled string concatenation — so control
characters including literal newlines inside string values are always escaped; (2) the reader
enforces a line-length cap (e.g. 1 MiB); an oversized/unterminated line is a `PROTOCOL_VIOLATION`,
not an unbounded-memory risk. `stdout` is reserved exclusively for the protocol stream; `stderr` is
the bot's free-form debug log, captured but never parsed as protocol.

### Envelope

```ts
interface Envelope<TPayload = unknown> {
  protocolVersion: string; // "MAJOR.MINOR"
  type: MessageType;
  matchId: string;
  roundId?: number;
  seq: number; // per-direction monotonic counter; duplicate/out-of-order = violation
  sentAt: string; // ISO-8601, diagnostic only — never consulted for game logic
  payload: TPayload;
}
```

### Message catalogue

Engine → bot: `init`, `observation`, `result`, `error`, `match-end`.
Bot → engine: `ready`, `action`, `resign`, `error`.

`action-request` from the original strawman is deliberately folded into `observation` via an
`awaitingAction: boolean` (+ optional `deadlineAt`) field rather than kept as a separate message
type. One concept — "here is your view of the round, and here's whether/when you must respond" —
covers both sequential games (only the active participant's observation awaits a response) and
simultaneous games (everyone's does), without the protocol ever encoding "how many actors act this
round" as a fixed shape.

Every message noun (match, participant, round, observation, action, result, error) is generic;
none are game-specific. Payload contents inside `observation`/`action`/`result` are opaque to the
protocol layer and defined per-game by the game/engine layer (ADR-0005) — the protocol only
validates envelope/message shape, never payload semantics.

### Schema validation

JSON Schema is the intended canonical, cross-language contract, versioned under
`packages/protocol/schema/v1/`. Other-language SDKs are meant to eventually validate against
those files with their ecosystem's standard validator. Cross-language conformance is enforced
with a shared golden fixture corpus (`packages/protocol/fixtures/v1/{valid,invalid}/`) that every
language SDK's test suite runs against — this tests actual behavior rather than trusting
independently-maintained schemas to agree.

> **Implementation note (Phase 3):** the TypeScript implementation is Zod-first, not
> JSON-Schema-first as originally planned here. `packages/protocol/src/messages.ts` hand-writes
> the Zod discriminated-union schema directly; `packages/protocol/schema/v1/` is deliberately
> left empty for now. Reasoning: with no second-language SDK yet built (that's Phase 8), a
> hand-maintained JSON Schema has no real consumer today, and `json-schema-to-zod`-style codegen
> is a known weak spot for exactly the shape this protocol needs — a discriminated union keyed on
> `type` with a cross-field constraint (`result.roundId` depending on `payload.scope`). Building
> that codegen pipeline now, before anything reads its output, would be exactly the kind of
> speculative infrastructure this project's own guidance warns against. The golden fixture corpus
> is built now regardless — it costs little, is independently useful today (see
> `test/fixtures.test.ts`), and is exactly what Phase 8 will hand to a Java conformance suite
> whether or not a JSON Schema file exists yet. When Phase 8 needs an actual cross-language
> schema artifact, the plan is to generate JSON Schema **from** the Zod schemas
> (`zod-to-json-schema`, the direction with better discriminated-union support) rather than the
> reverse — a change to the mechanics of this decision, not to its cross-language-contract goal.

Protocol-shape validation (`PROTOCOL_VIOLATION`) is a distinct pass from game-legality validation
(`ILLEGAL_ACTION`, decided by the `GameDefinition`) — a structurally valid message can still be an
illegal move, and those are different forfeit reasons (ADR-0003).

### Versioning

`protocolVersion` is `MAJOR.MINOR` only (a wire contract, not a package version). MINOR bumps are
additive-only (new optional fields/message types); every SDK must ignore unknown fields/types so
old bots keep working against a newer-MINOR engine. MAJOR bumps may break compatibility; the
engine keeps a per-major-version schema/handler set during a deprecation window, and a bot
declares its supported version in `ready` — an unsupported major version is a controlled forfeit
(`PROTOCOL_VERSION_UNSUPPORTED`), not a crash.

## Consequences

- Any language that can read/write lines on stdin/stdout and parse/emit JSON can implement a bot,
  with no codegen step. A minimal Java bot loop is ~20 lines (see `docs/architecture.md` §3 and the
  Java bot guide once written).
- Adding Python/Rust/Go bot support later requires only a JSON Schema-conformant SDK for that
  language, validated against the shared fixture corpus — no protocol or engine change.
- Debugging a match is "read the NDJSON transcript," no special tooling required.
