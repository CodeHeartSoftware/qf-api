# ADR-0008: Simplify the Toolchain to Node 25 and Yarn Classic 1.22.22

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted — supersedes the "Tooling" decision in
[ADR-0001](0001-monorepo-and-boundary.md#tooling-yarn-berry-4x-via-corepack-nodelinker-node-modules).

## Context

ADR-0001 originally chose Yarn Berry (4.x) with the `node-modules` linker and Node 24 (Active
LTS), reasoned from first principles. In practice, Berry's stricter per-workspace dependency
resolution (a workspace may only resolve a binary/module it has itself declared, even when the
underlying package is already hoisted to the root `node_modules`) meant every workspace needed
its own explicit `typescript`/`vitest` (and, for `ci/tools/boundary-check`, `tsx`)
`devDependencies` duplicated across the whole monorepo, purely to satisfy Berry's resolution
rules rather than because any package actually needed its own copy. Corepack's `packageManager`
pinning also added a setup step (`corepack enable`) with no real payoff for a single-developer
repository where the toolchain version is already just "whatever's installed."

Node 25 and Yarn Classic 1.22.22 were already the versions in active local use (Node's own
"Current" release line, not the Active LTS one ADR-0001 originally specified) — adopting them as
the project's declared baseline, rather than requiring a separate LTS install alongside what was
already there, removes a layer of version-manager juggling for no corresponding benefit in a
repository with one contributor.

## Decision

Adopt **Node 25** and **Yarn 1.22.22 (Classic)** Thunderdome-wide.

- `package.json`: `"engines": { "node": ">=25 <26" }` — a low-cost guard for any future
  contributor, encoding the version already in use rather than aspiring to a different one.
- `.node-version`: `25`, for local version managers.
- No `packageManager` field and no Corepack — one less setup step, with no pinning mechanism to
  fall back on if a machine's global `yarn` is some other version (`npm install -g
yarn@1.22.22` once, same as any other global tool pin).
- `yarn.lock` is the Classic v1 lockfile format; `yarn install --frozen-lockfile` is the CI
  install command (Classic's equivalent of Berry's `--immutable`).
- Root-level multi-package scripts (`build`, `typecheck`) no longer use Berry-only commands
  (`yarn workspaces foreach --topological ...`). `typecheck` uses Classic's `yarn workspaces run
typecheck` (safe here because it's order-independent once `build` has already run). `build`
  cannot rely on `yarn workspaces run build` alone — Classic's `workspaces run` does not guarantee
  topological order, and `ci/tools/boundary-check` depends on `@thunderdome/bot-sdk-js` and
  `@thunderdome/game-sdk`'s compiled output — so `scripts/build.sh` builds the dependency-free
  packages first, then `boundary-check` last, explicitly and without adding a task runner
  dependency (no Lerna/Nx/Turborepo) for what is currently a small, fixed set of dependency edges.
- Cross-workspace dependencies (e.g. `ci/tools/boundary-check`'s dependency on `bot-sdk`/`game-sdk`)
  use ordinary semver ranges (`"^0.1.0"`), not Berry's `workspace:*` protocol, which Classic
  doesn't understand.

### A pleasant side effect: less duplication

Since Yarn Classic's hoisting has no per-workspace enforcement — a binary hoisted to the root
`node_modules/.bin` (or a module hoisted to the root `node_modules/`) resolves correctly from any
nested workspace via Node's ordinary upward `node_modules` walk — the redundant per-workspace
`devDependencies` ADR-0001's Berry setup required were no longer needed at all. This was verified
empirically (stripping a package's redundant `devDependencies` and re-running its
`build`/`typecheck`/`test` scripts) before removing the duplication across every package — shared
dev tooling (`typescript`, `vitest`, `tsx`, `eslint`, `prettier`) now lives only in the root
`package.json`.

## Consequences

- **Node 25 is not an LTS release** (it's the odd-numbered "Current" line; Node 24 is Active LTS
  as of this writing). This is a deliberate trade-off: matching the toolchain already installed
  and in use is weighted higher than strict adherence to the "modern LTS" guidance in the
  original project brief. If that stops being true later (e.g. the installed toolchain moves on),
  this decision should be revisited rather than left stale.
- Yarn Classic has no Plug'n'Play mode, so the PnP-avoidance reasoning in ADR-0001 is moot — not
  because it was wrong, but because the constraint it was protecting against no longer exists
  under this toolchain.
- `bots/**` remains excluded from the Yarn workspace graph regardless of Berry vs. Classic — that
  decision was about isolated Docker builds and lockfile contention, not about which Yarn line is
  in use, and holds unchanged (see ADR-0001).
- Local dev on a machine where global `yarn` is already some other version needs
  `npm install -g yarn@1.22.22` once — there is no per-repo pinning to fall back on, which is the
  explicit trade-off of staying pin-free rather than adding Corepack back in just for this.
