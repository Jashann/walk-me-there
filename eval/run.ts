// Measures how faithfully each approach builds what was said, against answer keys written from the
// transcripts without seeing the build code (EVAL_SET chooses eval/set or eval/heldout). Three arms, same builder model and rules:
//   graph+checks  Spark maps the words to a house graph, Wonder writes the build, code checks it, failures go back (up to 3 repairs)
//   one-shot      Wonder builds straight from the transcript
//   self-review   Wonder builds from the transcript, then reviews its own program against the transcript once and fixes it (no code checks)
// Every build is measured by the same code on the same key, after one alignment call maps each arm's tags to key ids.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chat, chatJSON, stripFence, spent } from "../server/meta.ts";
import { BUILD_RULES, build, BUILDER_MODEL } from "../server/builder.ts";
import { mapHouse, translateTurns } from "../server/listen.ts";
import { runSandboxed } from "../server/sandbox.ts";
import { runChecks, type Check } from "../server/checks.ts";
import type { HouseGraph, Element } from "../server/graph.ts";
import type { Block } from "../server/world.ts";

type Key = {
  entrance: string | null;
  entrance_faces: HouseGraph["entrance_faces"];
  elements: { id: string; kind: string; name: string; turns: number[] }[];
  relations: { a: string; rel: string; b: string; turns: number[] }[];
  sizes: { id: string; dim: "length" | "width" | "height"; metres: number; turns: number[] }[];
};
type Case = { id: string; setting: string; turns: { turnId: number; speaker: string; transcript: string }[]; key: Key };

const SET = join(import.meta.dirname, process.env.EVAL_SET ?? "set");
const OUT = join(import.meta.dirname, "..", "data", "eval", process.env.RUN ?? "run1");
mkdirSync(OUT, { recursive: true });
const ARMS = (process.env.ARMS ?? "graph,oneshot,selfreview").split(",");
const ONLY = process.env.CASES?.split(",");

function keyGraph(k: Key): HouseGraph {
  const size = (id: string, dim: string) => k.sizes.find((s) => s.id === id && s.dim === dim)?.metres ?? null;
  return {
    title: "key",
    place: null,
    speaker_relation: null,
    entrance: k.entrance,
    entrance_faces: k.entrance_faces,
    landmark: null,
    elements: k.elements.map((e) => ({
      id: e.id, kind: e.kind as Element["kind"], name: e.name, original: null, material: "unspecified", colour: null,
      size: { length_m: size(e.id, "length"), width_m: size(e.id, "width"), height_m: size(e.id, "height"), phrase: null },
      level: "ground", detail: null, turns: e.turns,
    })),
    relations: k.relations.map((r) => ({ a: r.a, rel: r.rel as HouseGraph["relations"][number]["rel"], b: r.b, turns: r.turns, quote: "" })),
    gaps: [],
  };
}

const transcriptText = (c: Case) => c.turns.map((t) => `[${t.turnId}] (${t.speaker}) ${t.transcript}`).join("\n");

const DIRECT_RULES = BUILD_RULES.replace(
  "Faithful (checked by code on every voxel)",
  "Faithful\n- Give every distinct thing from the description a short snake_case id and tag its blocks with it. Before the program, output a ```json block with a legend object mapping each id to a plain name (\"hand_pump\": \"hand pump\").",
).replace("- Never tag anything with an id that is not in the element list.\n", "");
if (DIRECT_RULES === BUILD_RULES) throw new Error("the baseline prompt was not applied");

