// Weekly scout: re-rank the sources and write scout/candidates.md with
//   Add?     new or fast-rising items in a source's top 150 that we do not carry
//   Drop?    picks that left the top 250, whose upstream is archived, untouched
//            for 6 months, or relicensed
//   Overlap  two picks doing the same job
//   Watch    upstreams we rewrote instead of copying (port the idea, not the text)
// Signals: the Claude marketplace install feed, the MCP Registry, GitHub stars
// for openai/skills, hermes-agent, openclaw and clawhub, and our own picks.
//   bun scout/scout.ts [--issue]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ROOT, loadItems } from "../gates/lib";

const SNAP = join(ROOT, "scout", "snapshots");
mkdirSync(SNAP, { recursive: true });
const gh = (path: string): any => { const r = Bun.spawnSync(["gh", "api", path]); try { return r.exitCode ? null : JSON.parse(r.stdout.toString()); } catch { return null; } };
const prevOf = (name: string) => { const f = join(SNAP, name); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const save = (name: string, v: any) => writeFileSync(join(SNAP, name), JSON.stringify(v, null, 1) + "\n");

const items = loadItems();
const carried = new Set(items.map(i => i.pick.name.toLowerCase()));
const picks = items.filter(i => !i.ours && ["ok", "blocked"].includes(i.pick.status));
const out: string[] = [`# Scout ${new Date().toISOString().slice(0, 10)}`, ""];

// --- Claude marketplace feed
const feed: any = await (await fetch("https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json")).json();
const ranked: { name: string; n: number; rank: number }[] = feed.plugins.map((p: any, i: number) => ({ name: p.plugin.replace(/@.*/, ""), n: p.unique_installs, rank: i + 1 }));
const prevFeed: Record<string, number> = prevOf("claude-installs.json")?.counts ?? {};
save("claude-installs.json", { generated_at: feed.generated_at, counts: Object.fromEntries(ranked.map(r => [r.name, r.n])) });
const growth = (r: { name: string; n: number }) => (prevFeed[r.name] ? (r.n - prevFeed[r.name]) / prevFeed[r.name] : null);
const add = ranked.filter(r => r.rank <= 150 && !carried.has(r.name.toLowerCase())).map(r => ({ ...r, g: growth(r) }))
  .sort((a, b) => (b.g ?? 0) - (a.g ?? 0) || a.rank - b.rank).slice(0, 20);
out.push("## Add?", "", `Claude marketplace feed of ${feed.generated_at.slice(0, 10)}: not carried, in the top 150${Object.keys(prevFeed).length ? ", fastest growing first" : " (first run: no growth figures yet)"}.`, "", "| # | Item | Installs | Growth since last scout |", "| --- | --- | --- | --- |");
for (const r of add) out.push(`| ${r.rank} | ${r.name} | ${r.n.toLocaleString("en-US")} | ${r.g == null ? "n/a" : `${(r.g * 100).toFixed(1)}%`} |`);

// --- MCP Registry: newest servers we do not carry
try {
  const reg: any = await (await fetch("https://registry.modelcontextprotocol.io/v0/servers?limit=100", { signal: AbortSignal.timeout(20_000) })).json();
  const servers = (reg.servers ?? []).map((s: any) => s.server ?? s).filter((s: any) => s?.name);
  const prevReg = new Set<string>(prevOf("mcp-registry.json")?.names ?? []);
  save("mcp-registry.json", { names: servers.map((s: any) => s.name) });
  const fresh = servers.filter((s: any) => !prevReg.has(s.name) && !carried.has(String(s.name).split("/").pop()!.toLowerCase()));
  out.push("", `MCP Registry: ${servers.length} servers on the first page, ${prevReg.size ? `${fresh.length} new since last scout` : "first run"}:`, "");
  for (const s of fresh.slice(0, 10)) out.push(`- \`${s.name}\`: ${String(s.description ?? "").slice(0, 100)}`);
} catch (e: any) { out.push("", `MCP Registry: not reachable (${e.message})`); }

// --- GitHub stars for the sources that publish no install counts
const repos = ["anthropics/skills", "openai/skills", "NousResearch/hermes-agent", "openclaw/openclaw", "openclaw/clawhub", "modelcontextprotocol/servers"];
const prevStars: Record<string, number> = prevOf("stars.json") ?? {};
const stars: Record<string, number> = {};
out.push("", "Source repos (stars):", "");
for (const r of repos) { const j = gh(`repos/${r}`); if (!j) continue; stars[r] = j.stargazers_count; out.push(`- ${r}: ${j.stargazers_count.toLocaleString("en-US")}${prevStars[r] ? ` (${j.stargazers_count - prevStars[r] >= 0 ? "+" : ""}${(j.stargazers_count - prevStars[r]).toLocaleString("en-US")})` : ""}`); }
save("stars.json", stars);

// --- Drop?
const rankOf = new Map(ranked.map(r => [r.name, r.rank]));
const drop: string[] = [];
const repoInfo = new Map<string, any>();
for (const it of picks) {
  const p = it.pick, f = p.from!;
  if (p.source === "Claude" && p.installs != null) { const rk = rankOf.get(p.name); if (!rk || rk > 250) drop.push(`- ${it.id}: left the Claude top 250 (rank ${rk ?? "gone"})`); }
  if (!repoInfo.has(f.repo)) repoInfo.set(f.repo, gh(`repos/${f.repo}`));
  const info = repoInfo.get(f.repo);
  if (info?.archived) drop.push(`- ${it.id}: upstream ${f.repo} is archived`);
  if (info?.pushed_at && Date.now() - Date.parse(info.pushed_at) > 182 * 864e5) drop.push(`- ${it.id}: upstream untouched since ${info.pushed_at.slice(0, 10)}`);
  const spdx = info?.license?.spdx_id;
  if (spdx && spdx !== "NOASSERTION" && p.vendor && p.license && !p.license.includes(spdx) && !["Hermes", "OpenClaw", "Codex"].includes(p.source) && !(p.from?.path ?? "").length) drop.push(`- ${it.id}: upstream licence now reads ${spdx} (pick says ${p.license})`);
  if (p.status === "blocked") drop.push(`- ${it.id}: blocked by the gates: ${p.blocked_reason}`);
}
out.push("", "## Drop?", "", ...(drop.length ? drop : ["Nothing."]));

// --- Overlap: shared description words within a category, plus notes that already say "compare"
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap: string[] = [];
for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
  const a = picks[i].pick, b = picks[j].pick;
  if (a.category !== b.category || (a.kind === "mcp") !== (b.kind === "mcp")) continue;
  if (a.type && a.type === b.type && ["lsp", "style"].includes(a.type)) continue; // one per language / style by design
  const wa = words(`${a.name} ${a.description}`), wb = words(`${b.name} ${b.description}`);
  const inter = [...wa].filter(w => wb.has(w)).length, uni = new Set([...wa, ...wb]).size;
  if (uni && inter / uni > 0.3) overlap.push(`- ${picks[i].id} ↔ ${picks[j].id} (${Math.round((inter / uni) * 100)}% shared wording)`);
}
for (const it of picks) if (/compare with|merge with/.test(it.pick.note ?? "")) overlap.push(`- ${it.id}: ${it.pick.note}`);
out.push("", "## Overlap", "", ...(overlap.length ? overlap : ["Nothing obvious."]));

