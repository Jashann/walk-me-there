// Dev probe: fixture turns -> graph -> build, printing cost and check results.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { translateTurns, mapHouse } from "../server/listen.ts";
import { build } from "../server/builder.ts";
import { spent } from "../server/meta.ts";

const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3] ?? "data/try";
mkdirSync(out, { recursive: true });
const s0 = spent();
const said = await translateTurns(fx.turns, "");
const { graph, dropped, usd } = await mapHouse(said);
console.log("graph:", graph.elements.length, "elements,", graph.relations.length, "relations, $" + usd.toFixed(4), "dropped:", dropped);
writeFileSync(`${out}/graph.json`, JSON.stringify(graph, null, 1));
const quotes = new Map(said.map((t) => [t.turnId, t.english]));
const { best, attempts } = await build(graph, quotes, { maxRepairs: Number(process.env.REPAIRS ?? 2), onEvent: (e) => e.type === "attempt" ? console.log(`round ${e.attempt.round}: ${e.attempt.passed}/${e.attempt.total} pass, ${e.attempt.blocks.length} blocks, $${e.attempt.usd.toFixed(3)}, ${(e.attempt.ms/1000).toFixed(0)}s${e.attempt.error ? " ERROR " + e.attempt.error : ""}`) : console.log(e.text) });
for (const c of best.checks.filter((c) => !c.pass)) console.log("  FAIL", c.text, "->", c.detail);
writeFileSync(`${out}/build.json`, JSON.stringify({ graph, said, best, attempts: attempts.map(a => ({ round: a.round, passed: a.passed, total: a.total, usd: a.usd, ms: a.ms, error: a.error, program: a.program })) }, null, 1));
console.log("total spend this run $" + (spent() - s0).toFixed(3));