async function direct(c: Case, selfReview: boolean): Promise<{ blocks: Block[]; legend: Record<string, string>; usd: number; ms: number; error: string | null; blockM: number }> {
  const t0 = Date.now();
  let usd = 0;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: DIRECT_RULES },
    { role: "user", content: `Build this house from what was said.\n\nTranscript:\n${transcriptText(c)}` },
  ];
  let r = await chat({ model: BUILDER_MODEL, messages, effort: "medium", maxTokens: 48000, tag: `eval:${selfReview ? "selfreview" : "oneshot"}` });
  usd += r.usd;
  if (selfReview) {
    messages.push({ role: "assistant", content: r.text });
    messages.push({ role: "user", content: "Review your program against the transcript, line by line: is every thing that was said built, in the position and size that was said, and is nothing built in colour that was not said? Then return the corrected legend and the whole corrected program, in the same format." });
    r = await chat({ model: BUILDER_MODEL, messages, effort: "medium", maxTokens: 48000, tag: "eval:selfreview:2" });
    usd += r.usd;
  }
  const legendText = r.text.match(/```json\s*\n([\s\S]*?)```/)?.[1] ?? "{}";
  let legend: Record<string, string> = {};
  try { legend = JSON.parse(legendText); } catch {}
  const code = r.text.match(/```(?:js|javascript)\s*\n([\s\S]*?)```/)?.[1] ?? stripFence(r.text);
  const run = await runSandboxed(code);
  return { blocks: run.blocks, legend, usd, ms: Date.now() - t0, error: run.error, blockM: run.blockM };
}

const ALIGN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["pairs"],
  properties: { pairs: { type: "array", items: { type: "object", additionalProperties: false, required: ["key_id", "tag"], properties: { key_id: { type: "string" }, tag: { anyOf: [{ type: "string" }, { type: "null" }] } } } } },
};

// One call per build: which built tag is which key element. The same aligner sees every arm.
async function align(k: Key, tags: { tag: string; name: string }[]): Promise<{ map: Map<string, string>; usd: number }> {
  const { data, usd } = await chatJSON<{ pairs: { key_id: string; tag: string | null }[] }>({
    model: "muse-spark-1.3", effort: "low", tag: "eval:align",
    schema: { name: "alignment", schema: ALIGN_SCHEMA },
    messages: [
      { role: "system", content: "Match each element of a reference list to the built part that represents the same physical thing, by meaning (hand_pump and nalka are the same; grandmother_room and nani_room are the same). Each built tag can match at most one reference element. Use null when nothing built is that thing. Do not match different things just because they are similar kinds." },
      { role: "user", content: `Reference elements:\n${k.elements.map((e) => `${e.id}: ${e.name} (${e.kind})`).join("\n")}\n\nBuilt parts:\n${tags.map((t) => `${t.tag}: ${t.name}`).join("\n")}` },
    ],
  });
  const map = new Map<string, string>(); // tag -> key id
  const used = new Set<string>();
  for (const p of data.pairs) if (p.tag && tags.some((t) => t.tag === p.tag) && !used.has(p.tag) && k.elements.some((e) => e.id === p.key_id)) { map.set(p.tag, p.key_id); used.add(p.tag); }
  return { map, usd };
}

function measure(k: Key, blocks: Block[], map: Map<string, string>, blockM = 0.25) {
  const renamed = blocks.map((b) => ({ ...b, t: map.get(b.t) ?? (b.t.startsWith("unsaid") ? b.t : `extra:${b.t}`) }));
  const checks = runChecks(keyGraph(k), renamed, null, blockM).filter((c) => c.kind === "exists" || c.kind === "relation" || c.kind === "size");
  const by = (kind: string) => { const x = checks.filter((c) => c.kind === kind); return { pass: x.filter((c) => c.pass).length, total: x.length }; };
  const extras = new Set(renamed.filter((b) => b.t.startsWith("extra:")).map((b) => b.t));
  return { exists: by("exists"), relation: by("relation"), size: by("size"), pass: checks.filter((c) => c.pass).length, total: checks.length, extras: [...extras].map((t) => t.slice(6)), failed: checks.filter((c) => !c.pass).map((c: Check) => `${c.text} -> ${c.detail}`) };
}

