#!/usr/bin/env bash
# Opt-in pull of one path from a local Thunderdome checkout into this repo, with the same renames
# the fork applied (scripts/rebrand.pl). Leaves the result as an ordinary working-tree diff to
# review and commit — nothing is committed for you.
#
#   yarn upstream:sync <thunderdome-path> [--from <thunderdome-checkout>] [--ref <git-ref>]
#
# e.g. yarn upstream:sync packages/stock-market-4/market-data
#      yarn upstream:sync apps/stock-market-4-api/src/lib/newsAgent.ts --ref CodeHeart/main
#
# <thunderdome-path> is the path as it exists in THUNDERDOME (apps/stock-market-4-api/... maps to
# apps/api/... here). --from defaults to ../thunderdome; --ref defaults to that checkout's HEAD.
# Files deleted upstream are NOT deleted here — check `git status` and remove them yourself.
set -euo pipefail

SRC_PATH=""
FROM="../thunderdome"
REF="HEAD"
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    *) SRC_PATH="${1%/}"; shift ;;
  esac
done
[ -n "$SRC_PATH" ] || { echo "Usage: yarn upstream:sync <thunderdome-path> [--from <dir>] [--ref <ref>]" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FROM="$(cd "$REPO_ROOT" && cd "$FROM" && pwd)"
DEST_PATH="${SRC_PATH/#apps\/stock-market-4-api/apps/api}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$FROM" archive "$REF" -- "$SRC_PATH" | tar -x -C "$TMP"

# Migrations are byte-identical to Thunderdome's except their import specifier: an applied
# migration's SQL is checksummed, so renaming anything inside it (even a description string)
# would make every database that already applied it refuse to open.
find "$TMP/$SRC_PATH" -type f -path '*/migrations/0*.ts' -print0 \
  | xargs -0 perl -pi -e 's#\@thunderdome/sqlite-migrations#\@quant-fusion/sqlite-migrations#'
find "$TMP/$SRC_PATH" -type f ! -name '*.tgz' ! -name 'package-lock.json' ! -path '*/migrations/0*.ts' -print0 \
  | xargs -0 perl -pi "$REPO_ROOT/scripts/rebrand.pl"

if [ -d "$TMP/$SRC_PATH" ]; then
  mkdir -p "$REPO_ROOT/$DEST_PATH"
  cp -R "$TMP/$SRC_PATH/." "$REPO_ROOT/$DEST_PATH/"
else
  mkdir -p "$(dirname "$REPO_ROOT/$DEST_PATH")"
  cp "$TMP/$SRC_PATH" "$REPO_ROOT/$DEST_PATH"
fi

echo "Synced thunderdome@$(git -C "$FROM" rev-parse --short "$REF"):$SRC_PATH -> $DEST_PATH"
git -C "$REPO_ROOT" status --short -- "$DEST_PATH"
