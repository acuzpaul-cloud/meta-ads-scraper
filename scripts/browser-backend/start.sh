#!/usr/bin/env bash
set -eu
cd "$(git rev-parse --show-toplevel)"
umask 077
state="/workspaces/.tucoiva-browser"
if ! mkdir -p "$state" 2>/dev/null; then
  sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$state"
fi
node_modules/.bin/tsc -p scripts/browser-backend/tsconfig.json
# flock prevents two servers from owning the persistent profile after a restart.
nohup flock -n "$state/backend.lock" env AD_PROFILE_DIR="$state/profile" \
  node scripts/browser-backend/server.mjs \
  >"$state/backend.log" 2>&1 </dev/null &
if [[ "${CODESPACES:-}" = true ]]; then
  nohup bash scripts/browser-backend/connect.sh --auto >"$state/pairing.log" 2>&1 </dev/null &
fi