const cases: Case[] = readdirSync(SET).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(SET, f), "utf8"))).filter((c) => !ONLY || ONLY.includes(c.id));
const s0 = spent();
console.log(`${cases.length} cases, arms ${ARMS.join(", ")}, builder ${BUILDER_MODEL}`);

async function runCase(c: Case) {
  const file = join(OUT, `${c.id}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const res: Record<string, unknown> = { ...prev, id: c.id, setting: c.setting };
  for (const arm of ARMS) {
    if (prev[arm]?.result) continue;
    try {
      if (arm === "graph") {
        const t0 = Date.now();
        const said = await translateTurns(c.turns.map((t) => ({ ...t, startMs: 0, endMs: 0 })), "");
        const { graph, usd: mapUsd } = await mapHouse(said);
        const quotes = new Map(said.map((t) => [t.turnId, t.english]));
        const { best, attempts } = await build(graph, quotes, { maxRepairs: 3, tag: `eval:graph:${c.id}` });
        const tags = graph.elements.map((e) => ({ tag: e.id, name: e.name }));
        const { map } = await align(c.key, tags);
        res[arm] = { result: measure(c.key, best.blocks, map, best.blockM), rounds: attempts.length, ownChecks: `${best.passed}/${best.total}`, usd: mapUsd + attempts.reduce((a, x) => a + x.usd, 0), ms: Date.now() - t0, elements: tags.length, error: best.error };
      } else {
        const d = await direct(c, arm === "selfreview");
        const tags = [...new Set(d.blocks.map((b) => b.t))].filter((t) => !t.startsWith("unsaid")).map((t) => ({ tag: t, name: d.legend[t] ?? t.replace(/_/g, " ") }));
        const { map } = await align(c.key, tags);
        res[arm] = { result: measure(c.key, d.blocks, map, d.blockM), usd: d.usd, ms: d.ms, elements: tags.length, error: d.error };
      }
    } catch (e) {
      res[arm] = { error: String((e as Error).message ?? e).slice(0, 300) };
    }
    writeFileSync(file, JSON.stringify(res, null, 1));
    const sc = (res[arm] as { result?: { pass: number; total: number } }).result;
    console.log(`${c.id} ${arm}: ${sc ? `${sc.pass}/${sc.total}` : "error"}`);
  }
  return res;
}

// A few cases at a time.
const results: Record<string, any>[] = [];
for (let i = 0; i < cases.length; i += 4) results.push(...(await Promise.all(cases.slice(i, i + 4).map(runCase))));

const table: Record<string, { pass: number; total: number; rel: number; relTotal: number; extras: number; usd: number; ms: number; n: number }> = {};
for (const r of results) for (const arm of ARMS) {
  const a = r[arm];
  if (!a?.result) continue;
  const t = (table[arm] ??= { pass: 0, total: 0, rel: 0, relTotal: 0, extras: 0, usd: 0, ms: 0, n: 0 });
  t.pass += a.result.pass; t.total += a.result.total; t.rel += a.result.relation.pass; t.relTotal += a.result.relation.total;
  t.extras += a.result.extras.length; t.usd += a.usd; t.ms += a.ms; t.n++;
}
const summary = Object.entries(table).map(([arm, t]) => ({ arm, cases: t.n, facts: `${t.pass}/${t.total} (${((100 * t.pass) / t.total).toFixed(1)}%)`, positions: `${t.rel}/${t.relTotal} (${((100 * t.rel) / t.relTotal).toFixed(1)}%)`, extraThingsPerHouse: (t.extras / t.n).toFixed(2), usdPerHouse: (t.usd / t.n).toFixed(3), secondsPerHouse: (t.ms / t.n / 1000).toFixed(0) }));
console.table(summary);
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ at: new Date().toISOString(), builder: BUILDER_MODEL, summary, spend: spent() - s0 }, null, 1));
console.log(`spend this run $${(spent() - s0).toFixed(2)}`);
