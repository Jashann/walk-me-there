// Export a place, with the land around it, as a Minecraft Java data pack.
// Our blocks are 0.25 m (0.5 m on very large places); Minecraft blocks are a metre, so a place comes out larger than life, which
// is fine to walk through. Guesses stay plain and muted, as in the viewer.
import type { Block } from "./world.ts";
import { crc32, deflateRawSync } from "node:zlib";
import type { Material } from "./graph.ts";
import { makeScenery, type Setting } from "../web/src/scenery.ts";

const MC: Record<Material, string> = {
  mud_brick: "minecraft:mud_bricks", fired_brick: "minecraft:bricks", lime_plaster: "minecraft:white_concrete_powder",
  mud_plaster: "minecraft:packed_mud", cement: "minecraft:light_gray_concrete", stone: "minecraft:stone_bricks",
  wood: "minecraft:oak_planks", dark_wood: "minecraft:dark_oak_planks", thatch: "minecraft:hay_block", tin: "minecraft:iron_block",
  earth: "minecraft:coarse_dirt", dung_floor: "minecraft:packed_mud", tile: "minecraft:terracotta", grass: "minecraft:grass_block",
  water: "minecraft:water", lava: "minecraft:lava", leaves: "minecraft:oak_leaves[persistent=true]", trunk: "minecraft:oak_log", cloth: "minecraft:white_wool",
  rope_weave: "minecraft:scaffolding", iron: "minecraft:iron_bars", clay: "minecraft:terracotta", glass: "minecraft:glass",
  white: "minecraft:white_concrete", blue: "minecraft:blue_concrete", green: "minecraft:green_concrete", yellow: "minecraft:yellow_concrete",
  red: "minecraft:red_concrete", unspecified: "minecraft:smooth_sandstone",
  marble: "minecraft:quartz_block", gold: "minecraft:gold_block", sandstone: "minecraft:sandstone", red_sandstone: "minecraft:red_sandstone",
  blue_tile: "minecraft:blue_glazed_terracotta", green_tile: "minecraft:green_glazed_terracotta", black_stone: "minecraft:blackstone", saffron: "minecraft:orange_wool", pink: "minecraft:pink_wool",
  vermilion: "minecraft:red_terracotta", dark_tile: "minecraft:deepslate_tiles", bark_shingle: "minecraft:spruce_planks", moss: "minecraft:moss_block",
  maple: "minecraft:acacia_leaves[persistent=true]", ginkgo: "minecraft:azalea_leaves[persistent=true]", pine: "minecraft:spruce_leaves[persistent=true]", blossom: "minecraft:cherry_leaves[persistent=true]", gravel: "minecraft:gravel",
};

