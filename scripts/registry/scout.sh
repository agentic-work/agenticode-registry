#!/usr/bin/env bash
# Weekly: re-rank the sources and write scout/candidates.md (Add? / Drop? / Overlap).
# --issue also opens it as a GitHub issue.
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
bun scout/scout.ts "$@"
