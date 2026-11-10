#!/usr/bin/env bash
# Daily: find picks whose upstream moved past the pinned commit.
#   bump.sh               report only (scout/bumps.md)
#   bump.sh --apply NAME  re-vendor NAME at the new commit on a branch and run its gates
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
bun scout/bump.ts "$@"