// One flat block per material looks dead, so each material draws on a few real blocks, in patches.
const PALETTE: Partial<Record<string, [string, number][]>> = {
  mud_plaster: [["minecraft:smooth_sandstone", 60], ["minecraft:sandstone", 25], ["minecraft:stripped_oak_wood", 15]],
  mud_brick: [["minecraft:mud_bricks", 70], ["minecraft:packed_mud", 15], ["minecraft:bricks", 15]],
  fired_brick: [["minecraft:bricks", 80], ["minecraft:red_terracotta", 12], ["minecraft:terracotta", 8]],
  lime_plaster: [["minecraft:calcite", 50], ["minecraft:white_concrete", 35], ["minecraft:diorite", 15]],
  earth: [["minecraft:coarse_dirt", 75], ["minecraft:rooted_dirt", 25]],
  dung_floor: [["minecraft:packed_mud", 70], ["minecraft:brown_terracotta", 30]],
  leaves: [["minecraft:oak_leaves[persistent=true]", 60], ["minecraft:jungle_leaves[persistent=true]", 25], ["minecraft:azalea_leaves[persistent=true]", 15]],
  trunk: [["minecraft:spruce_log", 60], ["minecraft:oak_log", 40]],
  wood: [["minecraft:oak_planks", 60], ["minecraft:spruce_planks", 20], ["minecraft:stripped_oak_wood", 20]],
  dark_wood: [["minecraft:dark_oak_planks", 75], ["minecraft:spruce_planks", 25]],
  blue: [["minecraft:blue_concrete", 70], ["minecraft:lapis_block", 15], ["minecraft:cyan_terracotta", 15]],
  stone: [["minecraft:stone_bricks", 60], ["minecraft:cracked_stone_bricks", 20], ["minecraft:mossy_stone_bricks", 20]],
  white: [["minecraft:white_concrete", 80], ["minecraft:calcite", 20]],
  marble: [["minecraft:quartz_block", 70], ["minecraft:smooth_quartz", 20], ["minecraft:quartz_bricks", 10]],
  sandstone: [["minecraft:sandstone", 60], ["minecraft:cut_sandstone", 25], ["minecraft:smooth_sandstone", 15]],
  red_sandstone: [["minecraft:red_sandstone", 60], ["minecraft:cut_red_sandstone", 25], ["minecraft:smooth_red_sandstone", 15]],
  // the land around the place
  meadow: [["minecraft:grass_block", 85], ["minecraft:moss_block", 15]],
  lane: [["minecraft:coarse_dirt", 85], ["minecraft:rooted_dirt", 15]],
  yard: [["minecraft:coarse_dirt", 80], ["minecraft:rooted_dirt", 20]],
  soil: [["minecraft:coarse_dirt", 100]],
  soil_dark: [["minecraft:rooted_dirt", 60], ["minecraft:coarse_dirt", 40]],
  furrow: [["minecraft:farmland[moisture=7]", 100]],
  wheat: [["minecraft:wheat[age=7]", 100]],
  mustard: [["minecraft:dandelion", 100]],
  fodder: [["minecraft:fern", 60], ["minecraft:short_grass", 40]],
  cane: [["minecraft:jungle_leaves[persistent=true]", 70], ["minecraft:azalea_leaves[persistent=true]", 30]],
  straw: [["minecraft:hay_block", 100]],
  dung_cake: [["minecraft:brown_terracotta", 100]],
  window: [["minecraft:yellow_stained_glass", 100]],
  street: [["minecraft:stone_bricks", 100]],
  plaza: [["minecraft:smooth_stone", 100]],
  roof: [["minecraft:terracotta", 70], ["minecraft:brown_terracotta", 30]],
  cream: [["minecraft:smooth_sandstone", 70], ["minecraft:white_terracotta", 30]],
  peach: [["minecraft:pink_terracotta", 75], ["minecraft:white_terracotta", 25]],
  mint: [["minecraft:lime_terracotta", 70], ["minecraft:green_terracotta", 30]],
  sky: [["minecraft:light_blue_terracotta", 80], ["minecraft:cyan_terracotta", 20]],
};
const PLANTS = new Set(["wheat", "mustard", "fodder"]);

function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function pick(m: string, x: number, y: number, z: number) {
  const pal = PALETTE[m];
  if (!pal) return (MC as Record<string, string>)[m] ?? MC.unspecified;
  // patches a few blocks wide read as weathering; single speckled blocks read as noise
  let r = (hash(x >> 2, y >> 2, z >> 2) * 0.85 + hash(x, y, z) * 0.15) * pal.reduce((a, p) => a + p[1], 0);
  for (const [id, w] of pal) if ((r -= w) <= 0) return id;
  return pal[0][0];
}
// Parts nobody described stay plain and muted, so a guess never passes for a memory.
const GUESS = "minecraft:white_terracotta";

export type McPlan = { commands: string[]; count: number; x0: number; x1: number; z0: number; z1: number };

