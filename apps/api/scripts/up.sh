#!/usr/bin/env bash
# Builds and starts the quant-fusion-api container via the shared
# docker-compose.yml at the monorepo root (same file the UI's own up.sh uses).
# Binds the same port (4410) the local `yarn dev`/`node dist/index.js` flow uses, so stop any
# host-run copy first (see down.sh's sibling on the host side: just `kill` the node process) —
# both can't hold the port at once.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
docker compose -f docker-compose.yml up -d --build quant-fusion-api
