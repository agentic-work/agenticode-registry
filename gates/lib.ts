// Shared helpers for the registry scripts (bun, no dependencies).
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

export const ROOT = resolve(import.meta.dir, "..");
export const KIND_DIRS = { skill: "skills", agent: "agents", mcp: "mcp", plugin: "plugins" } as const;
export type Kind = keyof typeof KIND_DIRS;
export const REGISTRY_REPO = "agentic-work/agenticode-registry";
export const MARKETPLACE_NAME = "agenticode-registry";
export const CACHE = process.env.REGISTRY_CACHE ?? join(tmpdir(), "agenticode-registry-cache");

/** Files in an item directory that describe the pick rather than being part of it. */
export const META_FILES = new Set(["pick.yaml", "ours.yaml", "UPSTREAM.md", "entry.json"]);

export const PERMISSIVE = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "OFL-1.1", "CC0-1.0"]);
export const COPYLEFT = /GPL|AGPL|LGPL|MPL|EUPL|CDDL|SSPL/;

export type Pick = {
  kind: Kind; name: string; type?: string; source: string; category?: string; group?: string;
  from?: { source: string; repo: string; commit: string; path?: string; file?: string; follows?: string };
  license?: string | null; license_file?: string; license_from?: string; vendor?: boolean; vendor_reason?: string; default?: boolean;
  status: "ok" | "blocked" | "replace" | "exclude" | "built-in" | "planned";
  blocked_reason?: string; replaced_by?: string | null; yanked?: string | null;
  installs?: number | null; version?: string; description?: string; why?: string; note?: string;
  install?: any; expects?: { tools_min?: number; readonly?: string[] };
  lint_allow?: Record<string, string>; scan_allow?: Record<string, string>; hosts?: string[]; postinstall_ok?: string;
  owner?: string; where?: string; use?: string; replaces?: string[];
};
export type Item = { id: string; dir: string; ours: boolean; pick: Pick };

export function loadItems(): Item[] {
  const out: Item[] = [];
  for (const [kind, kdir] of Object.entries(KIND_DIRS)) {
    const base = join(ROOT, kdir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const pf = existsSync(join(dir, "pick.yaml")) ? "pick.yaml" : existsSync(join(dir, "ours.yaml")) ? "ours.yaml" : null;
      if (!pf) continue;
      const pick = Bun.YAML.parse(readFileSync(join(dir, pf), "utf8")) as Pick;
      if (pick.kind !== kind) throw new Error(`${kdir}/${name}: kind ${pick.kind} does not match its folder`);
      if (pick.name !== name) throw new Error(`${kdir}/${name}: name ${pick.name} does not match its folder`);
      out.push({ id: `${kind}/${name}`, dir, ours: pf === "ours.yaml", pick });
    }
  }
  return out;
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Every file under dir (relative, sorted), skipping VCS folders and the pick's own metadata at the top. */
export function listFiles(dir: string, skipMeta = true): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else if (e.isFile()) { if (!(skipMeta && !rel && META_FILES.has(e.name))) out.push(r); }
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.sort();
}

export type FileEntry = { p: string; sha256: string; size: number };
/** The tree hash agenticode recomputes: sha256 over "<sha256>  <path>\n" lines, sorted by path. */
export function treeHash(files: FileEntry[]): string {
  return sha256([...files].sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)).map(f => `${f.sha256}  ${f.p}\n`).join(""));
}
export function hashDir(dir: string, files = listFiles(dir)): FileEntry[] {
  return files.map(p => { const b = readFileSync(join(dir, p)); return { p, sha256: sha256(b), size: b.length }; });
}
export function hashPayload(files: { p: string; abs: string }[]): FileEntry[] {
  return files.map(f => { const b = readFileSync(f.abs); return { p: f.p, sha256: sha256(b), size: b.length }; });
}

/**
 * A sparse, blobless git checkout of repo@commit holding only `paths`
 * (directories or files, repo-relative; none = the whole repo). Repeated calls
 * widen the same checkout. Git, not a tarball: export-ignore rules do not
 * apply, so the files are exactly what agenticode's git-based installs see.
 */
export function upstreamTree(repo: string, commit: string, paths?: string[]): string {
  const d = join(CACHE, `${repo.replace("/", "__")}-${commit.slice(0, 12)}`);
  const git = (...a: string[]) => {
    const r = Bun.spawnSync(["git", "-C", d, ...a], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (r.exitCode) throw new Error(`git ${a[0]} ${repo}@${commit.slice(0, 7)}: ${r.stderr.toString().trim().split("\n").pop()}`);
    return r.stdout.toString();
  };
  const want = join(d, ".git", "registry-paths");
  if (!existsSync(join(d, ".git"))) {
    mkdirSync(d, { recursive: true });
    git("init", "-q");
    git("remote", "add", "origin", `https://github.com/${repo}.git`);
    git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit);
    Bun.write(want, "");
  }
  const have = new Set(readFileSync(want, "utf8").split("\n").filter(Boolean));
  const add = paths === undefined ? ["/*"] : paths.map(p => (p ? `/${p.replace(/^\/+|\/+$/g, "")}` : "/*"));
  const before = have.size;
  for (const a of add) have.add(a);
  if (have.size !== before || !existsSync(join(d, ".git", "registry-checked-out"))) {
    git("sparse-checkout", "set", "--no-cone", ...[...have]);
    git("checkout", "-q", commit);
    writeFileSync(want, [...have].join("\n") + "\n");
    writeFileSync(join(d, ".git", "registry-checked-out"), commit);
  }
  return d;
}

