// Daily bump: for each pick, compare its pinned commit with the upstream branch
// it follows (only commits touching the pick's own path count). Writes
// scout/bumps.md with the files that changed, highlighting skill / agent /
// command text, where prompt injection hides.
//   bun scout/bump.ts                 report only
//   bun scout/bump.ts --apply <name>  move <name> to the new commit on a branch
//                                     (bump/<name>-<date>) and re-gate
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ROOT, loadItems, type Item } from "../gates/lib";

const gh = (path: string): any => { const r = Bun.spawnSync(["gh", "api", path]); try { return r.exitCode ? null : JSON.parse(r.stdout.toString()); } catch { return null; } };
const applyName = process.argv.includes("--apply") ? process.argv[process.argv.indexOf("--apply") + 1] : null;
const picks = loadItems().filter(i => !i.ours && ["ok", "blocked"].includes(i.pick.status) && i.pick.from?.repo?.includes("/"));
const MODEL_TEXT = /(^|\/)(SKILL\.md|agents\/[^/]+\.md|commands\/[^/]+\.md|[^/]+\.md)$/;

type Bump = { it: Item; head: string; files: { name: string; status: string; adds: number; dels: number }[]; text: string[] };
const bumps: Bump[] = [];
const heads = new Map<string, string>();
for (const it of applyName ? picks.filter(p => p.pick.name === applyName) : picks) {
  const f = it.pick.from!;
  const branch = f.follows ?? "main";
  const key = `${f.repo}:${branch}:${f.path ?? ""}`;
  if (!heads.has(key)) heads.set(key, gh(`repos/${f.repo}/commits?sha=${branch}&per_page=1${f.path ? `&path=${encodeURIComponent(f.path)}` : ""}`)?.[0]?.sha ?? "");
  const head = heads.get(key)!;
  if (!head || head === f.commit) continue;
  const cmp = gh(`repos/${f.repo}/compare/${f.commit}...${head}`);
  if (!cmp || cmp.status === "identical" || cmp.status === "behind") continue;
  const prefix = f.path ? `${f.path}/` : "";
  const files = (cmp.files ?? []).filter((x: any) => !prefix || x.filename.startsWith(prefix)).map((x: any) => ({ name: x.filename.slice(prefix.length), status: x.status, adds: x.additions, dels: x.deletions }));
  if (!files.length) continue;
  bumps.push({ it, head, files, text: files.filter(x => MODEL_TEXT.test(x.name)).map(x => x.name) });
}

const out = [`# Bumps ${new Date().toISOString().slice(0, 10)}`, "", bumps.length ? `${bumps.length} pick(s) whose upstream moved past the pinned commit. Nothing is merged automatically: \`scripts/registry/bump.sh --apply <name>\` moves one pin on a branch and re-runs its gates.` : "Every pick is at its upstream's latest commit for its path.", ""];
for (const b of bumps) {
  const f = b.it.pick.from!;
  out.push(`## ${b.it.id}`, "", `[${f.commit.slice(0, 7)}…${b.head.slice(0, 7)}](https://github.com/${f.repo}/compare/${f.commit}...${b.head}) · ${b.files.length} file(s)${b.text.length ? ` · **model-facing text changed: ${b.text.slice(0, 8).join(", ")}**` : ""}`, "");
  for (const x of b.files.slice(0, 30)) out.push(`- ${x.status} \`${x.name}\` (+${x.adds} −${x.dels})`);
  out.push("");
}
mkdirSync(join(ROOT, "scout"), { recursive: true });
writeFileSync(join(ROOT, "scout", "bumps.md"), out.join("\n"));
console.log(`${bumps.length} pick(s) moved upstream; see scout/bumps.md`);

if (applyName) {
  const b = bumps.find(x => x.it.pick.name === applyName);
  if (!b) { console.log(`${applyName}: nothing to bump`); process.exit(0); }
  const it = b.it, p = it.pick, f = p.from!;
  const branch = `bump/${p.name}-${new Date().toISOString().slice(0, 10)}`;
  if (Bun.spawnSync(["git", "-C", ROOT, "switch", "-c", branch]).exitCode) throw new Error(`could not create ${branch}`);
  // nothing is copied here: moving the pin is the whole bump; the gates then
  // re-read every file from upstream at the new commit
  const y = readFileSync(join(it.dir, "pick.yaml"), "utf8").replace(`commit: ${f.commit}`, `commit: ${b.head}`);
  writeFileSync(join(it.dir, "pick.yaml"), y);
  const g = Bun.spawnSync(["bash", join(ROOT, "scripts/registry/gate.sh"), it.id], { stdout: "inherit", stderr: "inherit" });
  Bun.spawnSync(["git", "-C", ROOT, "add", "-A", it.dir, "gates/results"]);
  Bun.spawnSync(["git", "-C", ROOT, "commit", "-q", "-m", `bump ${it.id} to ${b.head.slice(0, 7)}`]);
  console.log(`${branch}: ${it.id} → ${b.head.slice(0, 7)}; gates exited ${g.exitCode}. Review the diff, then merge to main and publish.`);
}
