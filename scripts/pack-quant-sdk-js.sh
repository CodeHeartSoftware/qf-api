#!/usr/bin/env bash
set -euo pipefail

# Packs @quant-fusion/quant-sdk-js into a tarball and vendors it into every bot that depends on it —
# the same mechanism scripts/pack-bot-sdk-js.sh already uses for @quant-fusion/bot-sdk-js (see that
# script's own comment for the full rationale: bots/** is deliberately not a Yarn workspace member,
# docs/adr/0001-monorepo-and-boundary.md, so a committed vendor/*.tgz installed via a
# "file:./vendor/..." dependency is what makes this a real, reproducible dependency for bots).
#
# Run this after changing packages/stock-market-4/quant-sdk-js, then commit the updated vendor/*.tgz and
# package-lock.json files. Re-runs `npm install` in every dependent bot itself (rather than leaving
# that to the caller) for the same non-byte-reproducible-tarball reason pack-bot-sdk-js.sh's own
# comment documents: `npm pack` embeds a timestamp, so re-packing identical source still changes
# the tarball's sha512, and `npm ci` (every bot's Dockerfile) enforces that hash strictly. Deletes
# each bot's package-lock.json/node_modules before reinstalling rather than just running `npm
# install` in place, for the same reason: an already-installed "file:" dependency at an unchanged
# declared version won't refresh its recorded integrity hash on its own.

cd "$(dirname "$0")/.."

yarn workspace @quant-fusion/quant-sdk-js run build

TARBALL_DIR=$(mktemp -d)
trap 'rm -rf "$TARBALL_DIR"' EXIT

(cd packages/stock-market-4/quant-sdk-js && npm pack --silent --pack-destination "$TARBALL_DIR" > /dev/null)
TARBALL=$(ls "$TARBALL_DIR"/quant-fusion-quant-sdk-js-*.tgz)

BOT_DIRS=(
  "bots/stock-market-4/quant-v0"
  "bots/stock-market-4/quant-lite"
)

for dir in "${BOT_DIRS[@]}"; do
  mkdir -p "$dir/vendor"
  cp "$TARBALL" "$dir/vendor/quant-fusion-quant-sdk-js.tgz"
  echo "vendored quant-sdk-js into $dir/vendor/quant-fusion-quant-sdk-js.tgz"
  rm -f "$dir/package-lock.json"
  rm -rf "$dir/node_modules"
  (cd "$dir" && npm install > /dev/null)
  echo "refreshed $dir/package-lock.json"
done