// --- Watch: what we rewrote instead of copying
const watch = [
  { what: "office-docs", repo: "anthropics/skills", paths: ["skills/docx", "skills/pdf", "skills/pptx", "skills/xlsx"] },
  { what: "figma-bridge", repo: "figma/mcp-server-guide", paths: [""] },
  { what: "agenticode-setup", repo: "anthropics/claude-plugins-official", paths: ["plugins/claude-code-setup"] },
  { what: "brainbow", repo: "microsoft/playwright-mcp", paths: [""] },
];
const prevWatch: Record<string, string> = prevOf("watch.json") ?? {};
const nowWatch: Record<string, string> = {};
out.push("", "## Watch (ours, rewritten from upstream)", "");
for (const w of watch) for (const pth of w.paths) {
  const c = gh(`repos/${w.repo}/commits?per_page=1${pth ? `&path=${pth}` : ""}`)?.[0];
  if (!c) continue;
  const key = `${w.repo}/${pth}`; nowWatch[key] = c.sha;
  const moved = prevWatch[key] && prevWatch[key] !== c.sha;
  out.push(`- ${w.what} ← ${w.repo}${pth ? `/${pth}` : ""}: last change ${c.commit.committer.date.slice(0, 10)} "${c.commit.message.split("\n")[0].slice(0, 80)}"${moved ? " **(new since last scout: port the idea, not the text)**" : ""}`);
}
save("watch.json", nowWatch);

const md = out.join("\n") + "\n";
writeFileSync(join(ROOT, "scout", "candidates.md"), md);
console.log(md.split("\n").slice(0, 12).join("\n") + `\n… written to scout/candidates.md (${add.length} add, ${drop.length} drop, ${overlap.length} overlap)`);
if (process.argv.includes("--issue")) {
  const r = Bun.spawnSync(["gh", "issue", "create", "-R", "agentic-work/agenticode-registry", "-t", `Scout ${new Date().toISOString().slice(0, 10)}: candidates`, "-F", join(ROOT, "scout", "candidates.md")]);
  console.log(r.stdout.toString() || r.stderr.toString());
}
