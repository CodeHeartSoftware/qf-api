# ADR-0015: A Read-Only HTTP API for Stock Market 4's Web UI

> **Inherited from Thunderdome** (`CodeHeartSoftware/thunderdome@17664fb`). Kept verbatim as the historical record: package names were `@thunderdome/*` and paths like `apps/stock-market-4-api` / `.thunderdome/stock-market-4/` at the time — today they are `@quant-fusion/*`, `apps/api`, and `.quant-fusion/`.

## Status

Accepted

## Context

Stock Market 4's only interface until now has been `apps/cli` — real functionality (`match
forward run|list|inspect|preview|refresh|status`), but a terminal-only one. A web UI
(`apps/stock-market-4-ui`) is being added on top of a structural/styling template
(`stock-bots-ui`, an external Figma-Make scaffold) that has no backend integration at all in its
original form.

Two things had to be decided before any code could be written:

1. **Where does the UI get its data from?** `apps/cli`'s commands are real, working logic, but
   they're script entry points (`parseArgs`, `console.log`), not an importable library another
   program calls. The UI needs an HTTP boundary in front of the same underlying packages
   (`@thunderdome/forward-match-store`, `@thunderdome/market-data`, `@thunderdome/research-fusion`,
   `@thunderdome/game-stock-market-4`) `apps/cli` already uses.
2. **How much of that surface ships now?** Real bot execution goes through Docker containers
   (`@thunderdome/runtime`, `runAvailableRounds`) — genuine functionality, but heavyweight and
   slow. Separately, `games/stock-market-4/src/game.ts`'s `resumeForwardState` +
   `getCurrentStandings` turned out to already be **pure functions** — no Docker, no engine loop,
   just: load a persisted `ForwardMatchRecord`, rebuild the state, read off equity/cash/positions/
   returns/Sharpe/drawdown/last-fills. That's real, substantive data obtainable for free.

## Decision

**New package `apps/stock-market-4-api`** (an `apps/*` member, not `packages/stock-market-4/*` —
see `packages/README.md`: the `packages/*` family is "the platform," things other packages import;
this API, like `apps/cli`, is a terminal consumer nothing else depends on). It imports the
workspace packages **directly, in-process** — not by shelling out to the `thunderdome` CLI binary
and parsing stdout. Direct import gives real thrown errors and typed return values instead of
scraping text, and this package already sits inside the same Yarn workspace as everything it
needs.

**Phase A ships read-only (GET-only, no mutation) endpoints, covering only what's computable
without Docker:**

- `GET /api/bots` — a plain directory scan of `bots/stock-market-4/*/manifest.json`. No dependency
  on `@thunderdome/registry` (that package's validation is for real match execution; a listing
  doesn't need it).
- `GET /api/forward-matches` / `GET /api/forward-matches/:matchId` — `listForwardMatchRecords` /
  `loadForwardMatchRecord` (`@thunderdome/forward-match-store`) against the same shared
  `.thunderdome/stock-market-4/db.sqlite` `apps/cli` reads. The single-match route additionally
  calls `game.parseConfig` + `resumeForwardState` + `getCurrentStandings` (`@thunderdome/
game-stock-market-4`) — real per-bot equity/cash/positions/returns/Sharpe/drawdown/last-fills,
  entirely from the persisted snapshot, never touching a container.
- `GET /api/market-data/status` — the same per-ticker freshness computation `apps/cli`'s
  `matchForwardStatus` already performs (`queryTickers`/`queryLatestKnownDate` from
  `@thunderdome/market-data`), reshaped into JSON instead of console lines.
- `GET /api/research` — `createFusionFixtureDataset()` (`@thunderdome/research-fusion`), which
  replays the research-store migration history in memory to reconstruct the current dataset —
  equivalent to reading the persisted row via `@thunderdome/research-store`'s `getResearchDataset`
  (research data has no per-version pinning), without this package also needing a dependency on
  `@thunderdome/stock-market-4-db` or a resolved file path.

**Explicitly deferred to a later phase, not built now:** invoking `runAvailableRounds` +
`@thunderdome/runtime` to actually advance/resume a match from the UI; a "start a new forward
match" flow; triggering batch market-data ingestion jobs. All were explicit product decisions
(real Docker execution is real work worth doing right, not worth rushing into a first pass) — see
the accompanying implementation plan, not repeated here.

A small duck-typed helper (`readForwardShadowFields`, `src/lib/forwardShadowConfig.ts`) is
duplicated from `apps/cli/src/lib/forwardShadowConfig.ts` rather than imported — `apps/cli` isn't
a library other apps depend on (same app-vs-package boundary above), and it's a handful of lines.

## Consequences

- Two SQLite connections may be opened per request today (one via `@thunderdome/forward-match-
store`'s own `openDb`, one via `@thunderdome/market-data`'s `createMarketDataStore`) rather than a
  single long-lived handle — matching each package's own existing one-shot-open pattern (`apps/
