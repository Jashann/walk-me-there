// Dev tool: run a hand-written build program and save it as a house to look at (no model calls).
// node eval/preview.ts <program.js> <house-id> [graph-json-from-a-build.json]
import { readFileSync } from "node:fs";
import { runSandboxed } from "../server/sandbox.ts";
import { runChecks, summarize } from "../server/checks.ts";
import { create, save } from "../server/houses.ts";

const code = readFileSync(process.argv[2], "utf8");
const run = await runSandboxed(code);
if (run.error) console.log("error:", run.error);
const h = create("text", "Kit preview", process.argv[3]);
if (process.argv[4]) {
  const b = JSON.parse(readFileSync(process.argv[4], "utf8"));
  h.graph = b.graph;
  h.turns = b.said;
  h.checks = runChecks(b.graph, run.blocks, run.error, run.blockM);
  const s = summarize(h.checks);
  h.statusText = `${s.passed} of ${s.total} checks pass`;
  for (const c of h.checks.filter((c) => !c.pass)) console.log("FAIL", c.text, "->", c.detail);
}
h.program = code;
h.blocks = run.blocks;
h.status = "ready";
h.version = 1;
h.blockM = run.blockM;
save(h);
console.log(h.id, run.blocks.length, "voxels", h.statusText);
