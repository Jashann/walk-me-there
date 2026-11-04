// Voxel world and the sandbox that runs a build program.
// Frame: a voxel is a quarter metre; voxel (i, j, k) covers [i, i+1) x [j, j+1) x [k, k+1) quarter metres.
// y = 0 is the ground surface. Standing at the entrance looking in: -x is left, +x is right, +z is deeper in.
import vm from "node:vm";
import { MATERIALS, FOLIAGE, type Material } from "./graph.ts";
import { makeKit } from "./kit.ts";

export { BLOCK_M } from "./units.ts";
import { BLOCK_M } from "./units.ts";
// The world's extent in metres; voxel limits follow the scale the program chose.
export const LIMITS_M = { x: [-100, 100], y: [0, 60], z: [-20, 220] } as const;
// While a program runs it may place up to MAX_BLOCKS; what it sends on (after hidden voxels are dropped) is at
// most MAX_VISIBLE, which keeps large places at quarter-metre detail affordable.
const MAX_BLOCKS = 2_500_000;
const MAX_VISIBLE = 900_000;
const SEE_THROUGH = new Set<string>(["water", "glass", ...FOLIAGE]);

export type Block = { x: number; y: number; z: number; m: Material; t: string };

export class World {
  blocks = new Map<string, Block>();
  warnings: string[] = [];
  s = BLOCK_M; // metres per voxel: 0.25 for homes; a program may choose 0.5 for large places before placing anything

  key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, m: Material, t: string) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    const L = LIMITS_M, s = this.s;
    if (x * s < L.x[0] || x * s > L.x[1] || y * s < L.y[0] || y * s > L.y[1] || z * s < L.z[0] || z * s > L.z[1]) {
      if (this.warnings.length < 20) this.warnings.push(`block outside the world at ${x},${y},${z} (${t})`);
      return;
    }
    if (!MATERIALS.includes(m)) {
      if (this.warnings.length < 20) this.warnings.push(`unknown material "${m}" (${t}), used "unspecified"`);
      m = "unspecified";
    }
    if (this.blocks.size >= MAX_BLOCKS) throw new Error(`more than ${MAX_BLOCKS} blocks`);
    this.blocks.set(this.key(x, y, z), { x, y, z, m, t: String(t) });
  }

  remove(x: number, y: number, z: number) {
    this.blocks.delete(this.key(x, y, z));
  }

  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const [ax, bx] = order(x0, x1), [ay, by] = order(y0, y1), [az, bz] = order(z0, z1);
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) this.blocks.delete(this.key(x, y, z));
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Material, t: string) {
    const [ax, bx] = order(x0, x1), [ay, by] = order(y0, y1), [az, bz] = order(z0, z1);
    if ((bx - ax + 1) * (by - ay + 1) * (bz - az + 1) > MAX_BLOCKS) throw new Error(`fill too large for ${t}`);
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) this.set(x, y, z, m, t);
  }

  // A hollow rectangle of walls from y0 up `height` blocks.
  walls(x0: number, z0: number, x1: number, z1: number, y0: number, height: number, m: Material, t: string) {
    const [ax, bx] = order(x0, x1), [az, bz] = order(z0, z1);
    for (let y = y0; y < y0 + height; y++) {
      for (let x = ax; x <= bx; x++) { this.set(x, y, az, m, t); this.set(x, y, bz, m, t); }
      for (let z = az; z <= bz; z++) { this.set(ax, y, z, m, t); this.set(bx, y, z, m, t); }
    }
  }

  get(x: number, y: number, z: number) {
    return this.blocks.get(this.key(Math.round(x), Math.round(y), Math.round(z)));
  }

  list(): Block[] {
    return [...this.blocks.values()];
  }

  // Drop voxels nobody can ever see: boxed in on all six sides by opaque voxels. A described voxel counts as
  // boxed in only by described voxels, since guesses (and known parts) can be hidden in the viewer.
  visible(): Block[] {
    const hideable = (t: string) => t.startsWith("unsaid") || t.startsWith("known:");
    const out: Block[] = [];
    for (const b of this.blocks.values()) {
      let hidden = true;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = this.blocks.get(this.key(b.x + dx, b.y + dy, b.z + dz));
        if (!n || SEE_THROUGH.has(n.m) || SEE_THROUGH.has(b.m) || (hideable(n.t) && !hideable(b.t))) { hidden = false; break; }
      }
      if (!hidden || b.y === 0) out.push(b); // keep the bottom layer, so footprints and checks stay whole
    }
    if (out.length > MAX_VISIBLE) throw new Error(`more than ${MAX_VISIBLE} visible blocks`);
    return out;
  }
}

function order(a: number, b: number): [number, number] {
  a = Math.round(a); b = Math.round(b);
  return a <= b ? [a, b] : [b, a];
}

// Runs a build program (plain JavaScript written by the builder model) with only the kit in scope.
export function runProgram(code: string, timeoutMs = 4000): { world: World; error: string | null } {
  const world = new World();
  const kit = makeKit(world);
  const ctx = vm.createContext(Object.freeze({ ...kit, Math, console: { log: () => {} } }));
  try {
    new vm.Script(code, { filename: "build.js" }).runInContext(ctx, { timeout: timeoutMs });
    return { world, error: null };
  } catch (e) {
    // Point at the line, so a repair can fix it: "build.js:42 ... SyntaxError: missing ) after argument list".
    const stack = String((e as Error).stack ?? "");
    const at = stack.match(/build\.js:(\d+)/);
    const line = at ? code.split("\n")[Number(at[1]) - 1]?.trim().slice(0, 160) : "";
    const msg = String((e as Error).message ?? e);
    return { world, error: (at ? `line ${at[1]} (${line}): ${msg}` : msg).slice(0, 500) };
  }
}
