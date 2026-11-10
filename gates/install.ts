// Gate 4: the real install test. For every installable pick, a throwaway HOME,
// then the agenticode build installs it from the (signed, draft) index exactly
// as a user would: `agenticode add <kind> <name> --json`. Then it checks that
// agenticode itself sees the item: skill list / agents / plugin list / mcp list.
// An MCP must complete its handshake and list its tools (or reach its sign-in).
//
//   AGENTICODE_BIN   command to run agenticode (default: the source build)
//   bun gates/install.ts [kind/name ...] [--concurrency 6]
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { CACHE, ROOT, installable, loadItems, readResults, selected, writeResults, type GateResult, type Item } from "./lib";

const BIN = (process.env.AGENTICODE_BIN ?? "bun /Users/trenton/agenticode/src/entrypoints/cli.tsx").split(" ");
const conc = Number(process.argv[process.argv.indexOf("--concurrency") + 1]) || 6;
const homes = join(CACHE, "homes");
const shared = { npm_config_cache: join(CACHE, "npm-cache"), UV_CACHE_DIR: join(CACHE, "uv-cache") };
const version = Bun.spawnSync([...BIN, "--version"]).stdout.toString().trim();
// a real token lets the github MCP prove its tool list; it is passed only through the environment
const ghToken = Bun.spawnSync(["gh", "auth", "token"]).stdout.toString().trim();

async function run(args: string[], env: Record<string, string>, cwd: string, timeoutMs = 240_000) {
  const p = Bun.spawn([...BIN, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const t = setTimeout(() => p.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited; clearTimeout(t);
  return { code, out, err };
}
const lastJson = (s: string) => { const l = s.trim().split("\n").reverse().find(x => x.trim().startsWith("{")); try { return l ? JSON.parse(l) : null; } catch { return null; } };

async function gate(it: Item): Promise<GateResult> {
  const p = it.pick;
  const home = join(homes, it.id.replace("/", "__"));
  rmSync(home, { recursive: true, force: true }); mkdirSync(join(home, "work"), { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH!, HOME: home, TMPDIR: join(home, "tmp"), ...shared,
    AGENTICODE_STORE_INDEX_URL: join(ROOT, "index", "index.json"), AGENTICODE_STORE_REGISTRY_DIR: ROOT,
    DISABLE_AUTOUPDATER: "1", NO_COLOR: "1", AGENTICODE_STORE_GATE: "1", AGENTICODE_DISABLE_TELEMETRY: "1",
    ...(p.name === "github" && ghToken ? { GITHUB_PERSONAL_ACCESS_TOKEN: ghToken } : {}),
  };
  mkdirSync(env.TMPDIR, { recursive: true });
  const cwd = join(home, "work");
  try {
    const add = await run(["add", p.kind, p.name, "--json"], env, cwd);
    const res = lastJson(add.out) ?? lastJson(add.err);
    if (!res) return { status: "fail", detail: `add printed no result (exit ${add.code}): ${(add.err || add.out).trim().split("\n").slice(-2).join(" ").slice(0, 200)}` };
    if (!res.ok && !(p.kind === "mcp" && res.probe)) return { status: "fail", detail: res.steps?.filter((s: any) => s.ok === false).map((s: any) => s.text).join("; ") || "add failed" };
    if (p.kind === "skill") {
      const l = await run(["skill", "list", "--json"], env, cwd, 60_000);
      return l.out.includes(`"${p.name}"`) ? { status: "pass", detail: "installed; agenticode lists the skill" } : { status: "fail", detail: "installed but `skill list` does not show it" };
    }
    if (p.kind === "agent") {
      const l = await run(["agents"], env, cwd, 60_000);
      return l.out.includes(p.name) ? { status: "pass", detail: "installed; `agenticode agents` lists it" } : { status: "fail", detail: "installed but `agents` does not list it" };
    }
    if (p.kind === "plugin") {
      const l = await run(["plugin", "list", "--json"], env, cwd, 60_000);
      const id = `${p.name}@agenticode-registry`;
      let rows: any[] = []; try { rows = JSON.parse(l.out.slice(l.out.indexOf("["))); } catch { /* text */ }
      const row = rows.find(r => r.id === id || r.name === id);
      if (!row) return { status: "fail", detail: "installed but `plugin list` does not show it" };
      const errs = row.errors?.length ? `; load errors: ${JSON.stringify(row.errors).slice(0, 160)}` : "";
      return { status: errs ? "warn" : "pass", detail: `installed and ${row.enabled === false ? "disabled" : "enabled"} (sha256 matched)${errs}` };
    }
    // MCP: handshake + tools from `add`, and agenticode's own `mcp list` view
    const probe = res.probe ?? {};
    const list = await run(["mcp", "list"], env, cwd, 120_000);
    const line = list.out.split("\n").find(l => l.startsWith(`${p.name}:`))?.replace(/^.*? - /, "") ?? "not listed";
    const tools = probe.tools ?? [];
    const tokens = tools.reduce((a: number, t: any) => a + (t.size ?? 0), 0);
    if (probe.status === "connected") {
      const min = p.expects?.tools_min ?? 1;
      return tools.length >= min
        ? { status: "pass", detail: `handshake ok · ${tools.length} tools · mcp list: ${line}`, tools: tools.map((t: any) => ({ name: t.name, description: t.description })), tokens_idle: Math.round(tokens / 4) }
        : { status: "fail", detail: `handshake ok but ${tools.length} tools (expects ${min})` };
    }
    const missing = (p.install?.env ?? []).filter((v: string) => !env[v]);
    if (probe.status === "needs-auth") return { status: "needs-auth", detail: `handshake reached the server; it needs a sign-in to list tools · mcp list: ${line}` };
    if (missing.length) return { status: "needs-env", detail: `needs ${missing.join(", ")} (${probe.error ?? line})` };
    return { status: "fail", detail: `handshake failed: ${probe.error ?? line}` };
  } catch (e: any) {
    return { status: "fail", detail: e.message };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const todo = selected(loadItems()).filter(installable).filter(i => i.pick.status !== "blocked" || process.argv.includes("--blocked"));
const prev = readResults("install")?.results ?? {};
const results: Record<string, GateResult> = process.argv.slice(2).some(a => !a.startsWith("--")) ? { ...prev } : {};
let next = 0, done = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (next < todo.length) {
    const it = todo[next++];
    const r = await gate(it);
    results[it.id] = r; done++;
    console.log(`[${done}/${todo.length}] ${r.status.padEnd(10)} ${it.id}: ${r.detail}`);
  }
}));
rmSync(homes, { recursive: true, force: true });
writeResults("install", Object.fromEntries(Object.entries(results).sort()), { agenticode: version, platform: `${process.platform}-${process.arch}` });
const cost: Record<string, GateResult> = {};
for (const [id, r] of Object.entries(results)) if (r.tokens_idle != null) cost[id] = { status: "pass", tokens_idle: r.tokens_idle };
writeResults("cost", cost);
const c = (s: string) => Object.values(results).filter(r => r.status === s).length;
console.log(`install (${version}, ${process.platform}): ${c("pass")} pass, ${c("warn")} warn, ${c("needs-auth")} needs sign-in, ${c("needs-env")} needs env, ${c("fail")} fail`);
