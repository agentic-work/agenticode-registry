// Shared helpers for the registry scripts (bun, no dependencies).
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
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
  license?: string | null; license_file?: string; vendor?: boolean; vendor_reason?: string;
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

/** Download repo@commit once (codeload tarball) and return the extracted folder. */
export function upstreamTree(repo: string, commit: string): string {
  const d = join(CACHE, `${repo.replace("/", "__")}-${commit.slice(0, 12)}`);
  if (existsSync(join(d, ".complete"))) return d;
  mkdirSync(d, { recursive: true });
  const r = Bun.spawnSync(["bash", "-c", `set -o pipefail; curl -sfL https://codeload.github.com/${repo}/tar.gz/${commit} | tar -xz --strip-components=1 -C "$0" && touch "$0/.complete"`, d]);
  if (r.exitCode) throw new Error(`could not fetch ${repo}@${commit}: ${r.stderr.toString().trim()}`);
  return d;
}

/**
 * Where an installable item's payload lives and which files it has.
 * Vendored: in this repo. Link-only: upstream at the pinned commit.
 */
export function payload(item: Item): { base: string; files: string[]; origin: "registry" | "upstream"; regPath?: string; up?: { repo: string; commit: string; path: string } } | null {
  const p = item.pick;
  if (p.kind === "mcp") return null;
  if (item.ours) {
    if (p.status !== "ok") return null;
    return { base: item.dir, files: p.kind === "agent" ? [p.install.file] : listFiles(item.dir).filter(f => f !== "README.md"), origin: "registry", regPath: relPath(item.dir) };
  }
  if (p.status === "replace" || p.status === "exclude") return null;
  if (p.vendor) {
    const base = p.kind === "plugin" ? join(item.dir, "plugin") : item.dir;
    const files = p.kind === "agent" ? [p.install.file] : listFiles(base, p.kind !== "plugin");
    return { base, files, origin: "registry", regPath: relPath(base) };
  }
  const f = p.from!;
  const tree = upstreamTree(f.repo, f.commit);
  if (p.kind === "agent") return { base: dirname(join(tree, f.file!)), files: [f.file!.split("/").pop()!], origin: "upstream", up: { repo: f.repo, commit: f.commit, path: dirname(f.file!) } };
  const base = f.path ? join(tree, f.path) : tree;
  return { base, files: listFiles(base, false).filter(x => x !== ".complete"), origin: "upstream", up: { repo: f.repo, commit: f.commit, path: f.path ?? "" } };
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
