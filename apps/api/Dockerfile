# Build from the MONOREPO ROOT, not this directory:
#   docker build -f apps/api/Dockerfile -t quant-fusion-api .
#
# This package isn't independently publishable — like every other @quant-fusion/* package it only
# resolves through the Yarn Classic workspace's hoisted node_modules (see
# docs/adr/0008-toolchain-simplification.md), so building it means building the whole workspace.
# `RUN bash scripts/build.sh` reuses the exact script `yarn build` runs locally rather than
# hand-listing just this package's own dependency subset — one build path to keep correct, at the
# cost of a heavier image than a bespoke narrow build. Acceptable for a single-developer local
# tool, not a deployed multi-tenant service.
#
# `bots/stock-market-4/*/manifest.json` is read from disk at runtime (GET /api/bots) — it's part
# of this same COPY, not a separate mount, since it's ordinary git-tracked source. The one thing
# deliberately NOT baked in is `.quant-fusion/` (the shared, host-generated SQLite file this API
# reads forward-match/portfolio data from) — see docker-compose.yml, which mounts
# it as a volume instead so the container and the host CLI (`quant-fusion match forward ...`)
# always see the same live data.
#
# Deliberately has NO `docker` CLI and no Docker socket — this image is read/analysis only.
# `POST /api/forward-matches/:id/{run,preview}` (and `POST /api/matches/historical`) ultimately
# reach `packages/runtime/src/image-build.ts`'s `docker build`, which needs a real `docker` binary
# and daemon access; from inside this container that spawn fails with `spawn docker ENOENT`
# (surfaced as a normal HTTP 200 with `ok:false` and that text in `output`, not an HTTP error — see
# `apps/api/src/lib/subprocess.ts`). Run those actions by running this API on the
# HOST instead (`yarn workspace @quant-fusion/api dev` or `start`), not via `docker
# compose` — see `scripts/up.sh`'s and `scripts/down.sh`'s own comments for how to switch between
# the two (both bind the same port 4410, so only one runs at a time). Giving this container real
# Docker access (mounting `/var/run/docker.sock`) was considered and rejected for now: it would
# grant the container root-equivalent control of the host's Docker daemon, a real privilege
# expansion not worth it for a single-developer local tool.
FROM node:25-alpine AS build
WORKDIR /app
COPY . .
RUN yarn install --frozen-lockfile
# node:25-alpine only ships POSIX sh/ash — scripts/build.sh needs real bash (it uses
# `set -euo pipefail`), so install it before running the script.
RUN apk add --no-cache bash
RUN bash scripts/build.sh

# A second, --production install (skips typescript/vitest/eslint/prettier/tsx and every
# per-package devDependency) — same two-stage deps/build split the bot Dockerfiles
# (bots/stock-market-4/*/Dockerfile) already use, for the same reason: a smaller runtime image.
FROM node:25-alpine AS prod-deps
WORKDIR /app
COPY . .
RUN yarn install --frozen-lockfile --production

FROM node:25-alpine
WORKDIR /app
COPY --from=build /app .
COPY --from=prod-deps /app/node_modules ./node_modules
ENV NODE_ENV=production
ENV PORT=4410
EXPOSE 4410
CMD ["node", "apps/api/dist/index.js"]
