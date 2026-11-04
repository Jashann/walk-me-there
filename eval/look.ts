// Dev probe: take a saved build (data/<run>/build.json), run the look-and-improve step, save both as houses.
import { readFileSync } from "node:fs";
import { reviewAndImprove } from "../server/review.ts";
import { closeRenderer } from "../server/render.ts";
import { create, save } from "../server/houses.ts";

const run = JSON.parse(readFileSync(process.argv[2], "utf8"));
const quotes = new Map<number, string>(run.said.map((t: any) => [t.turnId, t.english]));
const r = await reviewAndImprove(run.graph, quotes, run.best, "look");
console.log("notes:"); for (const n of r.notes) console.log(" -", n.problem, "| FIX:", n.fix);
console.log("kept:", r.kept, "before", r.before, "after", r.after, "$" + r.usd.toFixed(3));
if (r.attempt) {
  const h = create("text", "After the look-and-improve step", process.argv[3]);
  Object.assign(h, { graph: run.graph, turns: run.said, program: r.attempt.program, blocks: r.attempt.blocks, checks: r.attempt.checks, status: "ready", statusText: `${r.attempt.passed} of ${r.attempt.total} checks pass`, version: 1 });
  save(h);
  for (const c of r.attempt.checks.filter((c) => !c.pass)) console.log("FAIL", c.text, "->", c.detail);
}
await closeRenderer();
