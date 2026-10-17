# ADR-0001: Monorepo Architecture & Platform/Competitor Boundary

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

The Thunderdome is a single TypeScript/Node.js codebase that must cleanly separate three trust
levels: platform code (engine, protocol, runtime, SDKs, CLI — maintainer-owned), game definitions
(rules implementations — community-contributed but maintainer-reviewed, run in-process), and bot
code (fully community-owned, untrusted, executed only inside Docker). A single competitor
submitting a bot must not be able to touch platform code, and the tooling must enforce that
mechanically, not just by documentation ("don't cheat" is not a control).

## Decision

### Tooling: Yarn Berry (4.x) via Corepack, `nodeLinker: node-modules`

> **Superseded by [ADR-0008](0008-toolchain-simplification.md).** The repository now targets
> Node 25 and Yarn Classic 1.22.22 — the toolchain already installed and in active local use,
> adopted to avoid Berry's per-workspace dependency duplication and Corepack's setup overhead.
> The reasoning below is kept for the historical record — the PnP-avoidance argument in
> particular doesn't apply once Classic (which has no PnP mode at all) is the target — but every
> other decision in this ADR (directory layout, games-vs-bots workspace membership, registry
> design) is unaffected and still stands.

Pinned via the root `package.json`'s `packageManager` field (no committed zero-installs/`.yarn/cache`).
Yarn Classic (v1) is unmaintained upstream; Berry is the actively developed line. Plug'n'Play is
rejected: several bots are built from a Docker context scoped to just `bots/<game-id>/<bot-id>/`, which never
sees the workspace graph, root lockfile, or `.pnp.cjs`. PnP's strictness only pays off _inside_
the workspace graph; outside it, it's actively hostile to isolated builds, native addons, and
tools (`tsx`, bundlers, mocking libraries) that assume a real `node_modules` tree. `node-modules`
linker is universally compatible with all of that, at the cost of some resolution strictness we
don't need for this use case.

Node target: **24.x (Active LTS)**, pinned via `engines` + `.node-version`. The development
machine happens to have Node 25 ("Current," non-LTS) installed; CI and the documented supported
runtime are Node 24, matching the "modern LTS" requirement rather than whatever the newest release
happens to be.

### Directory layout

> **Amended:** bots are grouped by game — `bots/<game-id>/<bot-id>/`, not a flat `bots/<bot-id>/`
> — once real bots existed and a flat namespace mixing every game's submissions together stopped
> making sense. `ci/tools/boundary-check` treats the `(game-id, bot-id)` pair, not just the first
> segment, as the atomic "one bot directory" unit, and additionally validates that the game
> segment agrees with the manifest's own `game` field, so the two can't silently drift apart. Bot
> ids remain globally unique across the whole `bots/` tree regardless of grouping — the nesting is
> organizational, not a change to identity.

```
apps/cli
packages/{protocol, rng, engine, runtime, bot-sdk-js, game-sdk, tournament-formats}
games/<game-id>/                     real Yarn workspace members
bots/<game-id>/<bot-id>/             NOT Yarn workspace members
ci/tools/boundary-check/                workspace member — CI enforcement
docs/{adr, guides}
.github/{CODEOWNERS, workflows/}
```

Root `package.json` workspaces glob is `["apps/*", "packages/*", "games/*", "ci/tools/*"]` —
`bots/*` is deliberately excluded.

### Games are Yarn workspace members; bots are not

Games are always TypeScript, always imported and executed **in-process** by the engine, and merge
only through maintainer + game-steward review. Workspace membership gives them project-reference
typechecking against `game-sdk`, hoisted/deduped dependencies, and a single reviewable lockfile —
and there is no isolated-build requirement to protect, since nothing ever `docker build`s a game
directory in isolation.

Bots are the opposite on every axis: any language, never imported in-process, always executed via
Docker from a build context scoped to exactly `bots/<game-id>/<bot-id>/`. Making a bot a workspace member would:

1. **Create phantom dependencies.** A bot's `package.json` as a workspace member would get its
   dependencies hoisted into the root `node_modules`. It could then import something a sibling
   workspace package happened to pull in, without declaring it, pass fine under
   `yarn workspace bot-foo test`, and fail the moment `docker build bots/<game-id>/<bot-id>/` runs with no root
   `node_modules`/lockfile in scope — the worst possible time for that failure to surface.
2. **Turn the root lockfile into a shared, contended file.** Every Node/TS bot adding a dependency
   would touch the root `yarn.lock`, immediately breaking "a bot PR touches only its own
   directory" for the majority of real submissions, and turning the lockfile into a permanent
   merge-conflict hotspot across unrelated competitors' concurrent PRs.

So each `bots/<game-id>/<bot-id>/` is a fully self-contained unit in whatever language/build system its author
chooses, described only by `manifest.json`, built and run exclusively via `docker build`/`docker
run` against that one directory. The platform registry reads a bot's manifest and hands its
directory path to the runtime — it never imports bot code into the platform process. This is a
security property (the import graph structurally cannot reach `bots/**`), not merely a build
convenience, and it's also what makes a `git subtree`/sparse-checkout of just one bot's directory
actually work without dragging in the whole monorepo.

### Registries: pure filesystem scan, no hand-maintained index

Both the Game Registry and Bot Registry glob `games/*/manifest.json` /
`bots/*/*/manifest.json` and
validate each against a Zod schema owned by `game-sdk`/`bot-sdk-js` respectively. There is no central
`registry.ts` listing ids by hand — that would recreate exactly the merge-conflict/coupling
friction this design is trying to avoid. Manifests are plain JSON (never `.ts`/`.js`): reading a
competitor's metadata must never require executing their code. Game code is imported lazily, by
id, only when a command actually needs it; bot code is never imported at all. A broken manifest is
reported per-entry (excluded from listings with a clear warning) rather than crashing unrelated
commands; duplicate ids are a hard error scoped to that id.

## Consequences

- A new game requires a reviewed PR touching only `games/<id>/` plus registration is automatic
  (no central file edit) — but it still requires maintainer + steward sign-off, since it runs
  in-process.
- A new bot requires a PR touching only `bots/<game-id>/<bot-id>/`; CI (ADR-0007) mechanically
  enforces this regardless of what a manifest declares.
- Bot authors are free to use any language/toolchain; the monorepo's Yarn/TypeScript conventions
  never leak into a bot's own build.
- The root lockfile only ever changes for platform/game dependency changes — never for bot
  dependency changes — keeping it a low-churn, genuinely reviewable file.
