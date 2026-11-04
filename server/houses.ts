// A house is a recording (or a live call), its turns, the graph, and every build attempt.
// State lives on disk so a page reload or a server restart keeps everything.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { HouseGraph } from "./graph.ts";
import type { Check } from "./checks.ts";
import type { Block } from "./world.ts";
import { transcribeFile, translateTurns, mapHouse, type SaidTurn } from "./listen.ts";
import { build, type Attempt } from "./builder.ts";
import { spendScope } from "./meta.ts";
import { reviewAndImprove } from "./review.ts";

const ROOT = join(import.meta.dirname, "..", "data", "houses");
const PER_HOUSE_CAP = Number(process.env.PER_HOUSE_USD ?? 4);

export type AttemptSummary = { round: number; passed: number; total: number; usd: number; ms: number; error: string | null; failed: { text: string; detail: string }[]; saved?: boolean; look?: boolean };

export type House = {
  id: string;
  createdAt: string;
  source: "recording" | "live" | "text";
  status: "listening" | "transcribing" | "translating" | "mapping" | "building" | "ready" | "error";
  statusText: string;
  error: string | null;
  audioFile: string | null; // file name inside the house folder
  context: string; // who is speaking, about where
  turns: SaidTurn[];
  graph: HouseGraph | null;
  dropped: string[];
  attempts: AttemptSummary[];
  program: string | null;
  blocks: Block[];
  checks: Check[];
  usd: number;
  look?: { problem: string; fix: string }[]; // the art director's notes on the last build, if it was looked at
  version: number; // bumps on every new build
  blockM?: number; // metres per voxel when the blocks were built (houses from before Oct 28 used 0.5)
  public: boolean; // listed in the gallery
};

const live = new Map<string, House>();
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function dir(id: string) {
  return join(ROOT, id);
}

export function save(h: House) {
  mkdirSync(dir(h.id), { recursive: true });
  writeFileSync(join(dir(h.id), "state.json"), JSON.stringify(h));
  seenAt.set(h.id, statSync(join(dir(h.id), "state.json")).mtimeMs);
}
const seenAt = new Map<string, number>();

export function load(id: string): House | null {
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return null;
  const p = join(dir(id), "state.json");
  const cached = live.get(id);
  // a finished house is re-read if its file changed under us (a dev tool rebuilt it); one being built is
  // always the copy in memory
  if (cached && (!["ready", "error"].includes(cached.status) || !existsSync(p) || statSync(p).mtimeMs === seenAt.get(id))) return cached;
  if (!existsSync(p)) return null;
  const h = JSON.parse(readFileSync(p, "utf8")) as House;
  live.set(id, h);
  seenAt.set(id, statSync(p).mtimeMs);
  return h;
}

