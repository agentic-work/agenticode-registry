// Gate 1: licence. Nothing is copied into this repo; every pick installs from
// upstream at the pinned commit. This gate checks that what agenticode will
// install carries the upstream licence (in the item's folder, or fetched from
// the repo as UPSTREAM-LICENSE), that it reads as the licence the pick declares
// (SPDX detection on every licence file and SPDX header), and it reports any
// copyleft or proprietary terms inside.
import { readFileSync } from "fs";
import { COPYLEFT, PERMISSIVE, detectLicense, installable, isLicenseFile, loadItems, payload, selected, writeResults, type GateResult } from "./lib";

const results: Record<string, GateResult> = {};
for (const it of selected(loadItems()).filter(installable)) {
  const p = it.pick;
  try {
    if (p.kind === "mcp") {
      results[it.id] = p.license ? { status: "pass", detail: `config only; server licence ${p.license}` } : { status: "fail", detail: "no licence recorded for the server" };
      continue;
    }
    const pl = payload(it)!;
    const found = new Map<string, string>();
    for (const f of pl.files) {
      if (f.p === "UPSTREAM.md") continue;
      if (isLicenseFile(f.p)) { found.set(f.p, detectLicense(readFileSync(f.abs, "utf8")) ?? "unknown"); continue; }
      if (/\.(md|txt|py|js|ts|sh|mjs|cjs|json|ya?ml|html|css)$/i.test(f.p)) {
        const m = readFileSync(f.abs, "utf8").slice(0, 2000).match(/SPDX-License-Identifier:\s*([\w.+-]+(?:\s+(?:OR|AND|WITH)\s+[\w.+-]+)*)/);
        if (m) found.set(f.p, m[1]);
      }
    }
    // the item's own licence: a top-level LICENSE* in its folder, or the one fetched beside it
    const main = [...found].find(([f]) => !f.includes("/") && isLicenseFile(f));
    const licenses = [...new Set(found.values())];
    const odd = [...found].filter(([, l]) => COPYLEFT.test(l) || /Proprietary/.test(l));
    if (!p.license) {
      results[it.id] = { status: "warn", detail: "upstream publishes no licence for this item; installed from upstream as published, nothing redistributed by us", licenses };
    } else if (!main) {
      results[it.id] = p.kind === "plugin"
        ? { status: "warn", detail: `${p.license} lives outside the plugin folder upstream; the index records the attribution`, licenses }
        : { status: "fail", detail: `the installed ${p.kind} would carry no licence (declare license_from)`, licenses };
    } else if (main[1] !== p.license && !(p.license.includes(" OR ") && p.license.split(" OR ").includes(main[1]))) {
      results[it.id] = { status: "fail", detail: `pick says ${p.license}, ${main[0]} reads as ${main[1]}`, licenses };
    } else if (odd.length) {
      results[it.id] = { status: "warn", detail: `some files carry other terms: ${odd.slice(0, 4).map(([f, l]) => `${f} (${l})`).join(", ")}`, licenses };
    } else if (!PERMISSIVE.has(p.license)) {
      results[it.id] = { status: "warn", detail: `${p.license}: installed from upstream under its own terms`, licenses };
    } else {
      results[it.id] = { status: "pass", detail: `${licenses.join(", ")} (${main[0]} installed with it)`, licenses };
    }
  } catch (e: any) { results[it.id] = { status: "fail", detail: e.message }; }
}
writeResults("license", results);
const c = (s: string) => Object.values(results).filter(r => r.status === s).length;
console.log(`license: ${c("pass")} pass, ${c("warn")} warn, ${c("fail")} fail`);
for (const [id, r] of Object.entries(results)) if (r.status !== "pass") console.log(`  ${r.status.padEnd(4)} ${id}: ${r.detail}`);
