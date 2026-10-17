#!/usr/bin/env bash
# Kills whatever's listening on this API's port on the HOST (a `yarn dev`/`tsx watch` or `yarn
# start`/`node dist/index.js` process) — the counterpart to docker:up/docker:down for resources
# created outside Docker. up.sh's own comment already calls this out: a host-run copy and the
# Docker container can't both hold the port at once, so this is what to run before docker:up, or
# any time a leftover/crashed dev server is still bound to the port. Same `PORT` env var
# convention `src/index.ts` itself uses, same default (4410) — never hardcoded independently.
set -euo pipefail

PORT="${PORT:-4410}"

pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"

if [ -z "$pids" ]; then
  echo "Nothing listening on port $PORT."
  exit 0
fi

echo "Killing process(es) on port $PORT: $pids"
# shellcheck disable=SC2086
kill $pids
