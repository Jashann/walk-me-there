// The checks are the reason to trust a build, so they must reject wrong builds. No model calls, no API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, summarize } from "../server/checks.ts";
import type { HouseGraph, Element, Kind, Material, Rel } from "../server/graph.ts";
import { runProgram, type Block } from "../server/world.ts";

const M = 0.25; // metres per voxel

const el = (id: string, kind: Kind, size: Partial<Element["size"]> = {}): Element => ({
  id, kind, name: id.replace(/_/g, " "), original: null, material: "unspecified", colour: null,
  size: { length_m: null, width_m: null, height_m: null, phrase: null, ...size }, level: "ground", detail: null, turns: [0],
});
const graph = (elements: Element[], relations: [string, Rel, string][] = [], over: Partial<HouseGraph> = {}): HouseGraph => ({
  title: "test", place: null, speaker_relation: null, entrance: null, entrance_faces: null, landmark: null, elements, gaps: [],
  relations: relations.map(([a, rel, b]) => ({ a, rel, b, turns: [0], quote: "as said" })), ...over,
});
function fill(t: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Material = "stone"): Block[] {
  const out: Block[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push({ x, y, z, m, t });
  return out;
}
const find = (g: HouseGraph, blocks: Block[], id: string) => {
  const c = runChecks(g, blocks, null, M).find((k) => k.id === id);
  assert.ok(c, `no check named ${id}`);
  return c;
};

const pumpAndGate = graph([el("pump", "handpump"), el("gate", "gate")], [["pump", "left_of", "gate"]]);

test("a build that matches what was said passes", () => {
  const blocks = [...fill("pump", 0, 0, 0, 1, 3, 1), ...fill("gate", 20, 0, 0, 21, 3, 1)];
  const checks = runChecks(pumpAndGate, blocks, null, M);
  const s = summarize(checks);
  assert.equal(s.passed, s.total, JSON.stringify(checks.filter((c) => !c.pass)));
});

test("something that was said but not built fails, and so do its positions", () => {
  const blocks = fill("gate", 20, 0, 0, 21, 3, 1);
  assert.equal(find(pumpAndGate, blocks, "exists:pump").pass, false);
  assert.equal(find(pumpAndGate, blocks, "rel:pump:left_of:gate").pass, false);
});

test("a thing built on the wrong side fails", () => {
  const blocks = [...fill("pump", 40, 0, 0, 41, 3, 1), ...fill("gate", 20, 0, 0, 21, 3, 1)];
  assert.equal(find(pumpAndGate, blocks, "rel:pump:left_of:gate").pass, false);
});

test("a thing outside the place it was said to be inside fails", () => {
  const g = graph([el("tree", "tree"), el("yard", "courtyard")], [["tree", "inside", "yard"]]);
  const yard = fill("yard", 0, 0, 0, 40, 0, 40);
  assert.equal(find(g, [...yard, ...fill("tree", 10, 1, 10, 11, 8, 11)], "rel:tree:inside:yard").pass, true);
  assert.equal(find(g, [...yard, ...fill("tree", 60, 1, 10, 61, 8, 11)], "rel:tree:inside:yard").pass, false);
});

test("a size far from what was said fails", () => {
  const g = graph([el("room", "room", { length_m: 3 })]);
  assert.equal(find(g, fill("room", 0, 0, 0, 11, 8, 7), "size:room:length").pass, true); // 3 m
  assert.equal(find(g, fill("room", 0, 0, 0, 79, 8, 7), "size:room:length").pass, false); // 20 m
});

test("colour nobody said fails, a tagged guess passes", () => {
  const g = graph([el("gate", "gate")]);
  const gate = fill("gate", 0, 0, 0, 3, 3, 1);
  assert.equal(find(g, [...gate, ...fill("swimming_pool", 20, 0, 0, 23, 1, 3)], "uncited").pass, false);
  assert.equal(find(g, [...gate, ...fill("unsaid:wall", 20, 0, 0, 23, 1, 3)], "uncited").pass, true);
});

test("a known feature is only allowed at a named landmark", () => {
  const gate = fill("gate", 0, 0, 0, 3, 3, 1);
  const dome = fill("known:dome", 20, 0, 0, 23, 3, 3);
  assert.equal(find(graph([el("gate", "gate")]), [...gate, ...dome], "uncited").pass, false);
  assert.equal(find(graph([el("gate", "gate")], [], { landmark: "Taj Mahal" }), [...gate, ...dome], "uncited").pass, true);
});

// A 5 m room with solid walls, with or without a doorway in its front wall.
function room(doorway: boolean): Block[] {
  const out: Block[] = [...fill("room", 0, 0, 0, 20, 0, 20, "earth")];
  for (let y = 1; y <= 12; y++) for (let i = 0; i <= 20; i++) {
    for (const [x, z] of [[i, 0], [i, 20], [0, i], [20, i]]) {
      if (doorway && z === 0 && x >= 9 && x <= 11 && y <= 9) continue;
      out.push({ x, y, z, m: "stone", t: "room" });
    }
  }
  return out;
}

test("a room you cannot walk into fails, and a doorway fixes it", () => {
  const g = graph([el("room", "room")]);
  const reach = (blocks: Block[]) => runChecks(g, blocks, null, M).find((c) => c.kind === "reachable")!;
  assert.equal(reach(room(false)).pass, false);
  assert.equal(reach(room(true)).pass, true);
});

test("a program that crashed is reported as failed", () => {
  const checks = runChecks(graph([]), [], "boom", M);
  assert.equal(checks.find((c) => c.kind === "program")?.pass, false);
});

test("a room built by the real kit needs a door to count as walkable", () => {
  const g = graph([el("room", "room")]);
  const reach = (code: string) => {
    const { world, error } = runProgram(code);
    assert.equal(error, null);
    return runChecks(g, [...world.blocks.values()], null, M).find((c) => c.kind === "reachable")!;
  };
  assert.equal(reach(`room({tag: "room", x0: 0, z0: 2, x1: 5, z1: 7});`).pass, false);
  assert.equal(reach(`room({tag: "room", x0: 0, z0: 2, x1: 5, z1: 7, doors: [{side: "front", at: "center"}]});`).pass, true);
});

test("a slit in a wall is not a way in, and a person-wide door is", () => {
  const g = graph([el("room", "room")]);
  const reach = (blocks: Block[]) => runChecks(g, blocks, null, M).find((c) => c.kind === "reachable")!;
  const withGap = (from: number, to: number) => {
    const out: Block[] = [...fill("room", 0, 0, 0, 20, 0, 20, "earth")];
    for (let y = 1; y <= 12; y++) for (let i = 0; i <= 20; i++) for (const [x, z] of [[i, 0], [i, 20], [0, i], [20, i]]) {
      if (z === 0 && x >= from && x <= to && y <= 9) continue;
      out.push({ x, y, z, m: "stone", t: "room" });
    }
    return out;
  };
  assert.equal(reach(withGap(10, 10)).pass, false); // 0.25 m
  assert.equal(reach(withGap(9, 12)).pass, true); // 1 m
});

test("a named wall built across a door blocks it", () => {
  const g = graph([el("room", "room")]);
  const { world, error } = runProgram(`room({tag: "room", x0: 0, z0: 2, x1: 5, z1: 7, doors: [{side: "front", at: "center"}]});
wall({x0: 0, z0: 2, x1: 5, z1: 2, height: 3, thick: 0.25, material: "stone", tag: "room"});`);
  assert.equal(error, null);
  assert.equal(runChecks(g, [...world.blocks.values()], null, M).find((c) => c.kind === "reachable")!.pass, false);
});

test("something floating far above its support fails", () => {
  const top = graph([el("cup", "object"), el("table", "furniture")], [["cup", "on_top_of", "table"]]);
  const table = fill("table", 0, 0, 0, 8, 3, 8);
  assert.equal(find(top, [...table, ...fill("cup", 2, 4, 2, 3, 5, 3)], "rel:cup:on_top_of:table").pass, true);
  assert.equal(find(top, [...table, ...fill("cup", 2, 100, 2, 3, 101, 3)], "rel:cup:on_top_of:table").pass, false);
});

test("the kit's own open gate counts as walkable, on the ground or on a plinth", () => {
  const g = graph([el("gate", "gate")], [], { entrance: "gate" });
  const open = (blocks: Block[]) => runChecks(g, blocks, null, M).find((c) => c.id === "open:gate")!.pass;
  const { world, error } = runProgram(`gate({tag: "gate", x: 0, z: 0, width: 3, height: 2.25, color: "blue", material: "wood"});`);
  assert.equal(error, null);
  assert.equal(open([...world.blocks.values()]), true);
  // A 2 m opening standing on a 1 m plinth: posts either side, a lintel above, nothing inside.
  const raised = [...fill("gate", 0, 4, 0, 1, 13, 1), ...fill("gate", 7, 4, 0, 8, 13, 1), ...fill("gate", 0, 13, 0, 8, 13, 1), ...fill("plinth", 0, 0, 0, 8, 3, 1)];
  assert.equal(open(raised), true);
  // The same gate with the opening filled in.
  assert.equal(open([...raised, ...fill("gate", 2, 4, 0, 6, 12, 1)]), false);
});
