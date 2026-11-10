# agenticode Registry

Our curated catalog of **skills, agents, MCP servers and plugins** for [agenticode](https://github.com/agentic-work/agenticode-releases). We cherry-pick the best from the top ecosystems, pin each pick to a reviewed commit, test it inside agenticode, and publish a **signed index**. agenticode installs from that index natively; no other marketplace is needed.

```
agenticode add skill test-driven-development
agenticode add mcp context7
agenticode add agent code-simplifier --project
agenticode store search "postgres"
agenticode store update      # moves installed items only to reviewed commits
agenticode store doctor      # re-verifies checksums and MCP handshakes
/store                       # the same, as a screen inside a session
```

## How it works

1. **Scout** (weekly, `scripts/registry/scout.sh`): ranks candidates from the Claude marketplace install feed, the MCP Registry and GitHub activity for openai/skills, hermes-agent, openclaw and clawhub. Writes `scout/candidates.md` (Add? / Drop? / Overlap / Watch).
2. **Pick** (a human): one `pick.yaml` per item with the upstream repo, the exact commit, the licence and why we want it.
3. **Vendor**: only where the licence allows redistribution (MIT, Apache-2.0, BSD, ISC, OFL for fonts) is the item copied here, at the pinned commit, with its licence kept beside it and credit in [`THIRD_PARTY.md`](THIRD_PARTY.md). Anything else is **link-only**: agenticode fetches it from upstream at the pinned commit. MCP servers are never copied; only their connection config lives here.
4. **Gate** (`scripts/registry/gate.sh`): licence (SPDX on every licence file and header), supply chain and secrets, a prompt-injection lint, and a real install test with agenticode in a throwaway home. An MCP must complete its handshake and list its tools. A pick that fails a gate is marked `status: blocked` with the reason; it is never dropped silently.
5. **Publish** (`scripts/registry/publish.sh`): `index/index.json` is built from the picks and gate results, signed with minisign and released. agenticode carries the public key and refuses an index it cannot verify.
6. **Install**: every file agenticode installs is checked against its sha256 in the signed index before anything lands.

**Keeping fresh:** `bump.sh` (daily) lists picks whose upstream moved past the pin, highlighting changes to skill/agent/command text; `bump.sh --apply <name>` re-vendors on a branch and re-runs the gates. `yank.sh <kind>/<name> "<advisory>"` withdraws a pick; agenticode turns it off at its next index read and says why.

GitHub Actions on agentic-work is blocked by billing, so these jobs run from `scripts/registry/*.sh` on the maintainer's Mac. The workflow files in `.github/workflows/` are ready to move over unchanged.

## Layout

```
skills/<name>/     SKILL.md …, pick.yaml, UPSTREAM.md      (ours: ours.yaml, README.md)
agents/<name>/     <name>.md, pick.yaml, UPSTREAM.md
mcp/<name>/        mcp.json, pick.yaml
plugins/<name>/    plugin/ (vendored tree), pick.yaml, entry.json, UPSTREAM.md
scout/             scout.ts, bump.ts, candidates.md, bumps.md, snapshots/
gates/             license.ts, scan.ts, lint.ts, install.ts, apply.ts, results/
index/             build.ts, index.json, index.json.minisig   (generated; never edited by hand)
.claude-plugin/    marketplace.json  (generated; agenticode installs plugins through it)
keys/registry.pub  the minisign public key
LICENSES/  THIRD_PARTY.md
```

## Status values

| status | meaning |
| --- | --- |
| `ok` | passed every gate; installable |
| `blocked` | failed a gate; `blocked_reason` says which and why |
| `replace` | covered by our own tool (for example Brainbow for anything that drives a browser or desktop); nothing is copied or installed |
| `exclude` | deliberately not offered (for example credential managers: agents never handle credentials) |
| `built-in` / `planned` | our own items (`owner: agentic-work`) |

## Verifying the index yourself

```
minisign -Vm index.json -P RWTcXi9TkOlFT3Wse/GL0K15FVNAAk2n7c7Kc15ZoqeHMc588OMAqjhN
```

The trusted comment names the index version and the registry commit it was built from.

## Licence

This repository's own files are MIT ([LICENSE](LICENSE)). Vendored material keeps its upstream licence; see [THIRD_PARTY.md](THIRD_PARTY.md).