export function mcPlan(blocks: Block[], blockM: number, setting: Setting, doorM: number | null): McPlan {
  const commands: string[] = [];
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, top = 0;
  for (const b of blocks) {
    const x = (-b.x - 1) * blockM;
    if (x < bx0) bx0 = x;
    if (x + blockM > bx1) bx1 = x + blockM;
    if (b.z * blockM < bz0) bz0 = b.z * blockM;
    if ((b.z + 1) * blockM > bz1) bz1 = (b.z + 1) * blockM;
    if ((b.y + 1) * blockM > top) top = (b.y + 1) * blockM;
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const touch = (a: number, c: number) => { if (a < x0) x0 = a; if (a > x1) x1 = a; if (c < z0) z0 = c; if (c > z1) z1 = c; };
  if (blocks.length) {
    // The same land the app draws, nobody's memory. A viewer cell x covers export cells x+1 up, as for the blocks.
    const sc = makeScenery({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, doorM ?? (bx0 + bx1) / 2, setting, top);
    const r = Math.max(1, Math.round(sc.S / blockM));
    const cells = new Map<string, string>();
    for (const v of sc.vox) {
      if (v.y < -1) continue;
      if (PLANTS.has(v.m) && v.y !== 0) continue;
      for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) for (let j = 0; j < (PLANTS.has(v.m) ? 1 : r); j++) {
        const x = v.x * r + i + 1, y = v.y * r + j, z = v.z * r + k;
        cells.set(`${x},${y},${z}`, pick(v.m, x, y, z));
      }
    }
    // runs along z keep the file small
    const rows = new Map<string, [number, string][]>();
    for (const [k, id] of cells) {
      const [x, y, z] = k.split(",").map(Number);
      const row = `${x},${y}`;
      (rows.get(row) ?? rows.set(row, []).get(row)!).push([z, id]);
    }
    for (const [row, list] of rows) {
      const [x, y] = row.split(",").map(Number);
      list.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < list.length; ) {
        let j = i;
        while (j + 1 < list.length && list[j + 1][1] === list[i][1] && list[j + 1][0] === list[j][0] + 1) j++;
        touch(x, list[i][0]);
        touch(x, list[j][0]);
        commands.push(i === j ? `setblock ~${x} ~${y} ~${list[i][0]} ${list[i][1]}` : `fill ~${x} ~${y} ~${list[i][0]} ~${x} ~${y} ~${list[j][0]} ${list[i][1]}`);
        i = j + 1;
      }
    }
  }
  for (const b of blocks) {
    const x = -b.x;
    const id = b.t.startsWith("unsaid") ? GUESS : b.m === "gold" || b.m === "iron" || b.m === "glass" || b.m === "water" || b.m === "lava" ? MC[b.m] : pick(b.m, x, b.y, b.z);
    touch(x, b.z);
    commands.push(`setblock ~${x} ~${b.y} ~${b.z} ${id}`); // mirror x: facing +z (south) in Minecraft, -x is on the right
  }
  return { commands, count: commands.length, x0, x1, z0, z1 };
}

// What the app draws around a place, chosen the same way the web app chooses it.
export function planFor(h: { blocks: Block[]; blockM?: number; graph?: { surroundings?: string | null; landmark?: string | null; entrance?: string | null } | null }): McPlan {
  const M = h.blockM ?? 0.5, g = h.graph, a = g?.surroundings;
  const setting: Setting = a === "forest" ? "forest" : a === "town" ? "town" : a === "fields" ? "village" : g?.landmark ? "town" : "village";
  let lo = Infinity, hi = -Infinity;
  for (const b of h.blocks) if (b.t === g?.entrance) { lo = Math.min(lo, (-b.x - 1) * M); hi = Math.max(hi, -b.x * M); }
  return mcPlan(h.blocks, M, setting, lo <= hi ? (lo + hi) / 2 : null);
}

const TILE = 224; // spans at most 16 chunks a side, so one command stays within the game's limit of 256 chunks

// A data pack ready to drop in a world: setup makes room for the build, place builds it, done lets go of the area.
export function mcPack(plan: McPlan, title: string): Buffer {
  const setup = ["gamerule max_command_sequence_length 2000000"];
  for (let x = plan.x0 - 1; x <= plan.x1 + 1; x += TILE) for (let z = plan.z0 - 1; z <= plan.z1 + 1; z += TILE) {
    setup.push(`forceload add ~${x} ~${z} ~${Math.min(x + TILE - 1, plan.x1 + 1)} ~${Math.min(z + TILE - 1, plan.z1 + 1)}`);
  }
  const f = "data/walkmethere/function/";
  // The title comes from a model reading a stranger's words: one line only, or it could become a game command.
  title = title.replace(/\s+/g, " ").trim();
  return zip([
    ["pack.mcmeta", JSON.stringify({ pack: { description: `Walk Me There: ${title}`, min_format: 121, max_format: 121 } })],
    [f + "setup.mcfunction", setup.join("\n") + "\n"],
    [f + "place.mcfunction", [`# ${title}`, "# Built by Walk Me There.", ...plan.commands].join("\n") + "\n"],
    [f + "done.mcfunction", "forceload remove all\n"],
  ]);
}

function zip(files: [string, string][]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let at = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text), body = deflateRawSync(raw, { level: 9 }), n = Buffer.from(name), crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(at, 42);
    parts.push(local, n, body);
    central.push(cen, n);
    at += local.length + n.length + body.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, c, end]);
}
