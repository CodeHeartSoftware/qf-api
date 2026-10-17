# `quant-fusion` CLI

The `@quant-fusion/cli` package (`apps/cli`) is Quant Fusion's command-line entrypoint, and the
execution layer the API (`apps/api`) spawns for every simulation action. It's a thin presentation
layer — no engine logic lives here — over real commands for running simulations (`match run`,
`match forward ...`), real-portfolio decisions (`live decide`), and container cleanup.

Internally a simulation is still a "match" and a model is still a "bot" (the UI says Simulation /
Model); those internal names are deliberately unchanged for now.

## Running it

From the repo root, during development (via `tsx`, no build step needed):

```bash
yarn qf --help
```

Or, after `yarn build`, as the built binary directly:

```bash
node apps/cli/dist/index.js --help
```

Both forms take the same arguments throughout this doc. `--help`/`-h` prints usage and exits 0;
`--version`/`-v` prints the CLI's version and exits 0.

**Run it from the repo root** — commands resolve models and the game by scanning `games/` and
`bots/` under the current working directory.

## Commands

| Command                    | Status                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `match run`                | Real — runs one historical simulation between one or more models. See below.             |
| `match forward run`        | Real — runs (or resumes) one persistent, resumable forward simulation. See below.        |
| `match forward list`       | Real — lists persisted forward simulations. See below.                                   |
| `match forward inspect`    | Real — prints one persisted forward simulation's details. See below.                     |
| `match forward preview`    | Real — read-only "what would the model do right now," no persistence. See below.         |
| `match forward refresh`    | Real — regenerates a forward simulation's config against the current research.           |
| `match forward status`     | Real — reports how far behind the latest market data a forward simulation is.            |
| `match forward pin-status` | Real — reports whether each model's source still matches the version pinned at creation. |
| `match forward end`        | Real — marks a forward simulation completed.                                             |
| `live decide`              | Real — runs a model's decision against a live (broker) portfolio, for the Live tab.      |
| `cleanup`                  | Real — force-removes any leftover Quant Fusion model containers. See below.              |
| `games` / `bots`           | Stub — prints "not yet implemented"                                                      |

## `match run`

```bash
yarn qf match run <botId> [...moreBotIds] [--config '<json>']
```

