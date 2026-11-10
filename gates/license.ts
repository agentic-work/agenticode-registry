// Gate 1: licence. SPDX detection on every licence file and SPDX header in what we
// vendor; copyleft and proprietary block vendoring; the pick must say what we found.
import { readFileSync } from "fs";
import { join } from "path";
import { COPYLEFT, PERMISSIVE, detectLicense, installable, isLicenseFile, loadItems, payload, selected, writeResults, type GateResult } from "./lib";

const results: Record<string, GateResult> = {};
for (const it of selected(loadItems()).filter(installable)) {
  const p = it.pick;
  try {
    if (it.ours) { results[it.id] = { status: "pass", detail: "ours (agentic-work)" }; continue; }
    if (p.kind === "mcp") {
      results[it.id] = p.license ? { status: "pass", detail: `link-only config; server licence ${p.license}` } : { status: "fail", detail: "no licence recorded for the server" };
      continue;
    }
    const pl = payload(it)!;
    const found = new Map<string, string>(); // file -> spdx
    for (const f of pl.files) {
      const abs = join(pl.base, f);
      if (isLicenseFile(f)) { found.set(f, detectLicense(readFileSync(abs, "utf8")) ?? "unknown"); continue; }
      if (/\.(md|txt|py|js|ts|sh|mjs|cjs|json|ya?ml|html|css)$/i.test(f)) {
        const head = readFileSync(abs, "utf8").slice(0, 2000);
        const m = head.match(/SPDX-License-Identifier:\s*([\w.+-]+(?:\s+(?:OR|AND|WITH)\s+[\w.+-]+)*)/);
        if (m) found.set(f, m[1]);
      }
    }
    // an agent ships one file; its licence sits beside it in the item folder
    if (p.kind === "agent" && p.vendor && p.license_file) found.set(p.license_file, detectLicense(readFileSync(join(it.dir, p.license_file), "utf8")) ?? "unknown");
    const licenses = [...new Set(found.values())];
    const bad = [...found].filter(([, l]) => COPYLEFT.test(l) || /Proprietary/.test(l));
    if (p.vendor) {
      const declared = p.license_file ? found.get(p.kind === "plugin" ? p.license_file.replace(/^plugin\//, "") : p.license_file) : undefined;
      if (!p.license || !PERMISSIVE.has(p.license)) results[it.id] = { status: "fail", detail: `vendored but licence ${p.license} is not permissive` };
      else if (declared && declared !== p.license) results[it.id] = { status: "fail", detail: `pick says ${p.license}, ${p.license_file} reads as ${declared}` };
      else if (!declared) results[it.id] = { status: "fail", detail: `vendored without its licence file (${p.license_file ?? "none"})` };
      else if (bad.length) results[it.id] = { status: "fail", detail: `files under other terms: ${bad.slice(0, 4).map(([f, l]) => `${f} (${l})`).join(", ")}` };
      else if (licenses.some(l => l === "unknown")) results[it.id] = { status: "warn", detail: `unrecognised licence text in ${[...found].filter(([, l]) => l === "unknown").map(([f]) => f).slice(0, 3).join(", ")}`, licenses };
      else results[it.id] = { status: "pass", detail: licenses.join(", "), licenses };
    } else {
      results[it.id] = p.license
        ? { status: "pass", detail: `link-only (${p.vendor_reason})`, licenses }
        : { status: "warn", detail: "no licence: link-only, nothing copied; installed from upstream at the pinned commit", licenses };
    }
  } catch (e: any) { results[it.id] = { status: "fail", detail: e.message }; }
}
writeResults("license", results);
const c = (s: string) => Object.values(results).filter(r => r.status === s).length;
console.log(`license: ${c("pass")} pass, ${c("warn")} warn, ${c("fail")} fail`);
for (const [id, r] of Object.entries(results)) if (r.status !== "pass") console.log(`  ${r.status.padEnd(4)} ${id}: ${r.detail}`);