cli` does the same, since it's normally a short-lived process). Fine for a single-developer local
  tool; worth revisiting only if this ever needs to serve real concurrent load.
- (Phase A history) Every route was read-only, with no path from the UI to actually running a bot,
  starting a match, or kicking off an ingestion job — see the Phase B section below for what's
  since been added, and "start a new forward match" / scheduled jobs for what's still deferred.
- Local-dev CORS is wide open (`Access-Control-Allow-Origin: *`) since the UI is a separate Vite
  dev-server origin and no credentials are involved. Revisit before this is ever exposed beyond
  localhost.
- This corrects a stale memory claim from an earlier session that Phase 3 (resumable forward
  execution, ADR-0013) was "not yet implemented" — it was already shipped and working
  (`fusion-quant-showdown`, a real 44-round-and-counting forward match, exists locally) by the time
  this ADR was written.
- Both apps also ship a `Dockerfile` (`docker-compose.yml` runs them together),
  each built from the monorepo root since neither package is independently publishable — see each
  Dockerfile's own comment for why (the API reuses `scripts/build.sh` wholesale rather than a
  hand-maintained narrower dependency list; the UI ships a ~30-line plain-`node:http` static
  server instead of carrying `vite preview` and its whole toolchain into the runtime image). The
  shared `.thunderdome/` SQLite file is mounted as a volume, never baked into the API image, so
  the container and the host CLI always see the same live match data.

## Phase B — mutating actions

Adds a handful of real POST endpoints, each spawning `apps/cli`'s own already-tested command as a
child process (`src/lib/subprocess.ts`) rather than a second, in-process implementation of
Docker/game execution — the same "don't duplicate the one real code path" reasoning
`matchForwardRefresh.ts` (`apps/cli`) already applies to its own price-refresh step. Async `spawn`,
never `spawnSync`: this server keeps answering other requests (reads, health checks) while a
Docker build/match run/price fetch is in flight.

- `POST /api/forward-matches/:matchId/run` — `match forward run <matchId> <...participantIds>`.
  Real Docker execution, real persisted-record mutation; the one action that actually advances a
  match. 409s if the match isn't `active` or a run for it is already in flight (an in-memory
  per-key lock — good enough for a single-developer local tool, not meant to survive a restart).
- `POST /api/forward-matches/:matchId/preview` — regenerates a fresh config via
  `emit:forward-config` (`@thunderdome/research-fusion`, run with `cwd` set to the package itself,
  never via `yarn workspace ... run`, which pollutes stdout and breaks the JSON parse — see
  `emitForwardConfig.ts`'s own comment) from the match's own stored `marketDataset`/dates, writes
  it to a temp file, and calls `match forward preview <matchId> --config-file <path>`. Never
  mutates the match (see that CLI command's own doc comment). An optional `{ participantId }`
  body restricts it to one bot — `apps/cli`'s own `--participant` flag, added alongside this route
  specifically for the Fleet tab's per-bot button.
- `POST /api/market-data/fetch` — the Jobs panel's "Fetch Latest Price Data". For every dataset an
  active match currently trades against: runs `fetchAndAppendBars.ts` for real, and — only when it
  actually generated a new migration file — does the "ONE manual step left" that script prints
  (adds the import + array entry to `market-data/src/migrations/index.ts`) and rebuilds
  `market-data`/`stock-market-4-db`. Deliberately does NOT also resume/advance any match; that
  stays the separate "Run Next Round" action above, matching `matchForwardRefresh.ts`'s own
  fetch/resume split. One real limitation, stated honestly in the response rather than hidden: THIS
  already-running API process has already imported the old `dist` and won't see the rebuilt
  migration until it's restarted (Node doesn't hot-swap an already-imported ES module) — every
  other reader (a fresh CLI invocation, a restarted API) sees it immediately.

Every action route responds with the spawned command's own `{ ok, exitCode, output }` (combined
stdout+stderr) rather than a bespoke structured result — the UI renders it as a plain terminal log
(`ActionLog`). Honest and simple beats a hand-parsed summary that might silently misrepresent what
a human watching the same command would have seen; a structured shape can follow later if a real
need for one shows up.

Still explicitly deferred: a "start a new forward match" flow, and anything resembling scheduled/
automatic job execution (every action here is user-initiated, one click at a time).
