// Checks compiled from the house graph and run on the real block data, not by a model.
// Each check carries the words that justify it, so a failure can be read back to the builder
// (and to the person) as "this is what was said, and this is what the build shows".
// Voxel indices are converted to metres with BLOCK_M; every tolerance below is in metres.
import { FOLIAGE, type HouseGraph, type Element, type Relation } from "./graph.ts";
import { BLOCK_M as DEFAULT_M, type Block } from "./world.ts";

// Metres per voxel for the build being checked; set at the start of runChecks (which is synchronous).
let BLOCK_M = DEFAULT_M;

export type Check = {
  id: string;
  kind: "exists" | "size" | "relation" | "reachable" | "uncited" | "program";
  subject: string;
  text: string; // human sentence: "the hand pump is left of the gate"
  turns: number[];
  pass: boolean;
  detail: string; // what the build actually shows
};

// Boxes in voxel indices (inclusive). `base` is the footprint within the lowest 1.5 m of the thing,
// so a tree is placed by its trunk, not by a crown that overhangs a wall.
type Box = { n: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; cx: number; cy: number; cz: number };
type Boxes = Map<string, Box & { base: Box }>;

function boxOf(list: Block[]): Box {
  const b: Box = { n: list.length, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, cx: 0, cy: 0, cz: 0 };
  for (const v of list) {
    b.x0 = Math.min(b.x0, v.x); b.x1 = Math.max(b.x1, v.x); b.y0 = Math.min(b.y0, v.y); b.y1 = Math.max(b.y1, v.y); b.z0 = Math.min(b.z0, v.z); b.z1 = Math.max(b.z1, v.z);
    b.cx += v.x; b.cy += v.y; b.cz += v.z;
  }
  b.cx /= list.length; b.cy /= list.length; b.cz /= list.length;
  return b;
}

export function boxesByTag(blocks: Block[]): Boxes {
  const by = new Map<string, Block[]>();
  for (const b of blocks) (by.get(b.t) ?? by.set(b.t, []).get(b.t)!).push(b);
  const out: Boxes = new Map();
  const low = Math.round(1.5 / BLOCK_M);
  for (const [t, list] of by) {
    const all = boxOf(list);
    const baseList = list.filter((b) => b.y <= all.y0 + low);
    out.set(t, { ...all, base: boxOf(baseList.length ? baseList : list) });
  }
  return out;
}

const m = (voxels: number) => voxels * BLOCK_M;

// Compass words become frame directions once we know which way the entrance faces.
// The entrance faces "out", so walking in you face the opposite compass direction.
function compassToFrame(dir: "north" | "south" | "east" | "west", entranceFaces: HouseGraph["entrance_faces"]): "deeper" | "nearer" | "left" | "right" | null {
  if (!entranceFaces) return null;
  const order = ["north", "east", "south", "west"];
  const walkIn = order[(order.indexOf(entranceFaces) + 2) % 4];
  const d = (order.indexOf(dir) - order.indexOf(walkIn) + 4) % 4;
  return (["deeper", "right", "nearer", "left"] as const)[d];
}

// Gap in metres between two boxes (0 when they touch or overlap).
const gapBetween = (a: Box, b: Box) => {
  const gx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1);
  const gy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1);
  const gz = Math.max(0, Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1) - 1);
  return m(Math.max(gx, gy, gz));
};
const overlapXZ = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

