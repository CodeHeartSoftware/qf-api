#!/usr/bin/env bash
# Stops and removes the container up.sh started. The .quant-fusion/ SQLite file it mounts is a
# host bind mount, not a compose volume, so this never touches that data.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
docker compose -f docker-compose.yml stop quant-fusion-api
docker compose -f docker-compose.yml rm -f quant-fusion-api