export function list(): Pick<House, "id" | "createdAt" | "source" | "status" | "usd" | "public">[] & { title?: string }[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .map((id) => load(id))
    .filter((h): h is House => !!h)
    .map((h) => ({ id: h.id, title: h.graph?.title, createdAt: h.createdAt, source: h.source, status: h.status, usd: h.usd, public: h.public }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function create(source: House["source"], context = "", id?: string): House {
  const h: House = {
    id: id ?? `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`,
    createdAt: new Date().toISOString(),
    source,
    status: source === "live" ? "listening" : "transcribing",
    statusText: "",
    error: null,
    audioFile: null,
    context,
    turns: [],
    graph: null,
    dropped: [],
    attempts: [],
    program: null,
    blocks: [],
    checks: [],
    usd: 0,
    version: 0,
    public: false,
  };
  live.set(h.id, h);
  save(h);
  return h;
}

function emit(h: House, type: string, extra: Record<string, unknown> = {}) {
  bus.emit(h.id, { type, status: h.status, statusText: h.statusText, ...extra });
}

function setStatus(h: House, status: House["status"], statusText: string) {
  h.status = status;
  h.statusText = statusText;
  save(h);
  emit(h, "status");
}

// Spend is tracked per house: every model call made inside fn is added to this house, even when
// other houses are being built at the same time.
async function metered<T>(h: House, fn: () => Promise<T>): Promise<T> {
  if (h.usd >= PER_HOUSE_CAP) throw new Error(`This house reached its spending limit ($${PER_HOUSE_CAP}).`);
  const scope = { usd: 0 };
  try {
    return await spendScope.run(scope, fn);
  } finally {
    h.usd += scope.usd;
  }
}

async function runRecording(h: House, path: string, languageBias?: string[], file?: string) {
  const adding = h.turns.length > 0;
  try {
    setStatus(h, "transcribing", adding ? "Listening to the new recording" : "Listening to the recording");
    const heard = await metered(h, () => transcribeFile(path, { languageBias }));
    if (!heard.length) throw new Error("No speech was found in the recording.");
    const base = h.turns.reduce((m, t) => Math.max(m, t.turnId), 0);
    const turns = heard.map((t) => ({ ...t, turnId: base + t.turnId, file }));
    setStatus(h, "translating", `Heard ${turns.length} turns. Translating`);
    const said = await metered(h, () => translateTurns(turns, h.context));
    h.turns.push(...said.map((t) => ({ ...t, file })));
    save(h);
    emit(h, "turns", { turns: h.turns });
    await mapAndBuild(h, { incremental: adding });
  } catch (e) {
    fail(h, e);
  }
}

async function runTurns(h: House, turns: SaidTurn[] | { turnId: number; transcript: string; speaker?: string; startMs?: number; endMs?: number }[]) {
  try {
    setStatus(h, "translating", "Reading the description");
    h.turns = await metered(h, () => translateTurns(turns.map((t) => ({ startMs: 0, endMs: 0, ...t })), h.context));
    save(h);
    emit(h, "turns", { turns: h.turns });
    await mapAndBuild(h);
  } catch (e) {
    fail(h, e);
  }
}

export async function mapAndBuild(h: House, opts: { incremental?: boolean } = {}) {
  setStatus(h, "mapping", "Mapping what was said");
  const { graph, dropped } = await metered(h, () => mapHouse(h.turns, opts.incremental ? h.graph ?? undefined : undefined));
  h.graph = graph;
  h.dropped = dropped;
  save(h);
  emit(h, "graph", { graph });
  setStatus(h, "building", "Building");
  const quotes = new Map(h.turns.map((t) => [t.turnId, t.english]));
  const { best } = await metered(h, () =>
    build(graph, quotes, {
      maxRepairs: 3,
      previous: opts.incremental ? h.program ?? undefined : undefined,
      tag: `build:${h.id}`,
      onEvent: (e) => {
        if (e.type === "status") setStatus(h, "building", e.text);
        else onAttempt(h, e.attempt);
      },
    }),
  );
  let final = best;
  // Look at it and improve it (recordings and typed descriptions; live talk skips this to stay quick).
  if (h.source !== "live" && process.env.LOOK !== "0" && !best.error) {
    setStatus(h, "building", "Looking at the build");
    try {
      const r = await metered(h, () => reviewAndImprove(graph, quotes, best, h.id));
      h.look = r.notes;
      if (r.kept && r.attempt) {
        final = r.attempt;
        onAttempt(h, r.attempt, true);
      }
    } catch (e) {
      h.look = [{ problem: `Could not look at the build: ${String((e as Error).message ?? e).slice(0, 160)}`, fix: "" }];
    }
  }
  h.program = final.program;
  h.blocks = final.blocks;
  h.blockM = final.blockM;
  h.checks = final.checks;
  h.version++;
  setStatus(h, h.source === "live" ? "listening" : "ready", `${final.passed} of ${final.total} checks pass`);
  emit(h, "built", { version: h.version });
}

function onAttempt(h: House, a: Attempt, look = false) {
  h.blockM = a.blockM;
  const summary: AttemptSummary = { round: a.round, passed: a.passed, total: a.total, usd: a.usd, ms: a.ms, error: a.error, failed: a.checks.filter((c) => !c.pass).map((c) => ({ text: c.text, detail: c.detail })), saved: true, ...(look ? { look: true } : {}) };
  // Keep every attempt's blocks, so any build can be looked at again (the Builds tab shows them).
  mkdirSync(dir(h.id), { recursive: true });
  writeFileSync(join(dir(h.id), `attempt-${h.attempts.length}.json`), JSON.stringify({ blocks: a.blocks, checks: a.checks, blockM: a.blockM }));
  h.attempts.push(summary);
  // Show every attempt as it lands, so the repair is visible.
  h.blocks = a.blocks;
  h.checks = a.checks;
  h.program = a.program;
  h.version++;
  save(h);
  emit(h, "attempt", { attempt: summary, version: h.version });
}

function fail(h: House, e: unknown) {
  const raw = String((e as Error).message ?? e);
  console.error(`build ${h.id} failed:`, raw.slice(0, 500));
  h.error = /Spend cap reached|\b402\b|insufficient|credit|balance|quota/i.test(raw)
    ? "This place could not be finished because the demo's model budget has run out. You can still walk through the places in the gallery."
    : /spending limit/.test(raw)
      ? "This place reached its limit of model costs before it was finished. Try a shorter recording or description."
      : process.env.ADMIN_TOKEN
        ? "Something went wrong while building this place, and it was not finished. Please try again."
        : raw.slice(0, 500);
  setStatus(h, "error", h.error);
}

// Live sessions: new turns arrive while people talk; rebuild after each pause, never two builds at once.
const busy = new Set<string>();
const building = new Set<string>();
export const activeBuilds = () => new Set([...busy, ...building]).size;
// Uploads and typed builds count towards the limit too, for as long as they run.
async function tracked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const mine = !building.has(id);
  building.add(id);
  try { return await fn(); } finally { if (mine) building.delete(id); }
}
export const processRecording = (...a: Parameters<typeof runRecording>) => tracked(a[0].id, () => runRecording(...a));
export const processTurns = (...a: Parameters<typeof runTurns>) => tracked(a[0].id, () => runTurns(...a));
const pending = new Set<string>();
export async function addLiveTurn(h: House, t: SaidTurn) {
  h.turns.push(t);
  save(h);
  emit(h, "turns", { turns: h.turns });
  if (busy.has(h.id)) return void pending.add(h.id);
  busy.add(h.id);
  try {
    do {
      pending.delete(h.id);
      try {
        const fresh = h.turns.filter((x) => !x.english);
        if (fresh.length) {
          const tr = await metered(h, () => translateTurns(fresh, h.context));
          for (const x of tr) Object.assign(h.turns.find((y) => y.turnId === x.turnId)!, x);
        }
        await mapAndBuild(h, { incremental: !!h.graph });
      } catch (e) {
        h.error = String((e as Error).message ?? e).slice(0, 300);
        setStatus(h, "listening", h.error);
      }
    } while (pending.has(h.id));
  } finally {
    busy.delete(h.id);
  }
}
