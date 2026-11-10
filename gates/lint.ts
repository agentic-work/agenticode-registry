// Gate 3: prompt-injection lint over the text a model reads (SKILL.md, agents,
// commands, references, and MCP tool descriptions captured by the install gate).
// Flags text that tells the model to skip approvals, read credentials, contact
// URLs the pick does not declare, override its instructions, or hide text.
// A reviewed false positive is allowed per pick with lint_allow: {"<file>#<rule>": "<why>"}.
import { readFileSync } from "fs";
import { join } from "path";
import { installable, loadItems, payload, readResults, selected, writeResults, type GateResult } from "./lib";

type Rule = { id: string; sev: "fail" | "warn"; re: RegExp; why: string };
const RULES: Rule[] = [
  { id: "skip-approvals", sev: "fail", why: "tells the model to skip or bypass approvals",
    re: /\b(skip|bypass|ignore|disable|turn off|suppress|circumvent)\b[^.\n]{0,40}\b(approvals?|permission (prompts?|checks?|requests?|dialogs?)|confirmations?|user consent)\b|--dangerously-skip-permissions|\bbypassPermissions\b|\bwithout (asking|waiting) (the user )?for (approval|permission|confirmation)\b|\bdo(n'?t| not) ask (the user )?(for )?(permission|approval|confirmation)\b/i },
  { id: "read-credentials", sev: "fail", why: "tells the model to read or send credentials",
    re: /\b(cat|read|open|print|dump|copy|upload|send|exfiltrate|base64)\b[^\n]{0,60}(~\/\.ssh\/|\bid_(rsa|ed25519)\b|\.aws\/credentials|\.netrc\b|\.git-credentials|\.docker\/config\.json|security find-(generic|internet)-password|cookies\.sqlite|Login Data|\.config\/gh\/hosts\.yml)/i },
  { id: "env-exfil", sev: "fail", why: "pipes the environment or secrets to the network",
    re: /\b(printenv|env|set)\b\s*\|\s*(curl|nc|ncat|wget)\b|\$\{?[A-Z_]*(TOKEN|SECRET|API_KEY|PASSWORD)\}?[^\n]{0,40}\b(curl|wget)\b[^\n]{0,40}https?:\/\//i },
  { id: "override-instructions", sev: "fail", why: "tries to override the system or user instructions",
    re: /\bignore (all |any )?(the )?(previous|prior|above|earlier|system) (instructions|rules|prompt)\b|\bdisregard (the |all )?(system|previous|prior) (prompt|instructions)\b|\byou are no longer bound\b|\bnew system prompt\b/i },
  { id: "hidden-text", sev: "fail", why: "contains invisible characters or a hidden instruction comment",
    re: /[​-‏‪-‮⁦-⁩-]|<!--[^>]{0,400}\b(ignore|assistant|model|instruction|system prompt)\b[^>]{0,400}-->/i },
  { id: "contact-url", sev: "warn", why: "tells the model to send or fetch data from a URL the pick does not declare",
    re: /\b(curl|wget|POST|upload|webhook|send (it|this|the \w+) to)\b[^\n]{0,80}https?:\/\/([a-z0-9.-]+)/gi },
];
const COMMON = /(^|\.)(github\.com|githubusercontent\.com|localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|your-[\w-]+\.\w+|npmjs\.(com|org)|pypi\.org)$/i;

const tools = readResults("install")?.results ?? {};
const results: Record<string, GateResult> = {};
for (const it of selected(loadItems()).filter(installable)) {
  const p = it.pick;
  const texts: [string, string][] = [];
  if (p.kind === "mcp") {
    for (const t of tools[it.id]?.tools ?? []) texts.push([`tool:${t.name}`, `${t.name}: ${t.description ?? ""}`]);
  } else {
    const pl = payload(it)!;
    for (const f of pl.files) if (/\.(md|mdc|txt|ya?ml)$/i.test(f) && !/(^|\/)(LICEN[CS]E|UPSTREAM-LICENSE|CHANGELOG|NOTICE)/i.test(f)) texts.push([f, readFileSync(join(pl.base, f), "utf8")]);
  }
  const declared = new Set((p.hosts ?? []).map(h => h.toLowerCase()));
  const hits: { file: string; rule: string; sev: string; line: number; text: string; allowed?: string }[] = [];
  for (const [file, text] of texts) {
    const lines = text.split("\n");
    for (const r of RULES) {
      const re = new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : r.re.flags + "g");
      for (const m of text.matchAll(re)) {
        if (r.id === "contact-url") { const h = (m[4] ?? "").toLowerCase(); if (!h || COMMON.test(h) || declared.has(h) || [...declared].some(d => h.endsWith("." + d))) continue; }
        const line = text.slice(0, m.index).split("\n").length;
        const allowed = p.lint_allow?.[`${file}#${r.id}`] ?? p.lint_allow?.[`*#${r.id}`];
        hits.push({ file, rule: r.id, sev: r.sev, line, text: lines[line - 1].trim().slice(0, 160), allowed });
      }
    }
  }
  const live = hits.filter(h => !h.allowed);
  const fails = live.filter(h => h.sev === "fail"), warns = live.filter(h => h.sev === "warn");
  const fmt = (h: typeof hits[0]) => `${h.rule} ${h.file}:${h.line} "${h.text}"`;
  results[it.id] = fails.length ? { status: "fail", detail: fails.slice(0, 3).map(fmt).join(" | "), hits }
    : warns.length ? { status: "warn", detail: warns.slice(0, 3).map(fmt).join(" | "), hits }
    : { status: "pass", detail: `${texts.length} text file(s)${hits.length ? `, ${hits.length} reviewed exception(s)` : ""}`, ...(hits.length ? { hits } : {}) };
  if (p.kind === "mcp" && !texts.length) results[it.id] = { status: "skip", detail: "no tool descriptions captured yet (needs the install gate)" };
}
writeResults("lint", results);
const c = (s: string) => Object.values(results).filter(r => r.status === s).length;
console.log(`lint: ${c("pass")} pass, ${c("warn")} warn, ${c("fail")} fail, ${c("skip")} skip`);
for (const [id, r] of Object.entries(results)) if (r.status === "fail" || r.status === "warn") console.log(`  ${r.status.padEnd(4)} ${id}: ${r.detail}`);
