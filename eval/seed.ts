// Turn a saved probe result (data/<run>/build.json) into a viewable house, without calling any model.
import { readFileSync } from "node:fs";
import { create, save } from "../server/houses.ts";

const run = JSON.parse(readFileSync(process.argv[2], "utf8"));
const h = create("text", process.argv[3] ?? "", process.argv[4]);
h.turns = run.said;
h.graph = run.graph;
h.program = run.best.program;
h.blocks = run.best.blocks;
h.checks = run.best.checks;
h.attempts = run.attempts.map((a: any) => ({ ...a, failed: [] }));
h.status = "ready";
h.statusText = `${run.best.passed} of ${run.best.total} checks pass`;
h.version = 1;
h.blockM = Number(process.env.BLOCK_M ?? 0.25);
save(h);
console.log(h.id);
