// Builds index/index.json (what agenticode installs from), the plugin
// marketplace manifest (.claude-plugin/marketplace.json) and THIRD_PARTY.md from
// the picks and the latest gate results. Never edit the outputs by hand.
//   bun index/build.ts [--version 2026.11.10] [--commit <registry commit>]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { MARKETPLACE_NAME, REGISTRY_REPO, ROOT, hashDir, loadItems, payload, readResults, sha256, treeHash, type Item } from "../gates/lib";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const version = arg("--version") ?? today;
const commit = arg("--commit") ?? Bun.spawnSync(["git", "-C", ROOT, "rev-parse", "HEAD"]).stdout.toString().trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("need the registry commit that holds the vendored files (commit first, or pass --commit)");

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const gates = Object.fromEntries(["license", "scan", "lint", "install", "cost"].map(g => [g, readResults(g)?.results ?? {}]));
const gateMeta = { scan: readResults("scan")?.tools, install: readResults("install")?.agenticode };

function tokensIdle(it: Item, files: { p: string }[], base?: string): number | null {
  // what the model carries while the item is idle: names + descriptions of
  // each skill / agent / command (frontmatter), roughly 4 characters a token
  if (it.pick.kind === "mcp") return gates.cost[it.id]?.tokens_idle ?? null;
  if (!base) return null;
  let chars = 0;
  for (const f of files) {
    if (!/(^|\/)(SKILL\.md|[^/]+\.md)$/.test(f.p)) continue;
    const isEntry = /(^|\/)SKILL\.md$/.test(f.p) || /(^|\/)(agents|commands)\/[^/]+\.md$/.test(f.p) || (it.pick.kind === "agent");
    if (!isEntry) continue;
    const m = readFileSync(join(base, f.p), "utf8").match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const fm = m[1].match(/^(name|description):.*(\n[ \t]+.*)*$/gm)?.join(" ") ?? "";
    chars += fm.length;
  }
  return chars ? Math.round(chars / 4) : null;
}