Resolves every given model id (and the game they all share) through the registry
(`@quant-fusion/registry`), builds each model's Docker image on demand from its own manifest, then
drives a real simulation through the engine (`@quant-fusion/engine`'s `runMatch()`) and runtime
(`@quant-fusion/runtime`'s `DockerActionCollector` and `BotLifecycle`), printing the final
standings.

- `--config` is the Stock Market 4 game config JSON (see `games/stock-market-4/README.md`).
- Model ids are whatever a model's own `manifest.json` declares as `id` — today `quant-v0` and
  `quant-lite` (`bots/stock-market-4/`).
- Exits 0 on a completed, forfeited, or timed-out simulation, 1 on any resolution error (unknown
  model id, invalid `--config`, or a model failing to initialize).

### A note on ties and non-terminating matches

Rock-Paper-Scissors plays every configured `totalRounds` hand, full stop — it never tries to
detect "the outcome is already decided" and stop early, and it never keeps replaying indefinitely
either. That means a genuine tie is possible (e.g. a bot that always copies the opponent's last
move, against a bot that always plays the same throw, draws every hand after round one — with
300 real hands played, that's an honest 0-0 tie, not a cop-out) — `match run` reports this as a
real draw in the standings, not specially flagged.

Separately, `runMatch()` (`@quant-fusion/engine`) also caps the _whole match_ at 120 seconds of
wall-clock time, regardless of the game or the reason it hasn't finished — pure defense-in-depth
(docs/adr/0003-docker-bot-isolation.md) against a different game's own termination logic having a
similar gap. Rock-Paper-Scissors is bounded by `totalRounds` by construction and shouldn't ever
actually hit this in normal play; if it does, `match run` reports `status: 'match-timeout'`
distinctly from both a forfeit and a real tie.

### A known Docker reliability issue (fixed)

Real Docker container startup used to occasionally race and a bot's `init` handshake would time
out (`INIT_TIMEOUT`) even though the bot and image were fine — root-caused and fixed by a
first-write retry in `@quant-fusion/runtime`; see
[`scripts/README.md`](../../scripts/README.md#a-known-docker-reliability-issue-root-caused-and-fixed)
for the full explanation. If you still see this, it's a new issue, not the old one.

## `match forward run` / `list` / `inspect`

```bash
yarn quant-fusion match forward run <matchId> <botId> [...moreBotIds] \
  [--config '<json>' | --config-file <path>] [--store-dir <path>]
yarn quant-fusion match forward list [--store-dir <path>]
yarn quant-fusion match forward inspect <matchId> [--store-dir <path>]
```

Roadmap Phase 3's persistent, resumable forward-match lifecycle
([`docs/adr/0013-forward-match-persistence.md`](../../docs/adr/0013-forward-match-persistence.md))
— today this only works with a `stock-market-4` match whose config declares
`"gameType": "FORWARD_SHADOW"` (see [`games/stock-market-4/README.md`](../../games/stock-market-4/README.md)),
since it's the only game that currently exports the three functions (`serializeForwardState`/
`resumeForwardState`/`isForwardMatchFullyResolved`) this command needs.

Unlike `match run`, a forward match isn't played to completion in one invocation — it plays
whatever's CURRENTLY known (a `FORWARD_SHADOW` match's dataset grows over real time via
`@quant-fusion/market-data`'s `appendBars`, see
[`docs/adr/0012-incremental-market-data-growth.md`](../../docs/adr/0012-incremental-market-data-growth.md)),
persists its progress after every round, and exits — resumable by running the exact same command
again later, once more data has arrived:

```bash
yarn quant-fusion match forward run fusion-live fusion-fundamental-v0 \
  --config '{"gameType":"FORWARD_SHADOW","marketDataUniverse":["ELMT"],"marketDataset":{"id":"fusion","version":"1","dbPath":"./.quant-fusion/db.sqlite"},"startDate":"2026-09-01","endDate":"2026-12-31"}'
```

```
Created forward match "fusion-live" (Stock Market 4).
Building 1 bot image(s)...

Forward match "fusion-live": played 3 new round(s) this invocation (3 total).
Still resumable — more data may arrive later; re-run the same command to continue.
```

- `<matchId>` is REQUIRED and operator-chosen — never auto-generated. This is deliberate: a
  forward match is meant to be found and resumed on purpose, not created by accident because
  nobody remembered a random id.
- `--config` (or `--config-file`) is only used (and one of them required) the FIRST time —
  creating a new match. Resuming an existing one always uses its own stored config; passing either
  on a resume invocation prints a warning and is ignored, rather than silently letting a later
  invocation redefine history.
- `--config-file <path>` reads the same JSON from a file instead of an inline argument — use it
  once `--config`'s JSON gets too large for your shell's argv limit (a `researchTimeline` built
  from a real research dataset routinely runs to megabytes; see
  [`packages/stock-market-4/research/fusion`](../../packages/stock-market-4/research/fusion)'s
  `emit:forward-config` script for generating one). `--config` and `--config-file` are mutually
  exclusive.
- Progress is persisted after every round resolved, not just once at the end of an invocation — a
  crash mid-invocation loses at most the one round genuinely in flight.
- Exits 0 whether the match is still active (more data may arrive later) or has fully resolved
  through `config.endDate` — `match forward inspect <matchId>` shows which. Exits 1 for bad input,
  an unrecognized/corrupt record, or a bot failing to initialize — the same categories `match run`
  already reports on.
- `match forward list`/`inspect` are pure reads against `.quant-fusion/forward-matches/` (gitignored
  local run state, override with `--store-dir`) — no Docker, no registry.

## `match forward preview`

```bash
yarn quant-fusion match forward preview <matchId> --config-file <path> [--store-dir <path>]
```

Read-only "what would the bot's orders be right now, versus what they'd be against this match's
own stored config" check — never persists anything (no round resolved, no `ForwardMatchRecord`
write). Since this game has no intraday price data (daily bars only), the only thing that can
differ within the same trading day is RESEARCH recorded after the match was created/last
configured — pass a freshly regenerated config (e.g. re-run
[`packages/stock-market-4/research/fusion`](../../packages/stock-market-4/research/fusion)'s `emit:forward-config` against the
live research fixture) as `--config-file`; it must describe the same `marketDataUniverse`/
`marketDataset`/`startDate` as the match's own stored config, differing only in
`researchTimeline` (or similar). Prints, per bot, which securities' orders differ between "at
stored config" and "right now," and why.

## Interrupting a running `match run`

Closing the terminal, or an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` — the CLI catches both and
tears down whatever bot containers are currently running before exiting, rather than leaving them
behind (a second interrupt while that's in progress exits immediately instead of waiting). See
[`docs/adr/0003-docker-bot-isolation.md`](../../docs/adr/0003-docker-bot-isolation.md)'s "Resource
cleanup" section for the full design, including the guarantees inside a single match run itself).

## `cleanup`

```bash
yarn quant-fusion cleanup
```

The explicit backstop for whatever slips past the above — most notably a `SIGKILL` (or a host
crash) that never gives the CLI a chance to run any of its own cleanup code at all. Force-removes
every container carrying the `quant-fusion.matchId` label, regardless of which process created it
or whether that process is still alive:

```
Found 1 leftover container(s):
  2bd79f34b06a  match=manual-orphan-test  participant=quant-v0  state=exited
Removed.
```

Prints `No leftover Quant Fusion containers found.` (and exits 0) when there's nothing to do.