function relationCheck(r: Relation, A: Box & { base: Box }, B: Box & { base: Box }, g: HouseGraph): { pass: boolean; detail: string } | null {
  const margin = 0.25 / BLOCK_M; // centres must differ by at least 25 cm
  const a = A.base, b = B.base;
  const where = `${r.a} centre at ${m(a.cx).toFixed(1)} m across, ${m(a.cz).toFixed(1)} m in; ${r.b} centre at ${m(b.cx).toFixed(1)} m across, ${m(b.cz).toFixed(1)} m in`;
  let rel: string = r.rel;
  if (rel === "north_of" || rel === "south_of" || rel === "east_of" || rel === "west_of") {
    const f = compassToFrame(rel.replace("_of", "") as "north", g.entrance_faces);
    if (!f) return null; // a compass word cannot be checked without knowing which way the entrance faces
    rel = { deeper: "behind", nearer: "in_front_of", left: "left_of", right: "right_of" }[f];
  }
  switch (rel) {
    case "left_of": return { pass: a.cx < b.cx - margin, detail: where };
    case "right_of": return { pass: a.cx > b.cx + margin, detail: where };
    case "behind": return { pass: a.cz > b.cz + margin, detail: where };
    case "in_front_of": return { pass: a.cz < b.cz - margin, detail: where };
    case "inside": {
      const ok = a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;
      return { pass: ok, detail: `${r.a} stands from ${m(a.x0).toFixed(1)} to ${m(a.x1 + 1).toFixed(1)} m across and ${m(a.z0).toFixed(1)} to ${m(a.z1 + 1).toFixed(1)} m in; ${r.b} covers ${m(b.x0).toFixed(1)} to ${m(b.x1 + 1).toFixed(1)} m across and ${m(b.z0).toFixed(1)} to ${m(b.z1 + 1).toFixed(1)} m in` };
    }
    case "next_to": {
      const gap = gapBetween(a, b);
      return { pass: gap <= 2, detail: `${gap.toFixed(1)} m apart (next to means within 2 m)` };
    }
    case "against_wall_of":
    case "opens_into": {
      const gap = gapBetween(a, b);
      return { pass: gap <= 0.5, detail: `${gap.toFixed(1)} m apart (touching means within 0.5 m)` };
    }
    case "on_top_of": {
      const ok = overlapXZ(A, B) && A.y0 >= B.y1 - 0.5 / BLOCK_M && A.y0 <= B.y1 + 12 / BLOCK_M;
      return { pass: ok, detail: `${r.a} from ${m(A.y0).toFixed(1)} to ${m(A.y1 + 1).toFixed(1)} m up, ${r.b} from ${m(B.y0).toFixed(1)} to ${m(B.y1 + 1).toFixed(1)} m up; footprints ${overlapXZ(A, B) ? "overlap" : "do not overlap"}` };
    }
    case "below": {
      const ok = overlapXZ(A, B) && A.y1 <= B.y0 + 0.5 / BLOCK_M;
      return { pass: ok, detail: `${r.a} from ${m(A.y0).toFixed(1)} to ${m(A.y1 + 1).toFixed(1)} m up, ${r.b} from ${m(B.y0).toFixed(1)} to ${m(B.y1 + 1).toFixed(1)} m up` };
    }
    case "across_from": {
      const gap = gapBetween(a, b);
      return { pass: gap >= 2, detail: `${gap.toFixed(1)} m apart (across from means at least 2 m apart)` };
    }
  }
  return null;
}

const relWords: Record<string, string> = {
  left_of: "is left of", right_of: "is right of", in_front_of: "is nearer the entrance than", behind: "is further in than",
  north_of: "is north of", south_of: "is south of", east_of: "is east of", west_of: "is west of", inside: "is inside",
  next_to: "is next to", on_top_of: "is on top of", below: "is below", across_from: "is across from", opens_into: "opens into",
  against_wall_of: "is against the wall of",
};

function sizeChecks(e: Element, B: Box): Check[] {
  const out: Check[] = [];
  const spans = [m(B.x1 - B.x0 + 1), m(B.z1 - B.z0 + 1)].sort((a, b) => b - a);
  const h = m(B.y1 - B.y0 + 1);
  const tol = (v: number) => Math.max(0.35 * v, 1);
  const said = e.size.phrase ? ` ("${e.size.phrase}")` : "";
  if (e.size.length_m) {
    const ok = Math.abs(spans[0] - e.size.length_m) <= tol(e.size.length_m);
    out.push({ id: `size:${e.id}:length`, kind: "size", subject: e.id, text: `${e.name} is about ${e.size.length_m} m long${said}`, turns: e.turns, pass: ok, detail: `built ${spans[0].toFixed(1)} m long` });
  }
  if (e.size.width_m) {
    const ok = Math.abs(spans[1] - e.size.width_m) <= tol(e.size.width_m);
    out.push({ id: `size:${e.id}:width`, kind: "size", subject: e.id, text: `${e.name} is about ${e.size.width_m} m wide${said}`, turns: e.turns, pass: ok, detail: `built ${spans[1].toFixed(1)} m wide` });
  }
  if (e.size.height_m) {
    const ok = Math.abs(h - e.size.height_m) <= tol(e.size.height_m);
    out.push({ id: `size:${e.id}:height`, kind: "size", subject: e.id, text: `${e.name} is about ${e.size.height_m} m high${said}`, turns: e.turns, pass: ok, detail: `built ${h.toFixed(1)} m high` });
  }
  return out;
}