const items: any[] = [];
const marketplace: any[] = [];
const third: string[] = [];
for (const it of loadItems()) {
  const p = it.pick;
  const g = (name: string) => gates[name][it.id]?.status ?? "not run";
  const entry: any = {
    id: it.id, kind: p.kind, name: p.name, ...(p.type ? { type: p.type } : {}), source: p.source,
    ...(p.owner ? { owner: p.owner } : {}), ...(p.category ? { category: p.category } : {}),
    desc: p.description ?? "", ...(p.why && p.why !== p.description ? { why: p.why } : {}), ...(p.note ? { note: p.note } : {}),
    v: p.version ?? (p.from?.commit ? p.from.commit.slice(0, 7) : "0"),
    status: p.status, ...(p.blocked_reason ? { reason: p.blocked_reason } : {}),
    ...(p.replaced_by !== undefined ? { replaced_by: p.replaced_by } : {}), yanked: p.yanked ?? null,
    ...(p.from ? { src: `${p.from.repo}#${p.from.commit.slice(0, 7)}`, commit: p.from.commit } : {}),
    lic: p.license ?? null, vendor: !!p.vendor, installs: p.installs ?? null,
    gates: { license: g("license"), scan: g("scan"), lint: g("lint"), mac: g("install"), linux: "not run", win: "not run" },
    ...(p.where ? { where: p.where } : {}),
  };
  if (p.status === "ok" || p.status === "blocked") {
    if (p.kind === "mcp") {
      const cfg = JSON.parse(readFileSync(join(it.dir, "mcp.json"), "utf8")).mcpServers[p.name];
      const { env: _env, ...declared } = p.install ?? {};
      if (canonicalJson(declared) !== canonicalJson(cfg)) throw new Error(`${it.id}: pick.yaml install and mcp.json disagree`);
      entry.mcp = cfg; entry.sha256 = sha256(canonicalJson(cfg));
      if (p.install?.env?.length) entry.env = p.install.env;
      entry.tools = gates.install[it.id]?.tools?.length ?? null;
      entry.tokens_idle = tokensIdle(it, []);
    } else {
      const pl = payload(it)!;
      const files = hashDir(pl.base, pl.files);
      entry.sha256 = treeHash(files);
      entry.tokens_idle = tokensIdle(it, files, pl.base);
      if (p.kind === "plugin") {
        entry.plugin = { marketplace: MARKETPLACE_NAME, files: files.length };
        if (p.status === "ok") {
          const extra = existsSync(join(it.dir, "entry.json")) ? JSON.parse(readFileSync(join(it.dir, "entry.json"), "utf8")) : {};
          marketplace.push({ ...extra, name: p.name, description: p.description ?? extra.description, ...(p.version ? { version: p.version } : {}), category: (p.category ?? "").toLowerCase() || undefined,
            source: p.vendor ? `./${pl.regPath}` : p.install.upstream });
        }
      } else {
        entry.files = files;
        entry.fetch = pl.origin === "registry" ? { base: "registry", repo: REGISTRY_REPO, commit, path: pl.regPath } : { base: "upstream", ...pl.up };
      }
    }
  }
  if (!it.ours && p.vendor) {
    third.push(`| \`${it.id}\` | [${p.from!.repo}](https://github.com/${p.from!.repo}/tree/${p.from!.commit}${p.from!.path ? `/${p.from!.path}` : ""}) | \`${p.from!.commit.slice(0, 7)}\` | ${p.license} | ${p.license_file ? `\`${it.dir.slice(ROOT.length + 1)}/${p.license_file}\`` : "-"} |`);
  }
  items.push(entry);
}

const kept = items.filter(i => !i.owner && ["ok", "blocked"].includes(i.status));
const counts = {
  items: items.length,
  picks: kept.length,
  ok: items.filter(i => i.status === "ok" && !i.owner).length,
  vendored: kept.filter(i => i.vendor).length,
  link_only: kept.filter(i => !i.vendor).length,
  blocked: items.filter(i => i.status === "blocked").length,
  replaced: items.filter(i => i.status === "replace").length,
  excluded: items.filter(i => i.status === "exclude").length,
  ours_built: items.filter(i => i.owner && (i.status === "built-in" || i.status === "ok")).length,
  ours_planned: items.filter(i => i.owner && i.status === "planned").length,
  skills: items.filter(i => i.kind === "skill").length, agents: items.filter(i => i.kind === "agent").length,
  mcp: items.filter(i => i.kind === "mcp").length, plugins: items.filter(i => i.kind === "plugin").length,
};
const index = {
  schema: 1, name: "agenticode-registry", version, generated_at: new Date().toISOString(),
  registry: { repo: REGISTRY_REPO, commit, raw: `https://raw.githubusercontent.com/${REGISTRY_REPO}/${commit}/` },
  gates_note: { platforms: "install tests ran on macOS (this Mac); Linux and Windows runners are not set up yet", ...gateMeta },
  counts, items,
};
mkdirSync(join(ROOT, "index"), { recursive: true });
writeFileSync(join(ROOT, "index", "index.json"), JSON.stringify(index, null, 1) + "\n");
mkdirSync(join(ROOT, ".claude-plugin"), { recursive: true });
writeFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), JSON.stringify({
  name: MARKETPLACE_NAME, description: "agenticode Registry: curated, pinned and gated plugins (generated from the picks; do not edit)",
  owner: { name: "agentic-work", url: "https://github.com/agentic-work" }, plugins: marketplace.sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2) + "\n");
writeFileSync(join(ROOT, "THIRD_PARTY.md"), `# Third-party material

Generated by \`index/build.ts\`; do not edit by hand.

Everything below was copied ("vendored") from its upstream at the pinned commit, under the upstream licence, which is kept next to the copy. All credit belongs to the upstream authors. Picks marked link-only in the index are **not** copied here: agenticode installs them straight from upstream at the pinned commit and checks every file's sha256 against the signed index.

| Item | Upstream | Commit | Licence | Licence file here |
| --- | --- | --- | --- | --- |
${third.sort().join("\n")}

Some vendored items carry further notices of their own (for example the OFL font licences inside \`skills/canvas-design/canvas-fonts/\` and \`plugins/aws-core/plugin/UPSTREAM-NOTICE\`); those files are kept unchanged.
`);
console.log(`index ${version} @ ${commit.slice(0, 7)}: ${JSON.stringify(counts)}`);
