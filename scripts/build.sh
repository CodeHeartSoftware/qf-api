#!/usr/bin/env bash
set -euo pipefail

# Yarn Classic's `workspaces run` does not guarantee topological order, and packages import
# each other's compiled output (dist/) — so this list is in dependency order: every package is
# built after everything it imports.
INDEPENDENT_PACKAGES=(
  "@quant-fusion/protocol"
  "@quant-fusion/rng"
  "@quant-fusion/sqlite-migrations"
  "@quant-fusion/research-core"
  "@quant-fusion/research-store"
  "@quant-fusion/fusion-universe"
  "@quant-fusion/market-data"
  "@quant-fusion/forward-match-store"
  "@quant-fusion/stock-market-4-db"
  "@quant-fusion/job-run-store"
  "@quant-fusion/engine"
  "@quant-fusion/game-stock-market-4"
  "@quant-fusion/research-fusion"
  "@quant-fusion/research-quantum"
  "@quant-fusion/quant-sdk-js"
  "@quant-fusion/runtime"
  "@quant-fusion/bot-sdk-js"
  "@quant-fusion/game-sdk"
  "@quant-fusion/registry"
  "@quant-fusion/cli"
  "@quant-fusion/api"
)

for pkg in "${INDEPENDENT_PACKAGES[@]}"; do
  yarn workspace "$pkg" run build
done