// Can you walk from outside the entrance into each room-like space? Breadth-first search over standing
// cells: a cell is standable when there is support below (or it is ground level) and 1.75 m of headroom.
// A step up or down of up to half a metre is allowed.
const ENCLOSED = new Set(["room", "kitchen", "courtyard", "verandah", "animal_shed", "corridor"]);
function reachability(g: HouseGraph, blocks: Block[], boxes: Boxes): Check[] {
  const solid = new Set<string>();
  for (const b of blocks) if (!FOLIAGE.has(b.m) && b.m !== "water") solid.add(`${b.x},${b.y},${b.z}`);
  const free = (x: number, y: number, z: number) => !solid.has(`${x},${y},${z}`);
  const HEAD = Math.ceil(1.75 / BLOCK_M), STEP = Math.round(0.5 / BLOCK_M);
  // A person is about 0.5 m wide, so a slit one block wide does not count as a way through.
  const WIDE = Math.max(1, Math.ceil(0.5 / BLOCK_M));
  const stand = (x: number, y: number, z: number) => {
    let floor = y === 0;
    for (let dx = 0; dx < WIDE; dx++) for (let dz = 0; dz < WIDE; dz++) {
      if (!floor && !free(x + dx, y - 1, z + dz)) floor = true;
      for (let h = 0; h < HEAD; h++) if (!free(x + dx, y + h, z + dz)) return false;
    }
    return floor;
  };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of blocks) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z); }
  x0 -= 4; x1 += 4; z0 -= 4; z1 += 4;
  // Start in front of the entrance, outside the build.
  const ent = g.entrance ? boxes.get(g.entrance) : undefined;
  const sx = ent ? Math.round(ent.base.cx) : Math.round((x0 + x1) / 2);
  const q: [number, number, number][] = [];
  for (let y = 0; y <= STEP; y++) if (stand(sx, y, z0)) { q.push([sx, y, z0]); break; }
  const seen = new Set<string>();
  const reached = new Set<string>();
  while (q.length) {
    const [x, y, z] = q.pop()!;
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    reached.add(`${x},${y},${z}`);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
      for (let dy = -STEP; dy <= STEP; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny > 80) continue;
        if (stand(nx, ny, nz)) { q.push([nx, ny, nz]); break; }
      }
    }
  }
  const out: Check[] = [];
  for (const e of g.elements) {
    if (!ENCLOSED.has(e.kind) || e.level !== "ground") continue;
    const B = boxes.get(e.id);
    if (!B) continue;
    // Standing somewhere well inside the outline, near the floor: a plinth outside the walls or a walk over the roof does not count.
    const inset = (lo: number, hi: number) => Math.min(Math.ceil(1 / BLOCK_M), Math.max(1, Math.floor((hi - lo) / 2)));
    const ix = inset(B.x0, B.x1), iz = inset(B.z0, B.z1), top = B.y0 + Math.round(1 / BLOCK_M);
    let ok = false;
    for (let x = B.x0 + ix; x <= B.x1 - ix && !ok; x++) for (let z = B.z0 + iz; z <= B.z1 - iz && !ok; z++) for (let y = B.y0; y <= top && !ok; y++) if (reached.has(`${x},${y},${z}`)) ok = true;
    out.push({ id: `reach:${e.id}`, kind: "reachable", subject: e.id, text: `you can walk in from outside to the ${e.name}`, turns: e.turns, pass: ok, detail: ok ? "a walkable path exists" : "no walkable path from the entrance reaches inside it (walls in the way, or no doorway)" });
  }
  return out;
}

