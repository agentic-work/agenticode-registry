// Gate 2: supply chain, secrets and malware.
//  - gitleaks / osv-scanner when installed (skipped with a note when not)
//  - built-in secret patterns over everything we ship
//  - pinned versions for MCP packages, and OSV advisories for them (api.osv.dev)
//  - deprecated / archived upstreams
//  - install-time scripts (postinstall etc.) fail unless the pick says why
//  - network hosts in shipped scripts that the pick does not declare (warning)
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { installable, loadItems, payload, selected, writeResults, type GateResult, type Item } from "./lib";

const which = (b: string) => Bun.spawnSync(["bash", "-c", `command -v ${b}`]).exitCode === 0;
const tools = { gitleaks: which("gitleaks"), osv: which("osv-scanner") };
const offline = process.argv.includes("--offline");

const SECRET_PATTERNS: [string, RegExp][] = [
  ["aws-access-key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["slack-token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["openai-key", /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{32,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["private-key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ["stripe-live-key", /\b[sr]k_live_[0-9A-Za-z]{20,}\b/],
];
const PLACEHOLDER = /(x{6,}|\.\.\.|<[^>]+>|your[_-]|example|EXAMPLE|dummy|fake|redacted|0{8,})/;
const COMMON_HOSTS = /(^|\.)(github\.com|githubusercontent\.com|npmjs\.(com|org)|pypi\.org|python\.org|localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|w3\.org|schema\.org|json-schema\.org|modelcontextprotocol\.io|anthropic\.com|claude\.ai|claude\.com|openai\.com|mozilla\.org)$/;

async function osvQuery(ecosystem: string, name: string, version: string): Promise<string[]> {
  const r = await fetch("https://api.osv.dev/v1/query", { method: "POST", body: JSON.stringify({ package: { name, ecosystem }, version }) });
  if (!r.ok) throw new Error(`osv ${r.status}`);
  const j: any = await r.json();
  return (j.vulns ?? []).map((v: any) => v.id);
}
function mcpPackage(cfg: any): { eco: string; name: string; version: string | null; raw: string } | null {
  const a: string[] = cfg.args ?? [];
  if (cfg.command === "npx") { const s = a.find(x => !x.startsWith("-") && x !== "npx")!; const m = s.match(/^(@?[^@]+)(?:@(.+))?$/)!; return { eco: "npm", name: m[1], version: m[2] && m[2] !== "latest" ? m[2] : null, raw: s }; }
  if (cfg.command === "uvx") {
    const from = a.indexOf("--from"); const s = from >= 0 ? a[from + 1] : a.find(x => !x.startsWith("-"))!;
    if (s.startsWith("git+")) return { eco: "git", name: s, version: /@[0-9a-f]{40}$/.test(s) ? s.split("@").pop()! : null, raw: s };
    const m = s.match(/^([\w.-]+)(?:==(.+))?$/)!; return { eco: "PyPI", name: m[1], version: m[2] ?? null, raw: s };
  }
  return null;
}

async function scanItem(it: Item): Promise<GateResult> {
  const p = it.pick;
  const findings: string[] = [], warns: string[] = [];
  if (p.kind === "mcp") {
    const cfg = JSON.parse(readFileSync(join(it.dir, "mcp.json"), "utf8")).mcpServers[p.name];
    if (cfg.type === "stdio") {
      const pkg = mcpPackage(cfg);
      if (!pkg) warns.push(`runs ${cfg.command} directly`);
      else if (!pkg.version) findings.push(`unpinned package ${pkg.raw}`);
      else if (!offline && pkg.eco !== "git") {
        const ids = await osvQuery(pkg.eco, pkg.name, pkg.version);
        if (ids.length) findings.push(`OSV advisories for ${pkg.name}@${pkg.version}: ${ids.join(", ")}`);
        if (pkg.eco === "npm") {
          const dep = Bun.spawnSync(["npm", "view", `${pkg.name}@${pkg.version}`, "deprecated"]).stdout.toString().trim();
          if (dep) findings.push(`npm marks ${pkg.name}@${pkg.version} deprecated: ${dep}`);
        }
      }
    } else {
      if (/^\$\{/.test(String(cfg.url))) warns.push(`host comes from ${String(cfg.url).match(/^\$\{([^}:]+)/)![1]} (your own instance)`);
      else try { const h = new URL(String(cfg.url).replace(/\$\{[^}]+\}/g, "env")).hostname; p.hosts = [...(p.hosts ?? []), h]; } catch { warns.push("url is not parseable"); }
    }
    if (!offline && p.from?.repo && p.from.repo.includes("/")) {
      const r = Bun.spawnSync(["gh", "api", `repos/${p.from.repo}`, "--jq", ".archived"]);
      if (r.stdout.toString().trim() === "true") findings.push(`upstream ${p.from.repo} is archived`);
    }
    return findings.length ? { status: "fail", detail: findings.join("; ") } : warns.length ? { status: "warn", detail: warns.join("; ") } : { status: "pass", detail: cfg.type === "stdio" ? "pinned, no advisories" : `remote ${p.hosts?.join(", ")}` };
  }

  const pl = payload(it)!;
  const hosts = new Set<string>();
  for (const { p: f, abs } of pl.files) {
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // binary (fonts, images)
    const text = buf.toString("utf8");
    for (const [id, re] of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m && !PLACEHOLDER.test(text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40))) {
        if (p.scan_allow?.[f]) warns.push(`${id} in ${f} allowed after review: ${p.scan_allow[f]}`);
        else findings.push(`${id} in ${f}`);
      }
    }
    if (f.split("/").pop() === "package.json") {
      try {
        const s = JSON.parse(text).scripts ?? {};
        for (const k of ["preinstall", "install", "postinstall", "prepare"]) if (s[k] && !p.postinstall_ok) findings.push(`${f} has a ${k} script (${String(s[k]).slice(0, 60)}) and the pick does not say why`);
      } catch { /* not json */ }
    }
    if (/\.(py|js|mjs|cjs|ts|sh|bash)$/.test(f)) for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
  }
  if (tools.gitleaks) {
    const r = Bun.spawnSync(["gitleaks", "dir", pl.base, "--no-banner", "--redact", "--exit-code", "3"]);
    if (r.exitCode === 3) findings.push("gitleaks found leaks");
  }
  if (tools.osv && pl.files.some(({ p: f }) => /(package-lock\.json|requirements\.txt|uv\.lock|poetry\.lock|pnpm-lock\.yaml|bun\.lock)$/.test(f))) {
    const r = Bun.spawnSync(["osv-scanner", "scan", "source", "-r", pl.base]);
    if (r.exitCode === 1) findings.push("osv-scanner found vulnerabilities");
  }
  const declared = new Set((p.hosts ?? []).map(h => h.toLowerCase()));
  const undeclared = [...hosts].filter(h => !COMMON_HOSTS.test(h) && !declared.has(h) && ![...declared].some(d => h.endsWith("." + d)));
  if (undeclared.length) warns.push(`scripts reach hosts the pick does not declare: ${undeclared.slice(0, 6).join(", ")}${undeclared.length > 6 ? ` (+${undeclared.length - 6})` : ""}`);
  if (findings.length) return { status: "fail", detail: findings.join("; ") };
  return warns.length ? { status: "warn", detail: warns.join("; "), hosts: undeclared } : { status: "pass", detail: "no secrets, no install scripts" };
}

const results: Record<string, GateResult> = {};
for (const it of selected(loadItems()).filter(installable)) {
  try { results[it.id] = await scanItem(it); } catch (e: any) { results[it.id] = { status: "fail", detail: e.message }; }
}
const note = `gitleaks ${tools.gitleaks ? "ran" : "not installed: skipped (built-in secret patterns ran instead)"}; osv-scanner ${tools.osv ? "ran" : "not installed: skipped (pinned MCP packages were checked against api.osv.dev instead)"}`;
writeResults("scan", results, { tools: note, offline });
const c = (s: string) => Object.values(results).filter(r => r.status === s).length;
console.log(`scan: ${c("pass")} pass, ${c("warn")} warn, ${c("fail")} fail  (${note})`);
for (const [id, r] of Object.entries(results)) if (r.status !== "pass") console.log(`  ${r.status.padEnd(4)} ${id}: ${r.detail}`);
