#!/usr/bin/env bash
# Run every gate over the picks (or the ones named): licence, scan, a signed draft
# index, the real install test with agenticode, the prompt-injection lint (which
# also reads MCP tool descriptions captured by the install test), then mark
# failing picks blocked.   scripts/registry/gate.sh [--offline] [kind/name ...]
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
OFFLINE=""; ARGS=()
for a in "$@"; do [ "$a" = "--offline" ] && OFFLINE="--offline" || ARGS+=("$a"); done
bun gates/license.ts "${ARGS[@]+"${ARGS[@]}"}"
bun gates/scan.ts $OFFLINE "${ARGS[@]+"${ARGS[@]}"}"
draft() { bun index/build.ts --commit 0000000000000000000000000000000000000000 >/dev/null && sign_index; }
draft
if [ -z "$OFFLINE" ]; then bun gates/install.ts "${ARGS[@]+"${ARGS[@]}"}"; fi
bun gates/lint.ts "${ARGS[@]+"${ARGS[@]}"}"
bun gates/apply.ts
draft
echo "gates done; draft index signed (publish.sh builds the real one)"