// The entrance must have an opening at least 0.9 m wide and 1.9 m high through every row it occupies.
function entranceOpen(g: HouseGraph, blocks: Block[], boxes: Boxes): Check | null {
  const ent = g.entrance ? boxes.get(g.entrance) : undefined;
  if (!ent) return null;
  const e = g.elements.find((el) => el.id === g.entrance)!;
  const solid = new Set(blocks.filter((b) => !FOLIAGE.has(b.m) && b.m !== "water").map((b) => `${b.x},${b.y},${b.z}`));
  const W = Math.ceil(0.9 / BLOCK_M), H = Math.ceil(1.9 / BLOCK_M);
  const b = ent.base;
  let open = true;
  for (let z = b.z0; z <= b.z1 && open; z++) {
    let run = 0, best = 0;
    for (let x = b.x0 - 2; x <= b.x1 + 2; x++) {
      let clear = true;
      for (let y = Math.max(1, b.y0); y < Math.max(1, b.y0) + H && clear; y++) if (solid.has(`${x},${y},${z}`)) clear = false;
      run = clear ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best < W) open = false;
  }
  return { id: `open:${e.id}`, kind: "reachable", subject: e.id, text: `you can walk in through the ${e.name}`, turns: e.turns, pass: open, detail: open ? "there is an opening at least 0.9 m wide and 1.9 m high" : "the entrance is closed or too narrow to walk through" };
}

export function runChecks(g: HouseGraph, blocks: Block[], programError: string | null = null, blockM = DEFAULT_M): Check[] {
  BLOCK_M = blockM;
  const boxes = boxesByTag(blocks);
  const checks: Check[] = [];
  if (programError) checks.push({ id: "program", kind: "program", subject: "program", text: "the build program runs", turns: [], pass: false, detail: programError });
  const ids = new Set(g.elements.map((e) => e.id));
  for (const e of g.elements) {
    const B = boxes.get(e.id);
    checks.push({ id: `exists:${e.id}`, kind: "exists", subject: e.id, text: `there is a ${e.name}${e.original && e.original.toLowerCase() !== e.name.toLowerCase() ? ` (${e.original})` : ""}`, turns: e.turns, pass: !!B, detail: B ? `${B.n} voxels` : "nothing in the build carries this tag" });
    if (B) checks.push(...sizeChecks(e, B));
  }
  for (const r of g.relations) {
    const A = boxes.get(r.a), B = boxes.get(r.b);
    const ea = g.elements.find((e) => e.id === r.a)!, eb = g.elements.find((e) => e.id === r.b)!;
    // "against the wall of the wall of grain room" reads badly: when the other thing is itself a wall, just "against"
    const words = r.rel === "against_wall_of" && /\bwall\b/i.test(eb.name) ? "is against" : relWords[r.rel];
    const text = `the ${ea.name} ${words} the ${eb.name}`;
    if (!A || !B) {
      checks.push({ id: `rel:${r.a}:${r.rel}:${r.b}`, kind: "relation", subject: r.a, text, turns: r.turns, pass: false, detail: `missing ${!A ? r.a : r.b}` });
      continue;
    }
    const res = relationCheck(r, A, B, g);
    if (res) checks.push({ id: `rel:${r.a}:${r.rel}:${r.b}`, kind: "relation", subject: r.a, text, turns: r.turns, ...res });
  }
  // Every coloured voxel must belong to something that was said. Guesses must be tagged "unsaid:...".
  const stray = new Map<string, number>();
  for (const b of blocks) if (!b.t.startsWith("unsaid") && !(g.landmark && b.t.startsWith("known:")) && !ids.has(b.t)) stray.set(b.t, (stray.get(b.t) ?? 0) + 1);
  checks.push({
    id: "uncited", kind: "uncited", subject: "build", text: "everything in colour inside the place belongs to something that was said", turns: [], pass: stray.size === 0,
    detail: stray.size ? `tagged with things nobody said: ${[...stray].map(([t, n]) => `${t} (${n})`).join(", ")}` : "everything in colour is cited",
  });
  checks.push(...reachability(g, blocks, boxes));
  const open = entranceOpen(g, blocks, boxes);
  if (open) checks.push(open);
  return checks;
}

export function summarize(checks: Check[]) {
  const counted = checks.filter((c) => c.kind !== "program");
  const passed = counted.filter((c) => c.pass).length;
  return { passed, total: counted.length, rate: counted.length ? passed / counted.length : 0 };
}
