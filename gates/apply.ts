// After the gates: any pick with a failing gate becomes `status: blocked` with the
// reason written into its pick.yaml (never dropped silently); a blocked pick
// whose gates all pass again goes back to `status: ok`.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadItems, readResults } from "./lib";

const GATES = ["license", "scan", "lint", "install"];
const res = Object.fromEntries(GATES.map(g => [g, readResults(g)?.results ?? {}]));
let blocked = 0, restored = 0;
for (const it of loadItems()) {
  if (it.ours || !["ok", "blocked"].includes(it.pick.status)) continue;
  // one line per failing gate: its first finding, kept short
  const fails = GATES.flatMap(g => (res[g][it.id]?.status === "fail" ? [`${g}: ${String(res[g][it.id].detail).split(" | ")[0].split("; ")[0].slice(0, 220)}`] : []));
  const f = join(it.dir, "pick.yaml");
  let y = readFileSync(f, "utf8").replace(/^blocked_reason:.*\n/m, "");
  if (fails.length) {
    const reason = fails.join(" | ").replace(/\s+/g, " ").slice(0, 400);
    y = y.replace(/^status: (ok|blocked)$/m, `status: blocked\nblocked_reason: ${JSON.stringify(reason)}`);
    blocked++;
  } else if (it.pick.status === "blocked") {
    // only an install result can clear a block that came from the install gate
    if (!res.install[it.id] && /install:/.test(it.pick.blocked_reason ?? "")) continue;
    y = y.replace(/^status: blocked$/m, "status: ok");
    restored++;
  }
  writeFileSync(f, y);
}
console.log(`apply: ${blocked} blocked, ${restored} restored`);
