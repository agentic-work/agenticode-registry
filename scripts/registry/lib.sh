# shared by the registry scripts; source it
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY="${REGISTRY_SIGNING_KEY:-$HOME/.studiorig-signing/registry/registry.key}"
export REGISTRY_CACHE="${REGISTRY_CACHE:-${TMPDIR:-/tmp}/agenticode-registry-cache}"
need() { command -v "$1" >/dev/null || { echo "missing $1 ($2)" >&2; exit 1; }; }
# sign index/index.json; the trusted comment binds version and commit
sign_index() {
  need minisign "brew install minisign"
  [ -f "$KEY" ] || { echo "no signing key at $KEY" >&2; exit 1; }
  local v c; v=$(jq -r .version "$ROOT/index/index.json"); c=$(jq -r .registry.commit "$ROOT/index/index.json")
  minisign -S -s "$KEY" -m "$ROOT/index/index.json" -x "$ROOT/index/index.json.minisig" \
    -c "agenticode registry index $v" -t "agenticode-registry version=$v commit=${c:0:12}" >/dev/null
  minisign -V -p "$ROOT/keys/registry.pub" -m "$ROOT/index/index.json" -x "$ROOT/index/index.json.minisig" -q
}