export type PayloadFile = { p: string; abs: string; from?: { base: "registry" | "upstream"; path: string } };
export type Payload = { base: string; files: PayloadFile[]; up: { repo: string; commit: string; path: string } };

/**
 * What agenticode installs for a pick, file by file. Nothing is copied into
 * this repo: every file comes from the pick's upstream at the pinned commit,
 * plus the upstream licence when it lives outside the item's folder
 * (UPSTREAM-LICENSE) and our attribution note (UPSTREAM.md, from this repo).
 * MCP picks have no files (their config is the payload).
 */
export function payload(item: Item): Payload | null {
  const p = item.pick;
  if (p.kind === "mcp" || item.ours || ["replace", "exclude", "planned", "built-in"].includes(p.status)) return null;
  const f = p.from!;
  const lic = p.license_from;
  if (p.kind === "agent") {
    const tree = upstreamTree(f.repo, f.commit, [f.file!, ...(lic ? [lic] : [])]);
    const files: PayloadFile[] = [{ p: p.install.file, abs: join(tree, f.file!), from: { base: "upstream", path: f.file! } }];
    if (lic) files.push({ p: "LICENSE", abs: join(tree, lic), from: { base: "upstream", path: lic } });
    files.push({ p: "UPSTREAM.md", abs: join(item.dir, "UPSTREAM.md"), from: { base: "registry", path: `${relPath(item.dir)}/UPSTREAM.md` } });
    return { base: dirname(join(tree, f.file!)), files, up: { repo: f.repo, commit: f.commit, path: dirname(f.file!) === "." ? "" : dirname(f.file!) } };
  }
  const tree = upstreamTree(f.repo, f.commit, f.path ? [f.path, ...(lic ? [lic] : [])] : undefined);
  const base = f.path ? join(tree, f.path) : tree;
  const files: PayloadFile[] = listFiles(base, false).map(x => ({ p: x, abs: join(base, x) }));
  if (p.kind === "skill") {
    if (lic) files.push({ p: "UPSTREAM-LICENSE", abs: join(tree, lic), from: { base: "upstream", path: lic } });
    files.push({ p: "UPSTREAM.md", abs: join(item.dir, "UPSTREAM.md"), from: { base: "registry", path: `${relPath(item.dir)}/UPSTREAM.md` } });
  }
  return { base, files, up: { repo: f.repo, commit: f.commit, path: f.path ?? "" } };
}

export const relPath = (abs: string) => abs.slice(ROOT.length + 1);

// ---------- licence detection ----------
export function detectLicense(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.slice(0, 6000);
  if (/All rights reserved/i.test(t) && !/Apache License|Permission is hereby granted/i.test(t)) return "LicenseRef-Proprietary";
  if (/SIL OPEN FONT LICENSE/i.test(t)) return "OFL-1.1";
  if (/Apache License,?\s+Version 2\.0/i.test(t) || /Apache License\s*\n\s*Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/or distribute/i.test(t)) return "ISC";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return "LGPL";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return "GPL";
  if (/Mozilla Public License/i.test(t)) return "MPL-2.0";
  if (/Attribution 4\.0 International/i.test(t)) return "CC-BY-4.0";
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  return null;
}
export const isLicenseFile = (p: string) => /(^|[-_])(LICEN[CS]E|COPYING|OFL)([.-][\w.-]*)?$/i.test(p.split("/").pop()!);

// ---------- gate results ----------
export type GateStatus = "pass" | "warn" | "fail" | "skip" | "needs-auth" | "needs-env";
export type GateResult = { status: GateStatus; detail?: string; [k: string]: any };
export const RESULTS_DIR = join(ROOT, "gates", "results");
export function writeResults(gate: string, results: Record<string, GateResult>, meta: Record<string, any> = {}) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  // a run over named picks only updates those picks
  if (onlyArg().length) results = { ...(readResults(gate)?.results ?? {}), ...results };
  results = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
  Bun.write(join(RESULTS_DIR, `${gate}.json`), JSON.stringify({ gate, ran_at: new Date().toISOString(), ...meta, results }, null, 2) + "\n");
}
export function readResults(gate: string): { results: Record<string, GateResult>; [k: string]: any } | null {
  const f = join(RESULTS_DIR, `${gate}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export const installable = (it: Item) => !["replace", "exclude", "planned", "built-in"].includes(it.pick.status);
export function onlyArg(): string[] { return process.argv.slice(2).filter(a => !a.startsWith("--")); }
export function selected(items: Item[]): Item[] { const o = onlyArg(); return o.length ? items.filter(i => o.some(x => i.id === x || i.pick.name === x)) : items; }
