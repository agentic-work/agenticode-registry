#!/usr/bin/env bash
# Withdraw a pick: yank.sh <kind>/<name> "<reason, e.g. GHSA-xxxx>" ; then publish.sh.
# agenticode turns a yanked item off the next time it reads the index, and says why.
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
[ $# -eq 2 ] || { echo "usage: yank.sh <kind>/<name> <reason>" >&2; exit 2; }
kind=${1%%/*}; name=${1#*/}
case $kind in skill) d=skills;; agent) d=agents;; mcp) d=mcp;; plugin) d=plugins;; *) echo "bad kind $kind" >&2; exit 2;; esac
f="$d/$name/pick.yaml"; [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
grep -v '^yanked:' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
printf 'yanked: %s\n' "$(jq -Rn --arg r "$2" '$r')" >> "$f"
git add "$f" && git commit -q -m "yank $1: $2"
echo "yanked $1; run scripts/registry/publish.sh to sign and release it"
