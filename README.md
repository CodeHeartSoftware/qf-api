> **Public mirror.** This repository is a read-only copy of a private CodeHeart repo, synced
> automatically on every push to `main`. Issues and pull requests aren't monitored here.
> Licensed under [Apache-2.0](LICENSE). Built by [CodeHeart](https://github.com/CodeHeartSoftware).

# Quant Fusion — API

Quant Fusion is a personal quantitative investment tool: build research models and manage
simulated portfolios with them. This repo is the backend — the HTTP API, the simulation engine
and CLI it drives, the research/market-data packages, and the models. The web UI lives in its own
repo, [`qf-ui`](https://github.com/CodeHeartSoftware/qf-ui).

> **Provenance.** Forked from the Stock Market 4 game in
> `CodeHeartSoftware/thunderdome@17664fb` (private)
> with a fresh history. Thunderdome keeps its own copy of Stock Market 4 (plus the frozen
> `fusion-fundamental-v0`…`v7` benchmark models, which were not carried over). Inherited ADRs in
> [`docs/adr/`](docs/adr/) are kept verbatim as the historical record.

## Layout

| Path                                        | What it is                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api`                                  | Express API the UI talks to (port **4410**)                                    |
| `apps/cli`                                  | `quant-fusion` CLI — runs simulations; the API spawns it for every run action  |
| `games/stock-market-4`                      | The simulation engine's market game (historical and forward simulations)       |
| `packages/stock-market-4/*`                 | Market data, research store/fusion/quantum, quant SDK, forward-match store, db |
| `packages/{engine,runtime,registry,…}`      | Generic engine, Docker model runtime, model/game registry, protocol, SDKs      |
| `bots/stock-market-4/{quant-v0,quant-lite}` | The models (each built and run as its own Docker image)                        |

Vocabulary: the UI says **Model / Simulation / Trading day**; the code still says
bot / match / round (and `stock-market-4` for the game). That internal rename is a planned
follow-up, deliberately kept out of the migration.

## Getting started

Requires Node 25, Yarn 1.22, and Docker (models run in containers).

```bash
yarn install
yarn build
yarn workspace @quant-fusion/api dev     # http://localhost:4410 — full functionality
```

Then start the UI from its own repo (`yarn dev` there, http://localhost:5420). Two terminals, two
commands.

`yarn docker:up` (in `apps/api`) / `docker compose up --build` runs the API containerized, but
without a Docker socket, so simulation runs only work with the host-run API above.

### Local data

All local state lives in the gitignored `.quant-fusion/` directory at the repo root:
`db.sqlite` (market data, research, simulations, decision audit), `live.sqlite` + `live/`
(Live tab), `job-runs.sqlite` (Jobs tab), `settings.json`, `custom-universes.json`.

### CLI

```bash
yarn qf --help
yarn qf match forward list
```

See [`apps/cli/README.md`](apps/cli/README.md).

## Checks

```bash
yarn lint && yarn format:check && yarn typecheck && yarn test
```

Models aren't workspace members — run `npm test` inside `bots/stock-market-4/<model>/`. After
changing `packages/bot-sdk-js` or `packages/stock-market-4/quant-sdk-js`, repack the models'
vendored tarballs with `scripts/pack-bot-sdk-js.sh` / `scripts/pack-quant-sdk-js.sh`.

## Pulling from Thunderdome

Nothing flows from Thunderdome automatically. To pull a path on purpose:

```bash
yarn upstream:sync packages/stock-market-4/market-data      # from ../thunderdome HEAD
yarn upstream:sync apps/stock-market-4-api/src/lib/newsAgent.ts --ref CodeHeart/main
```

It copies the path from a local Thunderdome checkout, applies the same renames the fork used
(`scripts/rebrand.pl`), and leaves an ordinary diff to review — expect it to show this repo's own
local edits too, so commit only the hunks you want.
