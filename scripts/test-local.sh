#!/usr/bin/env bash
#
# Local test runner.
#
# Why this exists: macOS refuses to load an ad-hoc signed native addon
# (@rollup/rollup-darwin-arm64, esbuild) into a node process that carries its own
# hardened Team ID. Marvis' bundled node is exactly that — `npx vitest` from a shell
# whose PATH resolves to it fails with "different Team IDs" / "missing code signature".
#
# This script picks the first node whose signature is ad-hoc (no Team ID), which is
# what Homebrew ships, and runs vitest with it. Set NODE_BIN to override.
#
# Usage: scripts/test-local.sh [vitest args...]
set -euo pipefail
cd "$(dirname "$0")/.."

candidates=("${NODE_BIN:-}" /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)")

for candidate in "${candidates[@]}"; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  # Capture first, grep after: piping into `grep -q` makes codesign die of SIGPIPE,
  # and `set -o pipefail` would then read that as "no match".
  signature="$(codesign -dvvv "$candidate" 2>&1 || true)"
  if [[ "$signature" == *"TeamIdentifier=not set"* ]]; then
    echo "[test-local] node: $candidate" >&2
    exec "$candidate" ./node_modules/vitest/vitest.mjs run "$@"
  fi
done

echo "[test-local] no ad-hoc signed node found; install one via 'brew install node' or set NODE_BIN" >&2
exit 1
