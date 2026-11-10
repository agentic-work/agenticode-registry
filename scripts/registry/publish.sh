#!/usr/bin/env bash
# Build index/index.json for the current commit, sign it, commit it, push main,
# and publish it as a GitHub Release (index-YYYY.MM.DD) with the signature.
# The commit that holds the vendored files must already be on main.
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
need gh "brew install gh"
[ -z "$(git status --porcelain -- ':!index/index.json' ':!index/index.json.minisig' ':!.claude-plugin/marketplace.json' ':!THIRD_PARTY.md')" ] || { echo "commit the picks first (working tree is not clean)" >&2; git status --short | head >&2; exit 1; }
git push -q origin HEAD:main
COMMIT=$(git rev-parse HEAD)
VERSION="${VERSION:-$(date -u +%Y.%m.%d)}"
if gh release view "index-$VERSION" >/dev/null 2>&1; then n=1; while gh release view "index-$VERSION.$n" >/dev/null 2>&1; do n=$((n+1)); done; VERSION="$VERSION.$n"; fi
bun index/build.ts --version "$VERSION" --commit "$COMMIT"
sign_index
git add index/index.json index/index.json.minisig .claude-plugin/marketplace.json THIRD_PARTY.md
git commit -q -m "index $VERSION (picks at ${COMMIT:0:7})"
git push -q origin HEAD:main
NOTES=$(jq -r '"Signed agenticode Registry index \(.version).\n\nPicks pinned at registry commit \(.registry.commit[0:7]). Counts: \(.counts | to_entries | map("\(.key) \(.value)") | join(", ")).\n\nVerify: minisign -Vm index.json -P " + "'"$(tail -1 keys/registry.pub)"'"' index/index.json)
gh release create "index-$VERSION" index/index.json index/index.json.minisig keys/registry.pub --title "Index $VERSION" --notes "$NOTES" --latest
echo "published index $VERSION"
