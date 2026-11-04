// The building kit the builder model composes. Everything is in metres in the build frame
// (x: left is negative, right is positive as you walk in; z: deeper into the house; y: up, 0 is the ground).
// The kit draws each part in fine detail, so a short program produces a house that looks made.
// Every part carries a tag; sub-parts nobody described default to "unsaid:..." so they render as white clay.
import type { World } from "./world.ts";
import type { Material } from "./graph.ts";


function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

type Side = "front" | "back" | "left" | "right";
type Opening = { side: Side; at?: number | "center"; width?: number; height?: number; sill?: number; color?: string; tag?: string; open?: boolean; bars?: boolean };
type RoofStyle = "flat" | "parapet" | "crenellated" | "thatch" | "tin" | "tile" | "none";

// The trim that frames a wall of each material: corner pilasters, cornices, door jambs.
const TRIM: Partial<Record<Material, Material>> = {
  mud_plaster: "mud_brick", lime_plaster: "sandstone", white: "sandstone", marble: "marble", stone: "black_stone", fired_brick: "sandstone",
  sandstone: "red_sandstone", red_sandstone: "marble", gold: "gold", cement: "stone", mud_brick: "mud_plaster",
};

export function makeKit(w: World) {
  let S = w.s; // metres per voxel
  const v = (m: number) => Math.round(m / S); // metres -> voxel index (voxel i covers [i*S, (i+1)*S))
  // Large places (a temple complex, a bazaar street) can use half-metre voxels; call this first.
  const useScale = (metres: number) => {
    if (w.blocks.size) throw new Error("useScale must be called before anything is built");
    if (metres !== 0.25 && metres !== 0.5) throw new Error("useScale takes 0.25 or 0.5");
    S = w.s = metres;
  };
  // Low-level, in metres. Boxes are [min, max) and snap to the 0.25 m grid.
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Material, t: string) => {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)], [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    const i0 = v(ax), i1 = Math.max(i0 + 1, v(bx)), j0 = v(ay), j1 = Math.max(j0 + 1, v(by)), k0 = v(az), k1 = Math.max(k0 + 1, v(bz));
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) w.set(i, j, k, m, t);
  };
  const clear = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const i0 = v(Math.min(x0, x1)), i1 = v(Math.max(x0, x1)), j0 = v(Math.min(y0, y1)), j1 = v(Math.max(y0, y1)), k0 = v(Math.min(z0, z1)), k1 = v(Math.max(z0, z1));
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) w.blocks.delete(w.key(i, j, k));
  };
  const dot = (x: number, y: number, z: number, m: Material, t: string) => w.set(v(x), v(y), v(z), m, t);

  // ---------------------------------------------------------------- ground and floors
  function floor(o: { x0: number; z0: number; x1: number; z1: number; material?: Material; tag: string; y?: number; thick?: number }) {
    const y = o.y ?? 0;
    box(o.x0, y, o.z0, o.x1, y + (o.thick ?? S), o.z1, o.material ?? "earth", o.tag);
  }

  function path(o: { points: [number, number][]; width?: number; material?: Material; tag: string }) {
    const r = (o.width ?? 1.2) / 2;
    for (let p = 0; p + 1 < o.points.length; p++) {
      const [ax, az] = o.points[p], [bx, bz] = o.points[p + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (S / 2));
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
        box(x - r, 0, z - r, x + r, S, z + r, o.material ?? "earth", o.tag);
      }
    }
  }

  // ---------------------------------------------------------------- walls, rooms, roofs
  function wall(o: { x0: number; z0: number; x1: number; z1: number; height?: number; thick?: number; material?: Material; tag: string; coping?: boolean }) {
    const h = o.height ?? 2.4, t = o.thick ?? 0.5, m = o.material ?? "mud_plaster";
    const horizontal = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
    if (horizontal) box(o.x0, 0, o.z0, o.x1, h, o.z0 + t, m, o.tag);
    else box(o.x0, 0, o.z0, o.x0 + t, h, o.z1, m, o.tag);
    if (o.coping !== false) {
      if (horizontal) box(o.x0 - S, h, o.z0 - S, o.x1 + S, h + S, o.z0 + t + S, "mud_brick", o.tag);
      else box(o.x0 - S, h, o.z0 - S, o.x0 + t + S, h + S, o.z1 + S, "mud_brick", o.tag);
    }
  }

  // A walled enclosure (boundary wall of a compound) with an optional gap for the gate.
  function enclosure(o: { x0: number; z0: number; x1: number; z1: number; height?: number; material?: Material; tag: string; gap?: { side: Side; at?: number | "center"; width: number } }) {
    const t = 0.5;
    const sides: [Side, number, number, number, number][] = [
      ["front", o.x0, o.z0, o.x1, o.z0],
      ["back", o.x0, o.z1 - t, o.x1, o.z1 - t],
      ["left", o.x0, o.z0, o.x0, o.z1],
      ["right", o.x1 - t, o.z0, o.x1 - t, o.z1],
    ];
    for (const [side, x0, z0, x1, z1] of sides) {
      if (o.gap && o.gap.side === side) {
        const len = side === "front" || side === "back" ? x1 - x0 : z1 - z0;
        const start = side === "front" || side === "back" ? x0 : z0;
        const c = o.gap.at === undefined || o.gap.at === "center" ? start + len / 2 : start + o.gap.at;
        const a = c - o.gap.width / 2, b = c + o.gap.width / 2;
        if (side === "front" || side === "back") {
          wall({ x0, z0, x1: a, z1, height: o.height, material: o.material, tag: o.tag });
          wall({ x0: b, z0, x1, z1, height: o.height, material: o.material, tag: o.tag });
        } else {
          wall({ x0, z0, x1, z1: a, height: o.height, material: o.material, tag: o.tag });
          wall({ x0, z0: b, x1, z1, height: o.height, material: o.material, tag: o.tag });
        }
      } else wall({ x0, z0, x1: side === "left" || side === "right" ? x0 : x1, z1: side === "left" || side === "right" ? z1 : z0, height: o.height, material: o.material, tag: o.tag });
    }
  }

  function room(o: {
    tag: string; x0: number; z0: number; x1: number; z1: number; height?: number; wall?: Material; plinth?: Material | null;
    floor?: Material; roof?: RoofStyle; roofMaterial?: Material; roofTag?: string; beams?: boolean; doors?: Opening[]; windows?: Opening[];
    niches?: { side: Side; at?: number }[]; y?: number; trim?: Material | null;
  }) {
    const y = o.y ?? 0;
    const H = o.height ?? 3;
    const t = 0.5;
    const m = o.wall ?? "mud_plaster";
    const trim = o.trim === null ? null : (o.trim ?? TRIM[m] ?? m);
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    // floor
    box(x0, y, z0, x1, y + S, z1, o.floor ?? "dung_floor", o.tag);
    // walls
    box(x0, y, z0, x1, y + H, z0 + t, m, o.tag);
    box(x0, y, z1 - t, x1, y + H, z1, m, o.tag);
    box(x0, y, z0, x0 + t, y + H, z1, m, o.tag);
    box(x1 - t, y, z0, x1, y + H, z1, m, o.tag);
    // depth: corner pilasters and a cornice band standing a hand's width proud of the wall
    if (trim) {
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(cx - 2 * S, y, cz - 2 * S, cx + 2 * S, y + H, cz + 2 * S, trim, o.tag);
      box(x0 - S, y + H - 0.5, z0 - S, x1 + S, y + H - 0.25, z0, trim, o.tag);
      box(x0 - S, y + H - 0.5, z1, x1 + S, y + H - 0.25, z1 + S, trim, o.tag);
      box(x0 - S, y + H - 0.5, z0, x0, y + H - 0.25, z1, trim, o.tag);
      box(x1, y + H - 0.5, z0, x1 + S, y + H - 0.25, z1, trim, o.tag);
    }
    // a plinth band in a darker material, a hand's width proud of the wall
    if (o.plinth !== null) {
      const pm = o.plinth ?? "mud_brick";
      box(x0 - S, y, z0 - S, x1 + S, y + 0.5, z0, pm, o.tag);
      box(x0 - S, y, z1, x1 + S, y + 0.5, z1 + S, pm, o.tag);
      box(x0 - S, y, z0, x0, y + 0.5, z1, pm, o.tag);
      box(x1, y, z0, x1 + S, y + 0.5, z1, pm, o.tag);
    }
    const along = (s: Side): [number, number] => (s === "front" || s === "back" ? [x0, x1] : [z0, z1]);
    const centre = (s: Side, at: number | "center" | undefined, width: number) => {
      const [a, b] = along(s);
      return at === undefined || at === "center" ? (a + b) / 2 : a + at + width / 2;
    };
    const cut = (s: Side, c: number, width: number, bottom: number, top: number) => {
      const a = c - width / 2, b = c + width / 2;
      if (s === "front") clear(a, y + bottom, z0 - S, b, y + top, z0 + t);
      if (s === "back") clear(a, y + bottom, z1 - t, b, y + top, z1 + S);
      if (s === "left") clear(x0 - S, y + bottom, a, x0 + t, y + top, b);
      if (s === "right") clear(x1 - t, y + bottom, a, x1 + S, y + top, b);
    };
    const onFace = (s: Side, c: number, width: number, yb: number, yt: number, depth: number, mat: Material, tag: string, inset = 0) => {
      const a = c - width / 2, b = c + width / 2;
      if (s === "front") box(a, y + yb, z0 - depth + inset, b, y + yt, z0 + inset, mat, tag);
      if (s === "back") box(a, y + yb, z1 - inset, b, y + yt, z1 + depth - inset, mat, tag);
      if (s === "left") box(x0 - depth + inset, y + yb, a, x0 + inset, y + yt, b, mat, tag);
      if (s === "right") box(x1 - inset, y + yb, a, x1 + depth - inset, y + yt, b, mat, tag);
    };
    for (const d of o.doors ?? []) {
      const width = d.width ?? 1, height = d.height ?? 2.1, c = centre(d.side, d.at, width);
      const dtag = d.tag ?? `unsaid:door_${o.tag}`;
      cut(d.side, c, width, S, height);
      onFace(d.side, c, width + 0.5, height, height + S, S, "dark_wood", `unsaid:lintel_${o.tag}`); // wooden lintel
      if (trim) { onFace(d.side, c - width / 2 - S / 2, S, S, height, S, trim, o.tag); onFace(d.side, c + width / 2 + S / 2, S, S, height, S, trim, o.tag); } // jambs
      // door leaves stand open against the inside of the wall
      const leaf = (d.color ?? "dark_wood") as Material;
      if (d.open !== false) {
        const hw = width / 2;
        if (d.side === "front") { box(c - width / 2, y + S, z0 + t, c - width / 2 + S, y + height, z0 + t + hw, leaf, dtag); box(c + width / 2 - S, y + S, z0 + t, c + width / 2, y + height, z0 + t + hw, leaf, dtag); }
        if (d.side === "back") { box(c - width / 2, y + S, z1 - t - hw, c - width / 2 + S, y + height, z1 - t, leaf, dtag); box(c + width / 2 - S, y + S, z1 - t - hw, c + width / 2, y + height, z1 - t, leaf, dtag); }
        if (d.side === "left") { box(x0 + t, y + S, c - width / 2, x0 + t + hw, y + height, c - width / 2 + S, leaf, dtag); box(x0 + t, y + S, c + width / 2 - S, x0 + t + hw, y + height, c + width / 2, leaf, dtag); }
        if (d.side === "right") { box(x1 - t - hw, y + S, c - width / 2, x1 - t, y + height, c - width / 2 + S, leaf, dtag); box(x1 - t - hw, y + S, c + width / 2 - S, x1 - t, y + height, c + width / 2, leaf, dtag); }
      }
    }
    for (const win of o.windows ?? []) {
      const width = win.width ?? 0.75, height = win.height ?? 0.75, sill = win.sill ?? 1.0, c = centre(win.side, win.at, width);
      const wtag = win.tag ?? `unsaid:window_${o.tag}`;
      cut(win.side, c, width, sill, sill + height);
      onFace(win.side, c, width + 0.5, sill + height, sill + height + S, S, "dark_wood", `unsaid:lintel_${o.tag}`);
      onFace(win.side, c, width + 0.25, sill - S, sill, S, "dark_wood", wtag);
      if (win.bars !== false && S <= 0.25) for (let b = -width / 2 + S; b < width / 2; b += 2 * S) onFace(win.side, c + b + S / 2 - S / 2, S, sill, sill + height, S, "iron", wtag, -t / 2);
      if (win.color) { onFace(win.side, c - width / 2 - S, S * 2, sill, sill + height, S, win.color as Material, wtag); onFace(win.side, c + width / 2 + S, S * 2, sill, sill + height, S, win.color as Material, wtag); }
    }
    for (const n of o.niches ?? []) {
      const c = centre(n.side, n.at, 0.5);
      const a = c - 0.25, b = c + 0.25;
      if (n.side === "back") clear(a, y + 1.2, z1 - t, b, y + 1.7, z1 - t + S);
      if (n.side === "front") clear(a, y + 1.2, z0 + t - S, b, y + 1.7, z0 + t);
      if (n.side === "left") clear(x0 + t - S, y + 1.2, a, x0 + t, y + 1.7, b);
      if (n.side === "right") clear(x1 - t, y + 1.2, a, x1 - t + S, y + 1.7, b);
    }
    roofOver({ x0, z0, x1, z1, y: y + H, style: o.roof ?? "parapet", material: o.roofMaterial, tag: o.roofTag ?? `unsaid:roof_${o.tag}`, beams: o.beams !== false });
  }

  function roofOver(o: { x0: number; z0: number; x1: number; z1: number; y: number; style: RoofStyle; material?: Material; tag: string; beams?: boolean }) {
    const { x0, z0, x1, z1, y } = o;
    if (o.style === "none") return;
    if (o.style === "flat" || o.style === "parapet" || o.style === "crenellated") {
      const m = o.material ?? "mud_plaster";
      box(x0 - S, y, z0 - S, x1 + S, y + 0.25, z1 + S, m, o.tag);
      if (o.beams) {
        // rafter ends (shateer) poking out of the front and back walls under the roof slab
        for (let x = x0 + 0.5; x < x1 - 0.25; x += 1) {
          box(x, y - S, z0 - S, x + S, y, z0, "dark_wood", o.tag);
          box(x, y - S, z1, x + S, y, z1 + S, "dark_wood", o.tag);
        }
      }
      if (o.style === "parapet") {
        box(x0 - S, y + 0.25, z0 - S, x1 + S, y + 0.75, z0, m, o.tag);
        box(x0 - S, y + 0.25, z1, x1 + S, y + 0.75, z1 + S, m, o.tag);
        box(x0 - S, y + 0.25, z0, x0, y + 0.75, z1, m, o.tag);
        box(x1, y + 0.25, z0, x1 + S, y + 0.75, z1, m, o.tag);
        // a drain spout (parnala) at the front corner
        box(x1 - 0.75, y + 0.25, z0 - 3 * S, x1 - 0.5, y + 0.5, z0 - S, "tin", o.tag);
      }
      if (o.style === "crenellated") {
        // a parapet topped with merlons (kangura)
        const ring = (yb: number, yt: number, every: number) => {
          for (let x = x0 - S; x < x1 + S; x += every) { box(x, yb, z0 - S, x + 0.5, yt, z0, m, o.tag); box(x, yb, z1, x + 0.5, yt, z1 + S, m, o.tag); }
          for (let z = z0; z < z1; z += every) { box(x0 - S, yb, z, x0, yt, z + 0.5, m, o.tag); box(x1, yb, z, x1 + S, yt, z + 0.5, m, o.tag); }
        };
        ring(y + 0.25, y + 0.75, 0.5);
        ring(y + 0.75, y + 1.25, 1);
      }
      return;
    }
    // pitched roofs: stepped voxels rising to a ridge along x
    const m = o.material ?? (o.style === "thatch" ? "thatch" : o.style === "tin" ? "tin" : "tile");
    const depth = z1 - z0;
    const over = o.style === "thatch" ? 0.5 : 0.25;
    for (let d = 0; d <= depth / 2 + over; d += S) {
      const yy = y + d * (o.style === "thatch" ? 0.9 : 0.6);
      box(x0 - over, yy, z0 - over + d, x1 + over, yy + S * (o.style === "thatch" ? 2 : 1), z0 - over + d + S, m, o.tag);
      box(x0 - over, yy, z1 + over - d - S, x1 + over, yy + S * (o.style === "thatch" ? 2 : 1), z1 + over - d, m, o.tag);
    }
    // gable ends
    for (let d = 0; d <= depth / 2; d += S) {
      const yy = y + d * (o.style === "thatch" ? 0.9 : 0.6);
      box(x0, y, z0 + d, x0 + S, yy, z1 - d, "mud_plaster", o.tag);
      box(x1 - S, y, z0 + d, x1, yy, z1 - d, "mud_plaster", o.tag);
    }
  }

  // An open double gate in a wall line at z, centred on x. The leaves stand open, swung inward.
  function gate(o: { tag: string; x: number; z: number; width?: number; height?: number; color?: Material; material?: Material; studs?: boolean; arch?: boolean; posts?: Material; postsTag?: string }) {
    const W = o.width ?? 2.75, H = o.height ?? 3;
    const leaf = o.color ?? o.material ?? "wood";
    const a = o.x - W / 2, b = o.x + W / 2;
    const postTag = o.postsTag ?? o.tag;
    const pm = o.posts ?? "fired_brick";
    // posts and a lintel beam
    box(a - 0.5, 0, o.z, a, H + 0.5, o.z + 0.5, pm, postTag);
    box(b, 0, o.z, b + 0.5, H + 0.5, o.z + 0.5, pm, postTag);
    box(a - 0.5, H, o.z - S, b + 0.5, H + 0.25, o.z + 0.5 + S, "dark_wood", o.tag);
    if (o.arch) for (let i = 0; i < 4; i++) box(a + i * S, H - (3 - i) * S, o.z, b - i * S, H, o.z + 0.5, pm, postTag);
    else box(a - 0.5, H + 0.25, o.z, b + 0.5, H + 0.75, o.z + 0.5, pm, postTag);
    // the right leaf shut in the wall line, so the gate reads as a gate from outside; the left leaf swung right
    // round and folded back flat against the inside of the wall; half the width stays open to walk through
    const lw = W / 2;
    box(o.x, S, o.z + S, b, H - S, o.z + 2 * S, leaf, o.tag);
    box(a - lw, S, o.z + 0.5 + S, a, H - S, o.z + 0.5 + 2 * S, leaf, o.tag);
    if (o.studs !== false) {
      // iron straps and studs across both leaves
      for (const yy of [0.5, H / 2, H - 0.75]) {
        box(o.x + S, yy, o.z, b - S, yy + S, o.z + S, "iron", o.tag);
        box(a - lw + S, yy, o.z + 0.5 + 2 * S, a - S, yy + S, o.z + 0.5 + 3 * S, "iron", o.tag);
      }
    }
  }

  function verandah(o: { tag: string; x0: number; z0: number; x1: number; z1: number; height?: number; post?: Material; roof?: Material; open?: Side }) {
    const H = o.height ?? 2.8;
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    box(x0, 0, z0, x1, S, z1, "lime_plaster", o.tag);
    const n = Math.max(2, Math.round((x1 - x0) / 2.2) + 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0 - S) * i) / (n - 1);
      box(x, S, z0, x + S, H, z0 + S, o.post ?? "wood", o.tag);
      box(x - S, S, z0 - S, x + 2 * S, 2 * S, z0 + 2 * S, "stone", o.tag);
    }
    box(x0 - S, H, z0 - S, x1 + S, H + S, z1, "dark_wood", o.tag);
    box(x0 - S, H + S, z0 - S, x1 + S, H + 2 * S, z1, o.roof ?? "mud_plaster", o.tag);
  }

  function stairs(o: { tag: string; x: number; z: number; width?: number; toHeight?: number; direction?: "left" | "right" | "deeper" | "nearer"; material?: Material }) {
    const H = o.toHeight ?? 3, W = o.width ?? 1, m = o.material ?? "fired_brick";
    const n = Math.round(H / S);
    for (let i = 0; i < n; i++) {
      const d = i * 0.25; // tread 25 cm per 25 cm rise
      switch (o.direction ?? "deeper") {
        case "deeper": box(o.x, 0, o.z + d, o.x + W, (i + 1) * S, o.z + d + 0.25, m, o.tag); break;
        case "nearer": box(o.x, 0, o.z - d - 0.25, o.x + W, (i + 1) * S, o.z - d, m, o.tag); break;
        case "right": box(o.x + d, 0, o.z, o.x + d + 0.25, (i + 1) * S, o.z + W, m, o.tag); break;
        case "left": box(o.x - d - 0.25, 0, o.z, o.x - d, (i + 1) * S, o.z + W, m, o.tag); break;
      }
    }
  }

  function ladder(o: { tag: string; x: number; z: number; height?: number; along?: "x" | "z" }) {
    // a wooden ladder leaning on a wall: its foot about 0.75 m out from the wall, its top against it (a ladder
    // "along x" leans on a wall deeper in, +z; one "along z" leans on a wall to its right, +x)
    const H = o.height ?? 3.2;
    const alongX = (o.along ?? "x") === "x";
    const out = (y: number) => (1 - y / H) * 0.75;
    for (let y = 0; y < H; y += S) for (const side of [-0.25, 0.25]) {
      if (alongX) dot(o.x + side, y, o.z - out(y), "wood", o.tag);
      else dot(o.x - out(y), y, o.z + side, "wood", o.tag);
    }
    for (let y = 0.25; y < H; y += 0.5) {
      if (alongX) box(o.x - 0.25, y, o.z - out(y), o.x + 0.25 + S, y + S, o.z - out(y) + S, "wood", o.tag);
      else box(o.x - out(y), y, o.z - 0.25, o.x - out(y) + S, y + S, o.z + 0.25 + S, "wood", o.tag);
    }
  }


  // ---------------------------------------------------------------- things in the yard and rooms
  function charpai(o: { tag: string; x: number; z: number; along?: "x" | "z" }) {
    const L = 2, W = 1, ax = (o.along ?? "x") === "x";
    const lx = ax ? L : W, lz = ax ? W : L;
    const x0 = o.x - lx / 2, z0 = o.z - lz / 2;
    for (const [dx, dz] of [[0, 0], [lx - S, 0], [0, lz - S], [lx - S, lz - S]]) box(x0 + dx, 0, z0 + dz, x0 + dx + S, 0.5, z0 + dz + S, "dark_wood", o.tag);
    box(x0, 0.25, z0, x0 + lx, 0.5, z0 + S, "wood", o.tag);
    box(x0, 0.25, z0 + lz - S, x0 + lx, 0.5, z0 + lz, "wood", o.tag);
    box(x0, 0.25, z0, x0 + S, 0.5, z0 + lz, "wood", o.tag);
    box(x0 + lx - S, 0.25, z0, x0 + lx, 0.5, z0 + lz, "wood", o.tag);
    for (let x = x0 + S; x < x0 + lx - S; x += S) for (let z = z0 + S; z < z0 + lz - S; z += S) {
      const i = Math.round((x - x0) / S) + Math.round((z - z0) / S);
      dot(x, 0.25, z, i % 2 ? "rope_weave" : "cloth", o.tag);
    }
  }

  function handpump(o: { tag: string; x: number; z: number; platformTag?: string }) {
    // an India Mark II style pump: a slim column, a big pump head with a spout towards the entrance, and a
    // long handle rising back over it, on a small platform with a pot under the spout
    box(o.x - 0.75, 0, o.z - 0.75, o.x + 0.75, S, o.z + 0.75, "cement", o.platformTag ?? `unsaid:platform_${o.tag}`);
    box(o.x - S / 2, S, o.z - S / 2, o.x + S / 2, 1.0, o.z + S / 2, "iron", o.tag); // column
    box(o.x - 0.25, 1.0, o.z - 0.25, o.x + 0.25, 1.5, o.z + 0.25, "iron", o.tag); // pump head
    box(o.x - S / 2, 1.0, o.z - 0.75, o.x + S / 2, 1.25, o.z - 0.25, "iron", o.tag); // spout
    box(o.x - S / 2, 1.5, o.z - S / 2, o.x + S / 2, 1.75, o.z + S / 2, "iron", o.tag); // cap
    for (let k = 0; k < 5; k++) box(o.x - S / 2, 1.5 + k * 0.1, o.z + 0.25 + k * S, o.x + S / 2, 1.75 + k * 0.1, o.z + 0.25 + (k + 1) * S, "iron", o.tag); // handle, rising
    box(o.x - 0.25, S, o.z - 1.0, o.x + 0.25, 0.75, o.z - 0.5, "clay", o.tag); // a pot under the spout
  }

  function chulha(o: { tag: string; x: number; z: number; withPot?: boolean; potTag?: string }) {
    // a U-shaped clay stove, open at the front
    box(o.x - 0.5, 0, o.z - 0.25, o.x - 0.25, 0.5, o.z + 0.25, "clay", o.tag);
    box(o.x + 0.25, 0, o.z - 0.25, o.x + 0.5, 0.5, o.z + 0.25, "clay", o.tag);
    box(o.x - 0.5, 0, o.z + 0.25, o.x + 0.5, 0.5, o.z + 0.5, "clay", o.tag);
    box(o.x - 1, 0, o.z - 0.75, o.x + 1, S, o.z + 1, "mud_plaster", o.tag); // the plastered cooking floor round it
    box(o.x - 0.25, S, o.z - 0.25, o.x + 0.25, 0.5, o.z + 0.25, "saffron", o.tag); // embers in the mouth
    if (o.withPot !== false) box(o.x - 0.25, 0.5, o.z - 0.25, o.x + 0.25, 0.75, o.z + 0.25, "iron", o.potTag ?? o.tag);
  }

  function tandoor(o: { tag: string; x: number; z: number }) {
    for (let y = 0; y < 0.75; y += S) {
      const r = y < 0.5 ? 0.5 : 0.25;
      ring(o.x, y, o.z, r, "clay", o.tag);
    }
  }
  function ring(cx: number, y: number, cz: number, r: number, m: Material, t: string) {
    for (let x = -r; x <= r; x += S) for (let z = -r; z <= r; z += S) {
      const d = Math.hypot(x, z);
      if (d <= r + 0.01 && d >= r - S - 0.01) dot(cx + x, y, cz + z, m, t);
    }
  }
  function disc(cx: number, y: number, cz: number, r: number, m: Material, t: string) {
    for (let x = -r; x <= r; x += S) for (let z = -r; z <= r; z += S) if (Math.hypot(x, z) <= r + 0.01) dot(cx + x, y, cz + z, m, t);
  }

  function well(o: { tag: string; x: number; z: number; radius?: number; material?: Material }) {
    const r = o.radius ?? 0.75;
    for (let y = 0; y < 0.75; y += S) ring(o.x, y, o.z, r, o.material ?? "fired_brick", o.tag);
    disc(o.x, 0, o.z, r - S, "water", o.tag);
  }

  function pond(o: { tag: string; x0: number; z0: number; x1: number; z1: number }) {
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, rx = Math.abs(o.x1 - o.x0) / 2, rz = Math.abs(o.z1 - o.z0) / 2;
    const r = rng(o.tag);
    for (let x = -rx; x <= rx; x += S) for (let z = -rz; z <= rz; z += S) {
      const e = (x / rx) ** 2 + (z / rz) ** 2 + (r() - 0.5) * 0.08;
      if (e <= 0.82) dot(cx + x, 0, cz + z, "water", o.tag);
      else if (e <= 1.0) dot(cx + x, 0, cz + z, r() < 0.5 ? "earth" : "grass", o.tag);
    }
  }

  const TREES: Record<string, { leaves: Material; crown: number; height: number; spread: number; trunk: Material }> = {
    neem: { leaves: "leaves", crown: 2.6, height: 6, spread: 1.05, trunk: "trunk" },
    pipal: { leaves: "leaves", crown: 4.5, height: 8, spread: 1.3, trunk: "trunk" },
    banyan: { leaves: "leaves", crown: 5.5, height: 8, spread: 1.6, trunk: "trunk" },
    mango: { leaves: "leaves", crown: 3.5, height: 6, spread: 1.1, trunk: "dark_wood" },
    kikar: { leaves: "leaves", crown: 2.8, height: 5, spread: 1.5, trunk: "dark_wood" },
    fruit: { leaves: "leaves", crown: 2.2, height: 4, spread: 1.0, trunk: "trunk" },
    flowering: { leaves: "pink", crown: 3, height: 5.5, spread: 1.2, trunk: "dark_wood" },
    gulmohar: { leaves: "red", crown: 3.4, height: 6.5, spread: 1.4, trunk: "dark_wood" },
    sakura: { leaves: "blossom", crown: 3.2, height: 5.5, spread: 1.6, trunk: "dark_wood" },
    maple: { leaves: "maple", crown: 3, height: 6, spread: 1.35, trunk: "dark_wood" },
    ginkgo: { leaves: "ginkgo", crown: 2.8, height: 9, spread: 0.9, trunk: "trunk" },
    generic: { leaves: "leaves", crown: 2.8, height: 5.5, spread: 1.1, trunk: "trunk" },
  };

  // A tree with a tapered trunk, a few branches and a lumpy crown made of overlapping blobs.
  function tree(o: { tag: string; x: number; z: number; kind?: string; height?: number; crown?: number }) {
    if (o.kind === "palm") return palm({ tag: o.tag, x: o.x, z: o.z, height: o.height });
    if (o.kind === "cypress") return cypress({ tag: o.tag, x: o.x, z: o.z, height: o.height });
    if (o.kind === "pine") return pine({ tag: o.tag, x: o.x, z: o.z, height: o.height });
    if (o.kind === "bamboo") return bamboo({ tag: o.tag, x: o.x, z: o.z, height: o.height });
    const spec = TREES[o.kind ?? "generic"] ?? TREES.generic;
    const H = o.height ?? spec.height, C = o.crown ?? spec.crown;
    const r = rng(o.tag);
    const trunkTop = H - C * 0.7;
    for (let y = 0; y < trunkTop; y += S) {
      const w = y < 1 ? 0.75 : 0.5;
      box(o.x - w / 2, y, o.z - w / 2, o.x + w / 2, y + S, o.z + w / 2, spec.trunk, o.tag);
    }
    const blobs: [number, number, number, number][] = [[o.x, H - C * 0.55, o.z, C * 0.75]];
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2, d = C * (0.45 + r() * 0.35) * spec.spread;
      const bx = o.x + Math.cos(a) * d, bz = o.z + Math.sin(a) * d, by = H - C * (0.5 + r() * 0.35);
      blobs.push([bx, by, bz, C * (0.45 + r() * 0.2)]);
      // a branch out to the blob
      const steps = Math.ceil(d / S);
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        dot(o.x + (bx - o.x) * f, trunkTop - 0.25 + (by - trunkTop) * f * 0.6, o.z + (bz - o.z) * f, spec.trunk, o.tag);
      }
    }
    for (const [bx, by, bz, br] of blobs) {
      for (let x = -br; x <= br; x += S) for (let y = -br * 0.6; y <= br * 0.6; y += S) for (let z = -br; z <= br; z += S) {
        const e = (x / br) ** 2 + (y / (br * 0.6)) ** 2 + (z / br) ** 2;
        if (e <= 1 && (e < 0.7 || r() < 0.6)) dot(bx + x, by + y, bz + z, spec.leaves, o.tag);
      }
    }
  }

  function plant(o: { tag: string; x: number; z: number; kind?: "tulsi" | "flowers" | "bush" | "potted" }) {
    if (o.kind === "tulsi") {
      box(o.x - 0.5, 0, o.z - 0.5, o.x + 0.5, 1.0, o.z + 0.5, "lime_plaster", o.tag);
      box(o.x - 0.25, 1.0, o.z - 0.25, o.x + 0.25, 1.5, o.z + 0.25, "leaves", o.tag);
      return;
    }
    if (o.kind === "potted" || o.kind === "flowers") box(o.x - 0.25, 0, o.z - 0.25, o.x + 0.25, 0.5, o.z + 0.25, "clay", o.tag);
    const base = o.kind === "potted" || o.kind === "flowers" ? 0.5 : 0;
    const r = rng(o.tag);
    for (let x = -0.5; x <= 0.5; x += S) for (let y = 0; y <= 0.75; y += S) for (let z = -0.5; z <= 0.5; z += S)
      if (Math.hypot(x, y - 0.3, z) < 0.55 && r() < 0.8) dot(o.x + x, base + y, o.z + z, o.kind === "flowers" && r() < 0.3 ? "yellow" : "leaves", o.tag);
  }

  function field(o: { tag: string; x0: number; z0: number; x1: number; z1: number; crop?: "wheat" | "mustard" | "rice" | "sugarcane" | "vegetables" }) {
    const crop = o.crop ?? "wheat";
    const m: Material = crop === "mustard" ? "yellow" : crop === "wheat" ? "thatch" : "grass";
    const h = crop === "sugarcane" ? 2.0 : crop === "rice" ? 0.5 : 0.75;
    box(o.x0, 0, o.z0, o.x1, S, o.z1, "earth", o.tag);
    for (let x = Math.min(o.x0, o.x1); x < Math.max(o.x0, o.x1); x += 0.5) box(x, S, Math.min(o.z0, o.z1), x + S, S + h, Math.max(o.z0, o.z1), m, o.tag);
  }

  function animal(o: { tag: string; x: number; z: number; kind?: "buffalo" | "cow" | "goat" | "dog" | "horse"; facing?: "left" | "right" | "deeper" | "nearer" }) {
    const k = o.kind ?? "cow";
    const big = k === "buffalo" || k === "cow" || k === "horse";
    const L = big ? 2 : 1, H = big ? 1.25 : 0.5, B = big ? 0.75 : 0.5;
    const col: Material = k === "buffalo" ? "iron" : k === "cow" ? "white" : k === "goat" ? "dark_wood" : k === "horse" ? "wood" : "unspecified";
    const alongX = o.facing === "left" || o.facing === "right";
    const lx = alongX ? L : B, lz = alongX ? B : L;
    const leg = big ? 0.75 : 0.25;
    for (const [dx, dz] of [[0, 0], [lx - S, 0], [0, lz - S], [lx - S, lz - S]]) box(o.x - lx / 2 + dx, 0, o.z - lz / 2 + dz, o.x - lx / 2 + dx + S, leg, o.z - lz / 2 + dz + S, col, o.tag);
    box(o.x - lx / 2, leg, o.z - lz / 2, o.x + lx / 2, H, o.z + lz / 2, col, o.tag);
    const dir = o.facing ?? "nearer";
    const hx = dir === "left" ? o.x - lx / 2 - 0.5 : dir === "right" ? o.x + lx / 2 : o.x - 0.25;
    const hz = dir === "nearer" ? o.z - lz / 2 - 0.5 : dir === "deeper" ? o.z + lz / 2 : o.z - 0.25;
    box(hx, H - (big ? 0.25 : 0), hz, hx + 0.5, H + (big ? 0.25 : 0.25), hz + 0.5, col, o.tag);
  }

  // Generic furniture and objects, sized in metres. kind picks a recognisable shape.
  function object(o: { tag: string; x: number; z: number; kind?: string; w?: number; d?: number; h?: number; material?: Material; color?: Material; against?: Side }) {
    const kind = o.kind ?? "box";
    const m = (o.color ?? o.material ?? "wood") as Material;
    const shapes: Record<string, [number, number, number]> = {
      trunk: [1, 0.5, 0.5], chest: [1, 0.5, 0.5], table: [1.25, 0.75, 0.75], chair: [0.5, 0.5, 1], stool: [0.5, 0.5, 0.25], peedhi: [0.5, 0.5, 0.25],
      bench: [1.5, 0.5, 0.5], almirah: [1, 0.5, 2], cupboard: [1, 0.5, 2], shelf: [1, 0.25, 0.25], bed: [2, 1.5, 0.5], sofa: [2, 0.75, 0.75],
      tv: [0.75, 0.25, 0.5], matka: [0.5, 0.5, 0.5], pot: [0.5, 0.5, 0.5], haystack: [2, 2, 1.75], toori: [2, 2, 1.75], trough: [1.5, 0.5, 0.5],
      khurli: [1.5, 0.5, 0.5], water_tank: [1.25, 1.25, 1.25], box: [0.5, 0.5, 0.5],
    };
    const [sw, sd, sh] = shapes[kind] ?? shapes.box;
    const W = o.w ?? sw, D = o.d ?? sd, H = o.h ?? sh;
    const x0 = o.x - W / 2, z0 = o.z - D / 2;
    switch (kind) {
      case "table": case "bench": case "stool": case "peedhi":
        box(x0, H - S, z0, x0 + W, H, z0 + D, m, o.tag);
        for (const [dx, dz] of [[0, 0], [W - S, 0], [0, D - S], [W - S, D - S]]) box(x0 + dx, 0, z0 + dz, x0 + dx + S, H - S, z0 + dz + S, m, o.tag);
        return;
      case "chair":
        box(x0, 0.5 - S, z0, x0 + W, 0.5, z0 + D, m, o.tag);
        box(x0, 0, z0, x0 + S, 0.5, z0 + S, m, o.tag); box(x0 + W - S, 0, z0, x0 + W, 0.5, z0 + S, m, o.tag);
        box(x0, 0, z0 + D - S, x0 + W, 1.0, z0 + D, m, o.tag);
        return;
      case "bed":
        box(x0, 0, z0, x0 + W, 0.5, z0 + D, "dark_wood", o.tag);
        box(x0 + S, 0.5, z0 + S, x0 + W - S, 0.75, z0 + D - S, "cloth", o.tag);
        box(x0, 0.5, z0, x0 + S, 1.0, z0 + D, "dark_wood", o.tag);
        return;
      case "matka": case "pot":
        box(o.x - 0.25, 0, o.z - 0.25, o.x + 0.25, 0.25, o.z + 0.25, "clay", o.tag);
        dot(o.x, 0.25, o.z, "clay", o.tag);
        return;
      case "haystack": case "toori": {
        for (let y = 0; y < H; y += S) {
          const rr = (W / 2) * (1 - (y / H) * 0.7);
          disc(o.x, y, o.z, rr, "thatch", o.tag);
        }
        return;
      }
      case "trough": case "khurli":
        box(x0, 0, z0, x0 + W, 0.5, z0 + D, "mud_plaster", o.tag);
        box(x0 + S, 0.25, z0 + S, x0 + W - S, 0.5, z0 + D - S, "water", o.tag);
        return;
      case "tv":
        box(x0, 0, z0, x0 + W, 0.5, z0 + D, "dark_wood", o.tag);
        box(x0 + S, 0.5, z0 + S, x0 + W - S, 1.0, z0 + D, "iron", o.tag);
        return;
      default:
        box(x0, 0, z0, x0 + W, H, z0 + D, m, o.tag);
        if (kind === "trunk" || kind === "chest") box(x0, H - S, z0, x0 + W, H, z0 + D, "iron", o.tag);
        if (kind === "almirah" || kind === "cupboard") box(o.x - S / 2, 0.75, z0 - S, o.x + S / 2, 1.25, z0, "iron", o.tag);
    }
  }

  // ---------------------------------------------------------------- grand places
  // A horizontal ring of voxels between two radii around (cx, cz) at height y (metres), voxel centres tested.
  function layer(cx: number, y: number, cz: number, rOut: number, rIn: number, m: Material, t: string) {
    const j = v(y);
    for (let i = Math.floor((cx - rOut) / S) - 1; i <= Math.ceil((cx + rOut) / S); i++)
      for (let k = Math.floor((cz - rOut) / S) - 1; k <= Math.ceil((cz + rOut) / S); k++) {
        const d = Math.hypot((i + 0.5) * S - cx, (k + 0.5) * S - cz);
        if (d <= rOut && d >= rIn) w.set(i, j, k, m, t);
      }
  }

  function finialAt(x: number, y: number, z: number, h: number, m: Material, t: string) {
    for (let yy = 0; yy < h; yy += S) layer(x, y + yy, z, yy < h * 0.25 || (yy > h * 0.45 && yy < h * 0.6) ? Math.max(S, h * 0.12) : S * 0.6, 0, m, t);
  }

  // Domes: "onion" (Sikh and Mughal), "bulb" (fuller, less pointed), "half" (a hemisphere), "stupa" (hemisphere on a drum).
  function dome(o: { tag: string; x: number; z: number; y?: number; radius: number; shape?: "onion" | "bulb" | "half" | "stupa"; material?: Material; finial?: Material | false; drum?: number; drumMaterial?: Material; ribs?: number; ribMaterial?: Material }) {
    const R = o.radius, m = o.material ?? "marble", shape = o.shape ?? "onion";
    let base = o.y ?? 0;
    const drum = o.drum ?? (shape === "stupa" ? R * 0.4 : 0);
    for (let y = 0; y < drum; y += S) layer(o.x, base + y, o.z, R * 0.94, R * 0.94 - S * 1.5, o.drumMaterial ?? m, o.tag);
    base += drum;
    const H = shape === "half" || shape === "stupa" ? R : shape === "bulb" ? R * 1.4 : R * 1.85;
    const prof = (t: number) =>
      shape === "half" || shape === "stupa"
        ? R * Math.sqrt(Math.max(0, 1 - t * t))
        : shape === "bulb"
          ? t < 0.35 ? R * (0.9 + 0.15 * Math.sin((Math.PI / 2) * (t / 0.35))) : R * 1.05 * Math.pow(Math.cos((Math.PI / 2) * ((t - 0.35) / 0.65)), 0.9)
          : t < 0.36 ? R * (0.84 + 0.38 * Math.sin((Math.PI / 2) * (t / 0.36))) : R * 1.22 * Math.pow(Math.cos((Math.PI / 2) * ((t - 0.36) / 0.64)), 0.85);
    let prev = prof(0);
    const ribs = R / S >= 8 ? o.ribs ?? 0 : 0, rm = o.ribMaterial ?? (m === "gold" ? "yellow" : m === "marble" ? "white" : m);
    for (let y = 0; y < H; y += S) {
      const r = prof(y / H);
      layer(o.x, base + y, o.z, r, Math.max(0, Math.min(r, prev) - S * 1.2), m, o.tag);
      if (ribs && r > S * 2) for (let k = 0; k < ribs; k++) {
        const a = (k / ribs) * Math.PI * 2;
        dot(o.x + Math.cos(a) * (r - S / 2), base + y, o.z + Math.sin(a) * (r - S / 2), rm, o.tag);
      }
      prev = r;
    }
    if (o.finial !== false) finialAt(o.x, base + H, o.z, Math.max(1, R * 0.45), o.finial ?? "gold", o.tag);
  }

  // A round tower or minaret, tapering a little, with balconies and a cap.
  function tower(o: { tag: string; x: number; z: number; height: number; radius?: number; material?: Material; balconies?: number; cap?: "dome" | "chhatri" | "cone" | "flat"; capMaterial?: Material; square?: boolean }) {
    const R = o.radius ?? 1.5, H = o.height, m = o.material ?? "marble";
    for (let y = 0; y < H; y += S) {
      const r = R * (1 - 0.15 * (y / H));
      if (o.square) {
        box(o.x - r, y, o.z - r, o.x + r, y + S, o.z - r + S, m, o.tag); box(o.x - r, y, o.z + r - S, o.x + r, y + S, o.z + r, m, o.tag);
        box(o.x - r, y, o.z - r, o.x - r + S, y + S, o.z + r, m, o.tag); box(o.x + r - S, y, o.z - r, o.x + r, y + S, o.z + r, m, o.tag);
      } else layer(o.x, y, o.z, r, r - S * 1.5, m, o.tag);
    }
    const n = o.balconies ?? Math.max(1, Math.round(H / 12));
    for (let b = 1; b <= n; b++) {
      const y = (H * b) / (n + 1), r = R * (1 - 0.15 * (y / H)) + 0.7;
      layer(o.x, y, o.z, r, 0, m, o.tag);
      for (let yy = S; yy < 0.75; yy += S) layer(o.x, y + yy, o.z, r, r - S, m, o.tag);
    }
    const top = R * 0.85;
    const cap = o.cap ?? "dome";
    if (cap === "dome") dome({ tag: o.tag, x: o.x, z: o.z, y: H, radius: top * 1.1, shape: "onion", material: o.capMaterial ?? m });
    if (cap === "chhatri") chhatri({ tag: o.tag, x: o.x, z: o.z, y: H, size: top * 2.2, material: m, domeMaterial: o.capMaterial });
    if (cap === "cone") for (let y = 0; y < top * 2.5; y += S) layer(o.x, H + y, o.z, top * (1 - y / (top * 2.5)) + S / 2, 0, o.capMaterial ?? m, o.tag);
    if (cap === "flat") { layer(o.x, H, o.z, top + 0.5, 0, m, o.tag); for (let yy = S; yy < 0.75; yy += S) layer(o.x, H + yy, o.z, top + 0.5, top + 0.5 - S, m, o.tag); }
  }

  // An open pavilion on four pillars with a deep eave and a small dome (a chhatri).
  function chhatri(o: { tag: string; x: number; z: number; y?: number; size?: number; material?: Material; domeMaterial?: Material }) {
    const L = o.size ?? 3, y = o.y ?? 0, m = o.material ?? "sandstone", h = L * 0.9;
    const a = L / 2;
    box(o.x - a, y, o.z - a, o.x + a, y + S, o.z + a, m, o.tag);
    const p = Math.max(S, 0.25);
    for (const [dx, dz] of [[-a, -a], [a - p, -a], [-a, a - p], [a - p, a - p]]) box(o.x + dx, y + S, o.z + dz, o.x + dx + p, y + h, o.z + dz + p, m, o.tag);
    box(o.x - a - 0.5, y + h, o.z - a - 0.5, o.x + a + 0.5, y + h + S, o.z + a + 0.5, m, o.tag);
    box(o.x - a, y + h + S, o.z - a, o.x + a, y + h + 2 * S, o.z + a, m, o.tag);
    dome({ tag: o.tag, x: o.x, z: o.z, y: y + h + 2 * S, radius: L * 0.42, shape: "bulb", material: o.domeMaterial ?? m });
  }

  // A wall of arched openings along a line (x0,z0)-(x1,z1): cloisters, gateways, arcaded facades.
  function arcade(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; height?: number; thick?: number; bay?: number; pointed?: boolean; material?: Material; openTag?: string }) {
    const y = o.y ?? 0, H = o.height ?? 4.5, T = o.thick ?? 0.75, bay = o.bay ?? 3, m = o.material ?? "sandstone";
    const alongX = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
    const a0 = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1), a1 = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
    const c = alongX ? o.z0 : o.x0; // the wall's line
    if (alongX) box(a0, y, c, a1, y + H, c + T, m, o.tag);
    else box(c, y, a0, c + T, y + H, a1, m, o.tag);
    const n = Math.max(1, Math.round((a1 - a0) / bay));
    const step = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const mid = a0 + step * (i + 0.5), hw = step * 0.31, spring = H * 0.5, rise = hw * (o.pointed === false ? 1 : 1.35);
      const cut = (lo: number, hi: number, yb: number, yt: number) => (alongX ? clear(lo, yb, c - S, hi, yt, c + T + S) : clear(c - S, yb, lo, c + T + S, yt, hi));
      cut(mid - hw, mid + hw, y, y + spring);
      for (let h = 0; h < rise; h += S) {
        const f = h / rise;
        const half = o.pointed === false ? hw * Math.sqrt(1 - f * f) : hw * (1 - Math.pow(f, 1.5));
        if (half >= S / 2) cut(mid - half, mid + half, y + spring + h, y + spring + h + S);
      }
    }
    // a cornice along the top
    if (alongX) box(a0 - S, y + H, c - S, a1 + S, y + H + S, c + T + S, m, o.tag);
    else box(c - S, y + H, a0 - S, c + T + S, y + H + S, a1 + S, m, o.tag);
  }

  function colonnade(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; height?: number; spacing?: number; radius?: number; material?: Material; beam?: boolean }) {
    const y = o.y ?? 0, H = o.height ?? 4, sp = o.spacing ?? 2.5, R = o.radius ?? 0.35, m = o.material ?? "marble";
    const len = Math.hypot(o.x1 - o.x0, o.z1 - o.z0), n = Math.max(1, Math.round(len / sp));
    for (let i = 0; i <= n; i++) {
      const x = o.x0 + ((o.x1 - o.x0) * i) / n, z = o.z0 + ((o.z1 - o.z0) * i) / n;
      layer(x, y, z, R + S, 0, m, o.tag);
      for (let yy = S; yy < H - S; yy += S) layer(x, y + yy, z, R, 0, m, o.tag);
      layer(x, y + H - S, z, R + S, 0, m, o.tag);
    }
    if (o.beam !== false) {
      const [ax, bx] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [az, bz] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
      box(ax - R - S, y + H, az - R - S, bx + R + S, y + H + 0.5, bz + R + S, m, o.tag);
    }
  }

  // A sunken pool with a walkway rim and steps down into the water on every side.
  function pool(o: { tag: string; x0: number; z0: number; x1: number; z1: number; rim?: Material; rimWidth?: number; rimTag?: string; steps?: boolean }) {
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    const rw = o.rimWidth ?? 2, rim = o.rim ?? "marble", rt = o.rimTag ?? o.tag;
    box(x0, 0, z0, x1, 0.5, z0 + rw, rim, rt); box(x0, 0, z1 - rw, x1, 0.5, z1, rim, rt);
    box(x0, 0, z0, x0 + rw, 0.5, z1, rim, rt); box(x1 - rw, 0, z0, x1, 0.5, z1, rim, rt);
    let ix0 = x0 + rw, ix1 = x1 - rw, iz0 = z0 + rw, iz1 = z1 - rw;
    if (o.steps !== false) {
      box(ix0, 0, iz0, ix1, S, iz0 + 0.5, rim, rt); box(ix0, 0, iz1 - 0.5, ix1, S, iz1, rim, rt);
      box(ix0, 0, iz0, ix0 + 0.5, S, iz1, rim, rt); box(ix1 - 0.5, 0, iz0, ix1, S, iz1, rim, rt);
      ix0 += 0.5; ix1 -= 0.5; iz0 += 0.5; iz1 -= 0.5;
    }
    box(ix0, 0, iz0, ix1, S, iz1, "water", o.tag);
  }

  // A raised walkway over water or ground, from one end to the other, with railings and lamps.
  function causeway(o: { tag: string; x0: number; z0: number; x1: number; z1: number; width?: number; y?: number; material?: Material; railing?: Material | false; lamps?: boolean; lampTag?: string }) {
    const W = o.width ?? 3, y = o.y ?? 0.5, m = o.material ?? "marble";
    const alongX = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
    const a0 = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1), a1 = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
    const c = alongX ? o.z0 : o.x0;
    const deck = (lo: number, hi: number, yb: number, yt: number, ca: number, cb: number, mm: Material, t: string) => (alongX ? box(lo, yb, ca, hi, yt, cb, mm, t) : box(ca, yb, lo, cb, yt, hi, mm, t));
    deck(a0, a1, 0, y, c - W / 2, c + W / 2, m, o.tag);
    if (o.railing !== false) {
      const rm = (o.railing ?? m) as Material;
      for (const side of [c - W / 2, c + W / 2 - S]) {
        deck(a0, a1, y + 0.75, y + 1, side, side + S, rm, o.tag);
        for (let a = a0; a < a1; a += 1) deck(a, a + S, y, y + 0.75, side, side + S, rm, o.tag);
      }
    }
    if (o.lamps !== false) for (let a = a0 + 2; a < a1 - 1; a += 6) for (const side of [c - W / 2, c + W / 2 - S]) {
      deck(a, a + S, y, y + 2.25, side, side + S, "gold", o.lampTag ?? o.tag);
      deck(a, a + S, y + 2.25, y + 2.25 + 2 * S, side, side + S, "glass", o.lampTag ?? o.tag); // the lantern
      deck(a, a + S, y + 2.25 + 2 * S, y + 2.5 + 2 * S, side, side + S, "gold", o.lampTag ?? o.tag);
    }
  }

  // Wide stairs rising `height` metres in a direction, across the box x0..x1, z0..z1.
  function steps(o: { tag: string; x0: number; z0: number; x1: number; z1: number; height: number; direction?: "deeper" | "nearer" | "left" | "right"; material?: Material }) {
    const m = o.material ?? "stone", dir = o.direction ?? "deeper";
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    const n = Math.max(1, Math.round(o.height / S));
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n, top = (i + 1) * S;
      if (dir === "deeper") box(x0, 0, z0 + (z1 - z0) * f0, x1, top, z1, m, o.tag);
      if (dir === "nearer") box(x0, 0, z0, x1, top, z1 - (z1 - z0) * f0, m, o.tag);
      if (dir === "right") box(x0 + (x1 - x0) * f0, 0, z0, x1, top, z1, m, o.tag);
      if (dir === "left") box(x0, 0, z0, x1 - (x1 - x0) * f0, top, z1, m, o.tag);
      void f1;
    }
  }

  // A raised platform (a plinth for a monument, a dais) with optional steps in the middle of one side.
  function platform(o: { tag: string; x0: number; z0: number; x1: number; z1: number; height?: number; material?: Material; steps?: Side }) {
    const h = o.height ?? 1, m = o.material ?? "stone";
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    box(x0, 0, z0, x1, h, z1, m, o.tag);
    box(x0 - S, h - S, z0 - S, x1 + S, h, z1 + S, m, o.tag);
    if (o.steps) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, run = h * 1.6, wd = Math.min(4, (x1 - x0) / 3);
      if (o.steps === "front") steps({ tag: o.tag, x0: cx - wd / 2, z0: z0 - run, x1: cx + wd / 2, z1: z0, height: h, direction: "deeper", material: m });
      if (o.steps === "back") steps({ tag: o.tag, x0: cx - wd / 2, z0: z1, x1: cx + wd / 2, z1: z1 + run, height: h, direction: "nearer", material: m });
      if (o.steps === "left") steps({ tag: o.tag, x0: x0 - run, z0: cz - wd / 2, x1: x0, z1: cz + wd / 2, height: h, direction: "right", material: m });
      if (o.steps === "right") steps({ tag: o.tag, x0: x1, z0: cz - wd / 2, x1: x1 + run, z1: cz + wd / 2, height: h, direction: "left", material: m });
    }
  }

  // A building of several floors: each floor a room with windows, a cornice between floors, balconies if asked.
  function building(o: { tag: string; x0: number; z0: number; x1: number; z1: number; floors?: number; floorHeight?: number; wall?: Material; trim?: Material; roof?: RoofStyle; roofMaterial?: Material; roofTag?: string; doors?: Opening[]; windows?: number | Opening[]; balcony?: boolean; floorTags?: string[]; y?: number }) {
    const F = o.floors ?? 2, FH = o.floorHeight ?? 3.2, y0 = o.y ?? 0, trim = o.trim ?? "dark_wood";
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    const given = Array.isArray(o.windows) ? o.windows : null;
    const nWin = given ? 0 : (o.windows as number | undefined) ?? Math.max(1, Math.floor((x1 - x0) / 2.5));
    for (let f = 0; f < F; f++) {
      const tag = o.floorTags?.[f] ?? o.tag;
      const wins: Opening[] = given ? [...given] : [];
      for (let i = 0; i < nWin; i++) {
        const at = ((x1 - x0) * (i + 0.5)) / nWin - 0.4;
        if (f === 0 && (o.doors ?? []).some((d) => d.side === "front" && Math.abs((d.at === "center" || d.at === undefined ? (x1 - x0) / 2 - 0.5 : d.at) - at) < 1.2)) continue;
        wins.push({ side: "front", at, width: 0.8, height: 1.25, sill: 0.9, bars: f === 0 });
      }
      room({ tag, x0, z0, x1, z1, y: y0 + f * FH, height: FH, wall: o.wall, trim: o.trim, plinth: f === 0 ? undefined : null, roof: f === F - 1 ? o.roof ?? "parapet" : "none", roofMaterial: o.roofMaterial, roofTag: o.roofTag, beams: f === F - 1, doors: f === 0 ? o.doors ?? [{ side: "front", at: "center" }] : [], windows: wins });
      if (f > 0) box(x0 - S, y0 + f * FH - S, z0 - S, x1 + S, y0 + f * FH, z1 + S, trim, tag); // cornice between floors
      if (f > 0 && o.balcony) {
        const by = y0 + f * FH;
        box(x0 + 0.5, by, z0 - 0.75, x1 - 0.5, by + S, z0, "stone", tag);
        box(x0 + 0.5, by + S, z0 - 0.75, x1 - 0.5, by + 1, z0 - 0.75 + S, "iron", tag);
      }
    }
  }

  // A temple tower (shikhara): a square base that tapers in tiers to a ribbed top stone and a finial.
  function spire(o: { tag: string; x: number; z: number; y?: number; base?: number; height?: number; material?: Material; top?: Material }) {
    const B = o.base ?? 6, H = o.height ?? 12, y = o.y ?? 0, m = o.material ?? "sandstone";
    for (let h = 0; h < H; h += S) {
      const t = h / H, half = (B / 2) * (1 - 0.82 * Math.pow(t, 1.5));
      const inset = Math.floor(h / 0.75) % 2 ? S : 0; // horizontal tiers
      box(o.x - half + inset, y + h, o.z - half + inset, o.x + half - inset, y + h + S, o.z + half - inset, m, o.tag);
    }
    const r = (B / 2) * 0.24;
    layer(o.x, y + H, o.z, r * 1.3, 0, o.top ?? m, o.tag);
    layer(o.x, y + H + S, o.z, r * 1.5, 0, o.top ?? m, o.tag);
    layer(o.x, y + H + 2 * S, o.z, r * 1.3, 0, o.top ?? m, o.tag);
    finialAt(o.x, y + H + 3 * S, o.z, 1.2, "gold", o.tag);
  }

  // A tall flagpole with a cloth flag near the top (a Nishan Sahib, a temple flag).
  function flagpole(o: { tag: string; x: number; z: number; height?: number; color?: Material; base?: Material }) {
    const H = o.height ?? 12;
    box(o.x - 0.75, 0, o.z - 0.75, o.x + 0.75, 0.75, o.z + 0.75, o.base ?? "marble", o.tag);
    box(o.x, 0.75, o.z, o.x + S, H, o.z + S, "saffron", o.tag);
    // a long triangular pennant tapering away from the pole, and a slim steel finial
    const L = Math.max(2.5, H * 0.22), fh = Math.max(1.6, L * 0.6);
    for (let d = 0; d < L; d += S) {
      const half = (fh / 2) * (1 - d / L);
      if (half < S / 2) break;
      box(o.x + S + d, H - 0.5 - fh / 2 - half, o.z, o.x + 2 * S + d, H - 0.5 - fh / 2 + half, o.z + S, o.color ?? "saffron", o.tag);
    }
    box(o.x, H, o.z, o.x + S, H + 1, o.z + S, "iron", o.tag);
  }

  function lamp(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 2.5;
    box(o.x, 0, o.z, o.x + S, H, o.z + S, "black_stone", o.tag);
    box(o.x - S, H, o.z - S, o.x + 2 * S, H + 2 * S, o.z + 2 * S, "gold", o.tag);
  }

  function palm(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 7;
    const r = rng(o.tag);
    const lean = (r() - 0.5) * 1.2;
    for (let y = 0; y < H; y += S) dot(o.x + lean * (y / H) ** 2, y, o.z, "trunk", o.tag);
    const tx = o.x + lean, ty = H;
    for (let f = 0; f < 9; f++) {
      const a = (f / 9) * Math.PI * 2 + r() * 0.3, L = 2.2 + r() * 1.2;
      for (let d = 0; d < L; d += S * 0.8) dot(tx + Math.cos(a) * d, ty + 0.4 * d - 0.28 * d * d, o.z + Math.sin(a) * d, "leaves", o.tag);
    }
  }

  // A Mughal arch portal (iwan) set into a facade: a tall rectangular frame proud of the wall with a recessed
  // pointed arch, an inlaid border, and a doorway at the back of the recess.
  function portal(o: { tag: string; side?: Side; x?: number; z?: number; width?: number; height?: number; depth?: number; y?: number; material?: Material; inlay?: Material | false; doorTag?: string }) {
    const side = o.side ?? "front", W = o.width ?? 5, Hh = o.height ?? 8, D = o.depth ?? 1.5, y = o.y ?? 0, m = o.material ?? "marble";
    // local frame: u along the facade, d into the building, origin at the facade line
    const ux = side === "front" || side === "back" ? 1 : 0, uz = 1 - ux;
    const out = side === "front" || side === "left" ? -1 : 1; // outward direction along the facade normal
    const cx = o.x ?? 0, cz = o.z ?? 0;
    const at = (u: number, d: number) => [cx + ux * u + (1 - ux) * -out * d, cz + uz * u + (1 - uz) * -out * d] as const;
    const fb = (u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, mat: Material, t: string) => {
      const [ax, az] = at(u0, d0), [bx, bz] = at(u1, d1);
      box(ax, y0, az, bx, y1, bz, mat, t);
    };
    const fc = (u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) => {
      const [ax, az] = at(u0, d0), [bx, bz] = at(u1, d1);
      clear(ax, y0, az, bx, y1, bz);
    };
    // the frame, standing 0.5 m proud of the facade
    fb(-W / 2 - 1, W / 2 + 1, y, y + Hh + 1, -0.5, 0, m, o.tag);
    if (o.inlay !== false) {
      const im = (o.inlay ?? "black_stone") as Material;
      for (let u = -W / 2 - 0.75; u < W / 2 + 0.75; u += 0.5) fb(u, u + S, y + Hh + 0.5, y + Hh + 0.75, -0.75, -0.5, im, o.tag);
      for (let yy = y + 0.25; yy < y + Hh + 0.5; yy += 0.5) { fb(-W / 2 - 0.75, -W / 2 - 0.5, yy, yy + S, -0.75, -0.5, im, o.tag); fb(W / 2 + 0.5, W / 2 + 0.75, yy, yy + S, -0.75, -0.5, im, o.tag); }
    }
    // the recess: straight sides up to the spring, then a pointed arch
    const spring = Hh * 0.62, rise = Hh - spring;
    fc(-W / 2, W / 2, y + S, y + spring, -0.6, D);
    for (let h = 0; h < rise; h += S) {
      const half = (W / 2) * (1 - Math.pow(h / rise, 1.6));
      if (half >= S / 2) fc(-half, half, y + spring + h, y + spring + h + S, -0.6, D);
    }
    // back wall of the recess, pierced by a tall arched doorway into the dark inside and a small arched
    // window above it, so the recess reads as deep shade, the way an iwan does
    fb(-W / 2, W / 2, y, y + spring + rise, D, D + S, m, o.tag);
    const dw = Math.max(1, W * 0.42), dh = Math.max(2.4, spring * 0.95), drise = dw * 0.55;
    const arch = (cy: number, w: number, h: number, r: number) => {
      fc(-w / 2, w / 2, cy, cy + h, D - S, D + 1.5);
      for (let k = 0; k < r; k += S) {
        const half = (w / 2) * (1 - Math.pow(k / r, 1.6));
        if (half >= S / 2) fc(-half, half, cy + h + k, cy + h + k + S, D - S, D + 1.5);
      }
    };
    arch(y + S, dw, dh, drise);
    // the dim inside behind the doorway (so no arch ever shows the sky through the building)
    fb(-dw / 2 - S, dw / 2 + S, y, y + dh + drise + S, D + 1.5, D + 1.5 + S, "black_stone", o.doorTag ?? o.tag);
    if (spring + rise - (dh + drise) > 2.2) arch(y + dh + drise + 0.75, Math.max(S * 2, dw * 0.5), Math.max(0.75, (spring + rise - dh - drise) * 0.35), dw * 0.3);
  }

  // A face of a building for carving: centre (cx, cz) on the wall's outer surface, outward normal (nx, nz).
  type Face = { cx: number; cz: number; nx: number; nz: number; width: number };
  // Clear a pointed-arch recess into a face: w wide, h tall (to the point), d deep, its centre u along the face.
  function recessArch(f: Face, u: number, yb: number, aw: number, h: number, d: number) {
    const tx = -f.nz, tz = f.nx; // along the face
    const reach = Math.max(aw, d) + 1;
    const ax = f.cx + tx * u, az = f.cz + tz * u;
    const spring = h - aw * 0.62;
    for (let i = Math.floor((ax - reach) / S); i <= Math.ceil((ax + reach) / S); i++)
      for (let k = Math.floor((az - reach) / S); k <= Math.ceil((az + reach) / S); k++) {
        const px = (i + 0.5) * S - ax, pz = (k + 0.5) * S - az;
        const along = px * tx + pz * tz, inward = -(px * f.nx + pz * f.nz);
        if (inward < -S || inward > d) continue;
        for (let yy = yb; yy < yb + h; yy += S) {
          const up = yy - yb;
          const half = up < spring ? aw / 2 : (aw / 2) * (1 - Math.pow((up - spring) / (h - spring), 1.5));
          if (Math.abs(along) <= half) w.remove(i, v(yy), k);
        }
      }
  }
  // Paint a thin rectangular frame (an inlaid border) on a face around u, from yb to yt.
  function frameOn(f: Face, u: number, yb: number, yt: number, wd: number, m: Material, t: string) {
    const tx = -f.nz, tz = f.nx;
    for (let a = -wd / 2; a <= wd / 2; a += S) {
      dot(f.cx + tx * (u + a) - f.nx * S * 0.5, yt, f.cz + tz * (u + a) - f.nz * S * 0.5, m, t);
      dot(f.cx + tx * (u + a) - f.nx * S * 0.5, yb, f.cz + tz * (u + a) - f.nz * S * 0.5, m, t);
    }
    for (let yy = yb; yy <= yt; yy += S) for (const a of [-wd / 2, wd / 2]) dot(f.cx + tx * (u + a) - f.nx * S * 0.5, yy, f.cz + tz * (u + a) - f.nz * S * 0.5, m, t);
  }
  // A square plan with chamfered corners, as a solid or a shell, between two heights.
  function chamferedSquare(cx: number, cz: number, half: number, cham: number, y0: number, y1: number, thick: number | null, m: Material, t: string) {
    const inside = (dx: number, dz: number, h: number, c: number) => Math.abs(dx) <= h && Math.abs(dz) <= h && Math.abs(dx) + Math.abs(dz) <= 2 * h - c;
    for (let i = Math.floor((cx - half) / S) - 1; i <= Math.ceil((cx + half) / S); i++)
      for (let k = Math.floor((cz - half) / S) - 1; k <= Math.ceil((cz + half) / S); k++) {
        const dx = (i + 0.5) * S - cx, dz = (k + 0.5) * S - cz;
        if (!inside(dx, dz, half, cham)) continue;
        if (thick !== null && inside(dx, dz, half - thick, cham)) continue;
        for (let yy = y0; yy < y1; yy += S) w.set(i, v(yy), k, m, t);
      }
  }

  // A Mughal tomb (the Taj Mahal, Humayun's tomb): a square hall with chamfered corners; on each face a tall
  // pishtaq (a framed portal rising above the parapet with a deep arch) flanked by two tiers of arched
  // recesses, and arched recesses on the corners; slim pinnacles at the corners; a drum, a great onion dome
  // and a gold finial; four chhatris round the dome.
  function mausoleum(o: { tag: string; x: number; z: number; y?: number; width?: number; height?: number; material?: Material; inlay?: Material; domeRadius?: number; domeTag?: string; chhatriTag?: string; finial?: Material }) {
    const Wd = o.width ?? 40, H = o.height ?? Wd * 0.62, y = o.y ?? 0, m = o.material ?? "marble", inl = o.inlay ?? "black_stone";
    const h = Wd / 2, c = Wd * 0.17, T = Math.max(1, Wd * 0.04);
    chamferedSquare(o.x, o.z, h, c, y, y + H, T, m, o.tag);
    chamferedSquare(o.x, o.z, h, c, y + H - S, y + H, null, m, o.tag); // the roof
    chamferedSquare(o.x, o.z, h * 0.5, c * 0.5, y, y + H - S, null, "black_stone", o.tag); // the dark tomb chamber (hidden; stops see-through)
    chamferedSquare(o.x, o.z, h + S, c, y + H - 2 * S, y + H - S, S, inl, o.tag); // an inlaid band under the parapet
    chamferedSquare(o.x, o.z, h, c, y + H, y + H + 0.75, S, m, o.tag); // parapet
    const flatHalf = h - c, pw = Math.min(Wd * 0.36, flatHalf * 1.4);
    const faces: Face[] = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([nx, nz]) => ({ cx: o.x + nx * h, cz: o.z + nz * h, nx, nz, width: flatHalf * 2 }));
    for (const f of faces) {
      const tx = -f.nz, tz = f.nx;
      // the pishtaq: a frame proud of the wall, rising above the parapet
      for (let a = -pw / 2; a <= pw / 2; a += S) for (let yy = y; yy < y + H + 1.5; yy += S) for (let d = 0; d < 0.75; d += S) dot(f.cx + tx * a + f.nx * d, yy, f.cz + tz * a + f.nz * d, m, o.tag);
      const front: Face = { ...f, cx: f.cx + f.nx * 0.75, cz: f.cz + f.nz * 0.75 };
      recessArch(front, 0, y + S, pw * 0.7, H * 0.86, T * 0.9 + 0.75);
      recessArch({ ...front, cx: front.cx - f.nx * (T * 0.9 + 0.75), cz: front.cz - f.nz * (T * 0.9 + 0.75) }, 0, y + S, pw * 0.26, H * 0.36, T + 2); // the inner door
      frameOn(front, 0, y + H * 0.04, y + H * 0.94, pw * 0.86, inl, o.tag);
      // two tiers of arched recesses either side
      const bayU = (pw / 2 + flatHalf) / 2, bw = Math.min(flatHalf - pw / 2, 6) * 0.62;
      for (const u of [-bayU, bayU]) for (const [yb, hh] of [[y + H * 0.06, H * 0.4], [y + H * 0.52, H * 0.4]]) {
        recessArch(f, u, yb, bw, hh, T * 0.6);
        frameOn(f, u, yb - S, yb + hh + S, bw + 2 * S, inl, o.tag);
      }
    }
    // the chamfered corners: two tiers of recesses, and a slim pinnacle at each edge
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const r2 = Math.SQRT1_2, mid = h - c / 2;
      const f: Face = { cx: o.x + sx * mid, cz: o.z + sz * mid, nx: sx * r2, nz: sz * r2, width: c * Math.SQRT2 };
      for (const [yb, hh] of [[y + H * 0.06, H * 0.4], [y + H * 0.52, H * 0.4]]) recessArch(f, 0, yb, f.width * 0.5, hh, T * 0.6);
      for (const [px, pz] of [[sx * h, sz * (h - c)], [sx * (h - c), sz * h]]) {
        for (let yy = y; yy < y + H + 2.5; yy += S) layer(o.x + px, yy, o.z + pz, S * 1.2, 0, m, o.tag);
        finialAt(o.x + px, y + H + 2.5, o.z + pz, 1, o.finial ?? "gold", o.tag);
      }
    }
    // drum, dome and finial; chhatris round it
    const R = o.domeRadius ?? Wd * 0.3;
    dome({ tag: o.domeTag ?? o.tag, x: o.x, z: o.z, y: y + H, radius: R, shape: "onion", material: m, drum: R * 0.55, drumMaterial: m, finial: o.finial ?? "gold" });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chhatri({ tag: o.chhatriTag ?? o.tag, x: o.x + sx * h * 0.66, z: o.z + sz * h * 0.66, y: y + H, size: Wd * 0.14, material: m, domeMaterial: m });
  }

  // A Sikh temple in the manner of Harmandir Sahib: a square marble lower storey with arched doorways on every
  // side; a fully gilded upper storey with projecting jharokha windows; gold kiosks at the corners; a fluted
  // lotus dome on a ring of petals; a tall gold finial with a little umbrella.
  function sikhTemple(o: { tag: string; x: number; z: number; y?: number; width?: number; lower?: Material; upper?: Material; domeTag?: string; kioskTag?: string; domeRadius?: number }) {
    const Wd = o.width ?? 12, y = o.y ?? 0, lo = o.lower ?? "marble", up = o.upper ?? "gold";
    const h = Wd / 2, F1 = Wd * 0.42, F2 = Wd * 0.34, T = 0.75;
    chamferedSquare(o.x, o.z, h, 0, y, y + F1, T, lo, o.tag);
    chamferedSquare(o.x, o.z, h + 0.5, 0, y + F1, y + F1 + S, null, lo, o.tag); // cornice and floor
    chamferedSquare(o.x, o.z, h + 0.5, 0, y + F1 - S, y + F1, S, up, o.tag); // a gold band under it
    const h2 = h * 0.86;
    chamferedSquare(o.x, o.z, h2, 0, y + F1 + S, y + F1 + F2, T, up, o.tag);
    chamferedSquare(o.x, o.z, h2 + 0.5, 0, y + F1 + F2, y + F1 + F2 + S, null, up, o.tag);
    for (let i = 0; i < Math.round((8 * h2) / (2 * S)); i++) {
      // a crenellated gold parapet: every other voxel round the edge
      const per = 8 * h2, a = (i * 2 * S) % per, side = Math.floor(a / (2 * h2)), along = (a % (2 * h2)) - h2;
      const [px, pz] = side === 0 ? [along, -h2] : side === 1 ? [h2, along] : side === 2 ? [-along, h2] : [-h2, -along];
      dot(o.x + px, y + F1 + F2 + S, o.z + pz, up, o.tag);
    }
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const f: Face = { cx: o.x + nx * h, cz: o.z + nz * h, nx, nz, width: Wd };
      for (const u of [-Wd * 0.28, 0, Wd * 0.28]) {
        recessArch(f, u, y + S, Wd * (u === 0 ? 0.14 : 0.1), F1 * (u === 0 ? 0.78 : 0.66), T + 1);
        frameOn(f, u, y, y + F1 * (u === 0 ? 0.84 : 0.72), Wd * (u === 0 ? 0.18 : 0.14), up, o.tag);
      }
      // jharokhas on the gold storey: little balconies proud of the wall, each under a tiny dome
      const tx = -nz, tz = nx;
      for (const u of [-Wd * 0.26, Wd * 0.26]) {
        const bx = o.x + nx * (h2 + 0.5) + tx * u, bz = o.z + nz * (h2 + 0.5) + tz * u;
        box(bx - 0.75 * Math.abs(tx) - 0.5 * Math.abs(nx), y + F1 + 0.75, bz - 0.75 * Math.abs(tz) - 0.5 * Math.abs(nz), bx + 0.75 * Math.abs(tx) + 0.5 * Math.abs(nx), y + F1 + 2.5, bz + 0.75 * Math.abs(tz) + 0.5 * Math.abs(nz), up, o.tag);
        dome({ tag: o.tag, x: bx, z: bz, y: y + F1 + 2.5, radius: 0.75, shape: "bulb", material: up, finial: false });
      }
      recessArch({ cx: o.x + nx * h2, cz: o.z + nz * h2, nx, nz, width: Wd }, 0, y + F1 + 0.75, Wd * 0.12, F2 * 0.62, T + 1);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chhatri({ tag: o.kioskTag ?? o.tag, x: o.x + sx * (h2 - 0.75), z: o.z + sz * (h2 - 0.75), y: y + F1 + F2 + S, size: Wd * 0.15, material: up, domeMaterial: up });
    // the lotus: a ring of upturned petals round the dome's foot, then the fluted dome and its finial
    const R = o.domeRadius ?? Wd * 0.27, base = y + F1 + F2 + S;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, px = o.x + Math.cos(a) * R * 1.02, pz = o.z + Math.sin(a) * R * 1.02;
      for (let yy = 0; yy < R * 0.35; yy += S) layer(px, base + yy, pz, Math.max(S * 0.6, R * 0.16 * (1 - yy / (R * 0.35))), 0, up, o.domeTag ?? o.tag);
    }
    dome({ tag: o.domeTag ?? o.tag, x: o.x, z: o.z, y: base, radius: R, shape: "onion", material: up, drum: R * 0.25, ribs: 16, ribMaterial: "yellow", finial: false });
    // the finial starts inside the dome's tip, so it always stands on it
    const top = base + R * 0.25 + R * 1.85 * 0.8;
    finialAt(o.x, top, o.z, R * 1.0, up, o.domeTag ?? o.tag);
    layer(o.x, top + R * 0.75, o.z, R * 0.26, 0, up, o.domeTag ?? o.tag); // the little umbrella, on the finial
    finialAt(o.x, top + R * 0.75 + S, o.z, R * 0.3, up, o.domeTag ?? o.tag);
  }

  // ---------------------------------------------------------------- Japan
  // A sculpted Japanese pine: a leaning, twisting trunk and flat cloud-like pads of needles on level branches.
  function pine(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 6, r = rng(o.tag);
    const lean = (r() - 0.5) * 1.6, leanZ = (r() - 0.5) * 0.8;
    const at = (y: number) => [o.x + lean * Math.sin((y / H) * 2.2), o.z + leanZ * (y / H)] as const;
    for (let y = 0; y < H; y += S) {
      const [tx, tz] = at(y);
      box(tx - 0.25, y, tz - 0.25, tx + 0.25, y + S, tz + 0.25, "dark_wood", o.tag);
    }
    const pads = 4 + Math.floor(r() * 3);
    for (let i = 0; i < pads; i++) {
      const y = H * (0.45 + (i / pads) * 0.55), [tx, tz] = at(y);
      const a = r() * Math.PI * 2, d = i === pads - 1 ? 0 : 0.8 + r() * 1.6;
      const px = tx + Math.cos(a) * d, pz = tz + Math.sin(a) * d, R = i === pads - 1 ? 1.3 : 1 + r() * 0.8;
      for (let k = 0; k <= Math.ceil(d / S); k++) dot(tx + (px - tx) * (k / Math.ceil(d / S || 1)), y - 0.25, tz + (pz - tz) * (k / Math.ceil(d / S || 1)), "dark_wood", o.tag);
      for (let x = -R; x <= R; x += S) for (let z = -R; z <= R; z += S) for (let yy = 0; yy <= 0.5; yy += S) {
        const e = (x / R) ** 2 + (z / R) ** 2 + ((yy - 0.25) / 0.45) ** 2;
        if (e <= 1 && (e < 0.75 || r() < 0.6)) dot(px + x, y + yy, pz + z, "pine", o.tag);
      }
    }
  }

  // A clump of bamboo: tall green culms with darker nodes and feathery tops.
  function bamboo(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 7, r = rng(o.tag);
    for (let i = 0; i < 9; i++) {
      const bx = o.x + (r() - 0.5) * 2, bz = o.z + (r() - 0.5) * 2, h = H * (0.7 + r() * 0.3), bend = (r() - 0.5) * 0.8;
      for (let y = 0; y < h; y += S) dot(bx + bend * (y / h) ** 2, y, bz, Math.round(y / S) % 6 === 0 ? "dark_tile" : "green", o.tag);
      for (let k = 0; k < 10; k++) dot(bx + bend + (r() - 0.5) * 1.4, h - r() * 1.2, bz + (r() - 0.5) * 1.4, "leaves", o.tag);
    }
  }

  // A Japanese roof: concave slopes that rise gently from deep eaves and steeply near the ridge, with the
  // corners swept up. hip: four slopes to a ridge (or a point on a square plan).
  function eaveRoof(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y: number; overhang?: number; rise?: number; material?: Material; ridge?: Material; fascia?: Material }) {
    const oh = o.overhang ?? 1.5, m = o.material ?? "dark_tile";
    const ax = Math.min(o.x0, o.x1) - oh, bx = Math.max(o.x0, o.x1) + oh, az = Math.min(o.z0, o.z1) - oh, bz = Math.max(o.z0, o.z1) + oh;
    const halfMin = Math.min(bx - ax, bz - az) / 2, rise = o.rise ?? halfMin * 0.75;
    let last = { ax, bx, az, bz }, hTop = 0;
    for (let h = 0; h <= rise + 1e-6; h += S) {
      const inset = halfMin * Math.pow(h / rise, 1 / 1.7) * 0.98;
      const r = { ax: ax + inset, bx: bx - inset, az: az + inset, bz: bz - inset };
      if (r.bx - r.ax < S || r.bz - r.az < S) break;
      hTop = h;
      // the ring between last layer's edge and this one's, one voxel thick
      for (let x = last.ax; x < last.bx; x += S) for (let z = last.az; z < last.bz; z += S) {
        const inside = x >= r.ax + S && x < r.bx - S && z >= r.az + S && z < r.bz - S;
        if (inside) continue;
        // rows of round tiles running down the slope: every other line a shade darker
        const onFront = z < r.az + S || z >= r.bz - S;
        const rib = m === "dark_tile" && Math.round((onFront ? x : z) / S) % 2 === 0;
        dot(x, o.y + h, z, rib ? "black_stone" : m, o.tag);
        if (h === 0) dot(x, o.y - S, z, o.fascia ?? "dark_wood", o.tag); // a deep fascia board under the eave edge
      }
      last = r;
    }
    // the ridge cap along the top (right on the last layer), and the swept-up corners of the eaves
    box(last.ax, o.y + hTop + S, last.az, last.bx, o.y + hTop + 2 * S, last.bz, o.ridge ?? m, o.tag);
    for (const [cx, cz, sx, sz] of [[ax, az, -1, -1], [bx - S, az, 1, -1], [ax, bz - S, -1, 1], [bx - S, bz - S, 1, 1]] as const) {
      dot(cx, o.y + S, cz, m, o.tag);
      dot(cx + sx * S, o.y + S, cz + sz * S, m, o.tag);
      dot(cx + sx * S, o.y + 2 * S, cz + sz * S, m, o.tag);
    }
    return o.y + hTop + 2 * S; // the top of the ridge
  }

  // A Japanese temple hall or pavilion of one or more storeys: posts and beams in a dark frame with white or
  // gilded panels between, a veranda round each upper floor, a skirt roof between floors and a deep flared
  // roof on top with a finial ("phoenix" as on the Golden Pavilion, "jewel", or "none").
  function templeHall(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; floors?: number; floorHeight?: number; frame?: Material; wall?: Material; goldFloors?: number[]; roofMaterial?: Material; overhang?: number; taper?: number; finial?: "phoenix" | "jewel" | "shibi" | "none"; doors?: Side[]; bells?: boolean }) {
    const F = o.floors ?? 1, FH = o.floorHeight ?? 3.6, y0 = o.y ?? 0, rm = o.roofMaterial ?? "dark_tile";
    let [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    box(x0 - 0.5, y0, z0 - 0.5, x1 + 0.5, y0 + 0.5, z1 + 0.5, "stone", o.tag); // a low stone base
    let y = y0 + 0.5;
    for (let f = 0; f < F; f++) {
      if (f > 0 && o.taper) {
        const t = Math.min((x1 - x0) * o.taper, (z1 - z0) * o.taper) / 2;
        x0 += t; x1 -= t; z0 += t; z1 -= t;
      }
      const gold = (o.goldFloors ?? []).includes(f);
      const fr: Material = gold ? "gold" : o.frame ?? "dark_wood", wl: Material = gold ? "gold" : o.wall ?? "white";
      // floor, panels set a little back, posts, a beam at door-head height and at the top
      box(x0, y, z0, x1, y + S, z1, "wood", o.tag);
      for (const [a0, a1, b, alongX] of [[x0, x1, z0, true], [x0, x1, z1 - S, true], [z0, z1, x0, false], [z0, z1, x1 - S, false]] as const) {
        for (let a = a0; a < a1; a += S) for (let yy = y + S; yy < y + FH; yy += S) {
          // below the head beam: latticed doors and panels (dark slats over pale wood); above it: plaster
          const low = yy < y + FH * 0.62;
          const m: Material = gold ? "gold" : low && o.wall === undefined ? (Math.round(a / S) % 2 === 0 ? "dark_wood" : Math.round(yy / S) % 3 === 0 ? "dark_wood" : "wood") : wl;
          dot(alongX ? a : b, yy, alongX ? b : a, m, o.tag);
        }
        const n = Math.max(2, Math.round((a1 - a0) / 1.8));
        for (let i = 0; i <= n; i++) {
          const a = Math.min(a1 - S, a0 + ((a1 - a0 - S) * i) / n);
          for (let yy = y + S; yy < y + FH; yy += S) dot(alongX ? a : b, yy, alongX ? b : a, fr, o.tag);
        }
        for (const yy of [y + FH * 0.62, y + FH - S]) for (let a = a0; a < a1; a += S) dot(alongX ? a : b, yy, alongX ? b : a, fr, o.tag);
      }
      // doors (on the ground floor) and lattice windows (above)
      for (const side of f === 0 ? o.doors ?? ["front"] : []) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = Math.min(2.5, (side === "front" || side === "back" ? x1 - x0 : z1 - z0) * 0.3);
        if (side === "front") clear(cx - w / 2, y + S, z0 - S, cx + w / 2, y + FH * 0.6, z0 + S);
        if (side === "back") clear(cx - w / 2, y + S, z1 - S, cx + w / 2, y + FH * 0.6, z1 + S);
        if (side === "left") clear(x0 - S, y + S, cz - w / 2, x0 + S, y + FH * 0.6, cz + w / 2);
        if (side === "right") clear(x1 - S, y + S, cz - w / 2, x1 + S, y + FH * 0.6, cz + w / 2);
      }
      if (f > 0) {
        // a veranda with a low railing round the upper floor
        box(x0 - 0.75, y, z0 - 0.75, x1 + 0.75, y + S, z1 + 0.75, "wood", o.tag);
        for (let a = x0 - 0.75; a < x1 + 0.75; a += S) { dot(a, y + 0.75, z0 - 0.75, fr, o.tag); dot(a, y + 0.75, z1 + 0.5, fr, o.tag); }
        for (let a = z0 - 0.75; a < z1 + 0.75; a += S) { dot(x0 - 0.75, y + 0.75, a, fr, o.tag); dot(x1 + 0.5, y + 0.75, a, fr, o.tag); }
        for (let a = x0 - 0.75; a < x1 + 0.75; a += 1.25) for (const zz of [z0 - 0.75, z1 + 0.5]) {
          box(a, y + S, zz, a + S, y + 0.75, zz + S, fr, o.tag);
          dot(a, y + 1.0, zz, "gold", o.tag); // a gilt cap (giboshi) on each railing post
        }
      }
      // bracket sets (tokyo) under the eaves: two stepped courses of blocks corbelled out from the wall head
      const bm: Material = o.frame === "vermilion" || gold ? fr : "dark_wood";
      for (const [d, yy] of [[S, y + FH - 3 * S], [2 * S, y + FH - 2 * S], [3 * S, y + FH - S]] as const) {
        for (let a = x0; a < x1; a += 0.75) { box(a, yy, z0 - d, a + 2 * S, yy + S, z0, bm, o.tag); box(a, yy, z1, a + 2 * S, yy + S, z1 + d, bm, o.tag); }
        for (let a = z0; a < z1; a += 0.75) { box(x0 - d, yy, a, x0, yy + S, a + 2 * S, bm, o.tag); box(x1, yy, a, x1 + d, yy + S, a + 2 * S, bm, o.tag); }
      }
      y += FH;
      if (f < F - 1) {
        // a shallow skirt roof between floors
        for (const [d, h] of [[1.0, 0], [0.5, S], [0, 2 * S]] as const) {
          for (let a = x0 - d; a < x1 + d; a += S) { dot(a, y + h, z0 - d, rm, o.tag); dot(a, y + h, z1 + d - S, rm, o.tag); }
          for (let a = z0 - d; a < z1 + d; a += S) { dot(x0 - d, y + h, a, rm, o.tag); dot(x1 + d - S, y + h, a, rm, o.tag); }
        }
        y += 2 * S;
      }
    }
    const oh = o.overhang ?? Math.max(1.2, Math.min(x1 - x0, z1 - z0) * 0.22);
    const top = eaveRoof({ tag: o.tag, x0, z0, x1, z1, y, overhang: oh, material: rm });
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (o.finial === "phoenix") {
      // a gilt phoenix: body on a little post, wings swept back, tail raised
      box(cx - S / 2, top, cz - S / 2, cx + S / 2, top + 0.5, cz + S / 2, "gold", o.tag);
      box(cx - S / 2, top + 0.5, cz - 0.5, cx + S / 2, top + 1.0, cz + 0.5, "gold", o.tag);
      dot(cx, top + 1.25, cz - 0.5, "gold", o.tag);
      box(cx - 0.75, top + 0.75, cz - S / 2, cx + 0.75, top + 1.0, cz + S / 2, "gold", o.tag);
      box(cx - S / 2, top + 1.0, cz + 0.5, cx + S / 2, top + 1.5, cz + 0.75, "gold", o.tag);
    } else if (o.finial === "jewel") finialAt(cx, top, cz, 1.2, "gold", o.tag);
    else if (o.finial === "shibi") {
      // gilt ridge-end ornaments (shibi), curling up and inward at each end of the ridge
      const alongX = x1 - x0 >= z1 - z0, half = Math.abs((alongX ? x1 - x0 : z1 - z0) - (alongX ? z1 - z0 : x1 - x0)) / 2;
      for (const sgn of [-1, 1]) {
        const ex = alongX ? cx + sgn * half : cx, ez = alongX ? cz : cz + sgn * half;
        box(ex - S / 2, top - S, ez - S / 2, ex + S / 2, top + 1.0, ez + S / 2, "gold", o.tag);
        dot(alongX ? ex - sgn * S : ex, top + 1.0, alongX ? ez : ez - sgn * S, "gold", o.tag);
      }
    }
    if (o.bells !== false) {
      // bronze wind bells hanging under the four corners of the top roof
      for (const [bx, bz] of [[x0 - oh + 0.5, z0 - oh + 0.5], [x1 + oh - 0.75, z0 - oh + 0.5], [x0 - oh + 0.5, z1 + oh - 0.75], [x1 + oh - 0.75, z1 + oh - 0.75]]) {
        dot(bx, y - S, bz, "iron", o.tag);
        dot(bx, y - 2 * S, bz, "gold", o.tag);
      }
    }
  }

  // A pagoda: storeys narrowing upward, each under a flared roof, crowned by a ringed bronze spire (sorin).
  function pagoda(o: { tag: string; x: number; z: number; y?: number; stories?: number; base?: number; frame?: Material; wall?: Material; roofMaterial?: Material }) {
    const n = o.stories ?? 5, B = o.base ?? 7, y0 = o.y ?? 0, rm = o.roofMaterial ?? "dark_tile", fr = o.frame ?? "vermilion", wl = o.wall ?? "white";
    box(o.x - B / 2 - 0.75, y0, o.z - B / 2 - 0.75, o.x + B / 2 + 0.75, y0 + 0.75, o.z + B / 2 + 0.75, "stone", o.tag);
    let y = y0 + 0.75;
    for (let i = 0; i < n; i++) {
      const w = B * (1 - 0.09 * i), h = i === 0 ? B * 0.5 : B * 0.36;
      const a = o.x - w / 2, b = o.x + w / 2, c = o.z - w / 2, d = o.z + w / 2;
      if (o.wall) box(a, y, c, b, y + h, d, wl, o.tag);
      else {
        // latticed panels with a plaster band above, like the halls
        box(a, y, c, b, y + h, d, "dark_wood", o.tag);
        for (let xx = a; xx < b; xx += S) for (let yy = y; yy < y + h * 0.7; yy += S) for (const zz of [c, d - S]) if (Math.round(xx / S) % 2 && Math.round(yy / S) % 3) dot(xx, yy, zz, "wood", o.tag);
        for (let zz = c; zz < d; zz += S) for (let yy = y; yy < y + h * 0.7; yy += S) for (const xx of [a, b - S]) if (Math.round(zz / S) % 2 && Math.round(yy / S) % 3) dot(xx, yy, zz, "wood", o.tag);
        box(a, y + h * 0.7, c, b, y + h - S, d, "white", o.tag);
        box(a + S, y + h * 0.7, c + S, b - S, y + h - S, d - S, "dark_wood", o.tag); // (inside, hidden)
      }
      for (const px of [a, (a + b) / 2 - S / 2, b - S]) for (const pz of [c, d - S]) box(px, y, pz, px + S, y + h, pz + S, fr, o.tag);
      for (const pz of [(c + d) / 2 - S / 2]) for (const px of [a, b - S]) box(px, y, pz, px + S, y + h, pz + S, fr, o.tag);
      box(a, y + h - S, c, b, y + h, d, fr, o.tag);
      if (i === 0) clear(o.x - 0.75, y, c - S, o.x + 0.75, y + h * 0.6, c + S);
      eaveRoof({ tag: o.tag, x0: a, z0: c, x1: b, z1: d, y: y + h, overhang: w * 0.32, rise: w * 0.3, material: rm });
      y += h + S;
    }
    // the sorin: a mast with nine rings and a jewel
    const top = y + B * 0.3 * (1 - 0.09 * (n - 1)) * 0.6;
    for (let yy = y - 1; yy < top + B * 0.9; yy += S) dot(o.x, yy, o.z, "iron", o.tag);
    for (let k = 0; k < 9; k++) layer(o.x + S / 2, top + 0.3 + k * B * 0.07, o.z + S / 2, Math.max(S, 0.5 - k * 0.02), 0, "gold", o.tag);
    finialAt(o.x + S / 2, top + B * 0.9, o.z + S / 2, 0.75, "gold", o.tag);
  }

  // A Shinto torii gate: two vermilion pillars, a tie beam, and a black-capped top lintel with upswept ends.
  function torii(o: { tag: string; x: number; z: number; width?: number; height?: number; color?: Material; along?: "x" | "z" }) {
    const W = o.width ?? 4, H = o.height ?? 5, c = o.color ?? "vermilion", ax = (o.along ?? "x") === "x";
    const put = (u0: number, u1: number, y0: number, y1: number, m: Material) => (ax ? box(o.x + u0, y0, o.z - 0.25, o.x + u1, y1, o.z + 0.25, m, o.tag) : box(o.x - 0.25, y0, o.z + u0, o.x + 0.25, y1, o.z + u1, m, o.tag));
    for (const s2 of [-W / 2, W / 2 - 0.5]) put(s2, s2 + 0.5, 0, H, c);
    for (const s2 of [-W / 2 - 0.25, W / 2 - 0.75]) put(s2, s2 + 1, 0, 0.5, "black_stone"); // pillar feet
    put(-W / 2 - 0.5, W / 2 + 0.5, H * 0.72, H * 0.72 + 0.5, c); // nuki
    put(-S / 2, S / 2, H * 0.72 + 0.5, H - 0.25, c); // the little strut in the middle
    put(-W / 2 - 1, W / 2 + 1, H - 0.25, H + 0.25, c); // shimaki
    put(-W / 2 - 1.25, W / 2 + 1.25, H + 0.25, H + 0.75, "black_stone"); // kasagi
    put(-W / 2 - 1.5, -W / 2 - 1.25, H + 0.5, H + 1.0, "black_stone"); // its swept-up ends
    put(W / 2 + 1.25, W / 2 + 1.5, H + 0.5, H + 1.0, "black_stone");
  }

  // A stone lantern (toro): a foot, a post, a firebox that glows after dark, a wide cap and a jewel.
  function stoneLantern(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 2.8;
    box(o.x - 0.5, 0, o.z - 0.5, o.x + 0.5, 0.25, o.z + 0.5, "stone", o.tag);
    box(o.x - 0.25, 0.25, o.z - 0.25, o.x + 0.25, H * 0.5, o.z + 0.25, "stone", o.tag);
    box(o.x - 0.5, H * 0.5, o.z - 0.5, o.x + 0.5, H * 0.5 + 0.25, o.z + 0.5, "stone", o.tag);
    box(o.x - 0.25, H * 0.5 + 0.25, o.z - 0.25, o.x + 0.25, H * 0.75, o.z + 0.25, "glass", o.tag);
    box(o.x - 0.75, H * 0.75, o.z - 0.75, o.x + 0.75, H * 0.75 + 0.25, o.z + 0.75, "stone", o.tag);
    box(o.x - 0.5, H * 0.75 + 0.25, o.z - 0.5, o.x + 0.5, H * 0.75 + 0.5, o.z + 0.5, "stone", o.tag);
    dot(o.x, H * 0.75 + 0.5, o.z, "stone", o.tag);
  }

  // A Japanese drum bridge (taiko-bashi): a steep arched deck from (x0, z0) to (x1, z1) with vermilion railings
  // and gilt post caps; the arch's underside stays open over the water.
  function archBridge(o: { tag: string; x0: number; z0: number; x1: number; z1: number; width?: number; rise?: number; color?: Material; deck?: Material }) {
    const W = o.width ?? 3, c = o.color ?? "vermilion", dk = o.deck ?? "wood";
    const alongX = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
    const a0 = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1), a1 = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
    const mid = alongX ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2, L = a1 - a0, R = o.rise ?? Math.max(1.5, L * 0.22);
    const at = (a: number, w: number, yy: number, m: Material) => (alongX ? dot(a, yy, mid + w, m, o.tag) : dot(mid + w, yy, a, m, o.tag));
    for (let a = a0; a <= a1; a += S) {
      const t = (a - a0) / L, h = Math.round((R * Math.sin(Math.PI * t)) / S) * S;
      for (let w = -W / 2; w < W / 2; w += S) {
        at(a, w, h, dk);
        at(a, w, h - S, c); // a vermilion beam under the deck shows the curve
      }
      for (const w of [-W / 2 - S, W / 2]) {
        at(a, w, h + 0.75, c); // the rail
        if (Math.round((a - a0) / 1.25 / S) * 1.25 * S === Math.round((a - a0) / S) * S || a === a0 || a + S > a1) {
          for (let yy = h; yy < h + 0.75; yy += S) at(a, w, yy, c);
          at(a, w, h + 1.0, "gold");
        }
      }
    }
    // stone footings at each end
    for (const a of [a0 - 0.5, a1]) alongX ? box(a, 0, mid - W / 2 - 0.5, a + 0.5, 0.5, mid + W / 2 + 0.5, "stone", o.tag) : box(mid - W / 2 - 0.5, 0, a, mid + W / 2 + 0.5, 0.5, a + 0.5, "stone", o.tag);
  }

  // Lotus on a pond: clusters of flat round pads on the water, some with a pink flower standing above.
  function lotus(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; density?: number }) {
    const r = rng(o.tag), y = o.y ?? S;
    for (let x = Math.min(o.x0, o.x1); x < Math.max(o.x0, o.x1); x += S) for (let z = Math.min(o.z0, o.z1); z < Math.max(o.z0, o.z1); z += S) {
      const patch = Math.sin(x * 0.7) * Math.cos(z * 0.6) + Math.sin(x * 0.23 + z * 0.31);
      if (patch < 1.3 - (o.density ?? 0.4) * 2 || r() > 0.7) continue;
      dot(x, y, z, "green", o.tag);
      if (r() < 0.06) {
        dot(x, y + S, z, "green", o.tag);
        dot(x, y + 2 * S, z, "pink", o.tag);
      }
    }
  }

  // Raked gravel (a karesansui courtyard): pale gravel combed into straight lines.
  function raked(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; along?: "x" | "z" }) {
    const ax = (o.along ?? "x") === "x", y = o.y ?? 0;
    for (let x = Math.min(o.x0, o.x1); x < Math.max(o.x0, o.x1); x += S) for (let z = Math.min(o.z0, o.z1); z < Math.max(o.z0, o.z1); z += S) {
      const line = Math.round((ax ? z : x) / S) % 2 === 0;
      dot(x, y, z, line ? "gravel" : "cement", o.tag);
    }
  }

  // A rough garden rock or islet stone.
  function rock(o: { tag: string; x: number; z: number; size?: number; material?: Material }) {
    const R = o.size ?? 1, r = rng(o.tag + o.x + o.z);
    for (let x = -R; x <= R; x += S) for (let z = -R; z <= R; z += S) for (let y = 0; y <= R; y += S) {
      const e = (x / R) ** 2 + ((y - R * 0.2) / (R * 0.8)) ** 2 + (z / (R * 0.85)) ** 2 + (r() - 0.5) * 0.3;
      if (e <= 1) dot(o.x + x, y, o.z + z, o.material ?? "stone", o.tag);
    }
  }

  // A pierced stone lattice screen (jali) along a line.
  function jali(o: { tag: string; x0: number; z0: number; x1: number; z1: number; y?: number; height?: number; material?: Material }) {
    const y = o.y ?? 0, H = o.height ?? 2, m = o.material ?? "marble";
    const alongX = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
    const a0 = alongX ? Math.min(o.x0, o.x1) : Math.min(o.z0, o.z1), a1 = alongX ? Math.max(o.x0, o.x1) : Math.max(o.z0, o.z1);
    for (let a = a0; a < a1; a += S) for (let h = 0; h < H; h += S) {
      const i = Math.round((a - a0) / S), j = Math.round(h / S);
      const edge = a < a0 + S || a >= a1 - S || h < S || h >= H - S;
      if (edge || (i + j) % 2 === 0 || (i % 3 === 0 && j % 3 === 0)) dot(alongX ? a : o.x0, y + h, alongX ? o.z0 : a, m, o.tag);
    }
  }

  // ---------------------------------------------------------------- gardens
  function hedge(o: { tag: string; x0: number; z0: number; x1: number; z1: number; height?: number }) {
    const r = rng(o.tag + o.x0 + o.z0);
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    for (let x = x0; x < Math.max(x1, x0 + S); x += S) for (let z = z0; z < Math.max(z1, z0 + S); z += S) for (let h = 0; h < (o.height ?? 0.75); h += S) if (h < (o.height ?? 0.75) - S || r() < 0.8) dot(x, h, z, "leaves", o.tag);
  }

  function flowers(o: { tag: string; x0: number; z0: number; x1: number; z1: number; colors?: Material[]; density?: number }) {
    const r = rng(o.tag + o.x0 + o.z0);
    const cols = o.colors ?? ["red", "yellow", "pink", "white"];
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    box(x0, 0, z0, x1, S, z1, "earth", o.tag);
    for (let x = x0; x < x1; x += S) for (let z = z0; z < z1; z += S) {
      const q = r();
      if (q < (o.density ?? 0.45)) dot(x, S, z, q < 0.12 ? cols[Math.floor(r() * cols.length)] : "leaves", o.tag);
    }
  }

  function shrub(o: { tag: string; x: number; z: number; size?: number; flowers?: Material }) {
    const R = o.size ?? 0.75, r = rng(o.tag + o.x + o.z);
    for (let x = -R; x <= R; x += S) for (let y = 0; y <= R * 1.2; y += S) for (let z = -R; z <= R; z += S)
      if (Math.hypot(x, (y - R * 0.5) * 1.2, z) <= R && r() < 0.85) dot(o.x + x, y, o.z + z, o.flowers && r() < 0.2 ? o.flowers : "leaves", o.tag);
  }

  function cypress(o: { tag: string; x: number; z: number; height?: number }) {
    const H = o.height ?? 6;
    box(o.x, 0, o.z, o.x + S, 0.75, o.z + S, "trunk", o.tag);
    for (let y = 0.5; y < H; y += S) {
      const t = (y - 0.5) / (H - 0.5), r = 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - t * 0.35) + S / 2;
      layer(o.x + S / 2, y, o.z + S / 2, r, 0, "leaves", o.tag);
    }
  }

  // A garden: a lawn, optionally a charbagh (four quarters divided by paths and channels, a pool at the centre),
  // with flower beds along the edges and low hedges around the quarters.
  function garden(o: { tag: string; x0: number; z0: number; x1: number; z1: number; style?: "charbagh" | "lawn" | "beds"; path?: Material; water?: boolean; trees?: "cypress" | "fruit" | "none"; pathTag?: string; waterTag?: string; treeTag?: string }) {
    const [x0, x1] = [Math.min(o.x0, o.x1), Math.max(o.x0, o.x1)], [z0, z1] = [Math.min(o.z0, o.z1), Math.max(o.z0, o.z1)];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, pm = o.path ?? "sandstone", pw = 2;
    box(x0, 0, z0, x1, S, z1, "grass", o.tag);
    const style = o.style ?? "lawn";
    if (style === "charbagh") {
      box(cx - pw, 0, z0, cx + pw, S, z1, pm, o.pathTag ?? o.tag);
      box(x0, 0, cz - pw, x1, S, cz + pw, pm, o.pathTag ?? o.tag);
      if (o.water !== false) {
        box(cx - 0.5, 0, z0, cx + 0.5, S, z1, "water", o.waterTag ?? o.tag);
        box(x0, 0, cz - 0.5, x1, S, cz + 0.5, "water", o.waterTag ?? o.tag);
        pool({ tag: o.waterTag ?? o.tag, x0: cx - 4, z0: cz - 4, x1: cx + 4, z1: cz + 4, rim: "marble", rimWidth: 1 });
      }
      // hedges around each quarter and a row of trees along the main axis
      for (const [qx0, qx1] of [[x0 + 1, cx - pw - 0.5], [cx + pw + 0.5, x1 - 1]]) for (const [qz0, qz1] of [[z0 + 1, cz - pw - 0.5], [cz + pw + 0.5, z1 - 1]]) {
        hedge({ tag: o.tag, x0: qx0, z0: qz0, x1: qx1, z1: qz0 + S });
        hedge({ tag: o.tag, x0: qx0, z0: qz1 - S, x1: qx1, z1: qz1 });
        flowers({ tag: o.tag, x0: qx0 + 0.5, z0: qz0 + 0.5, x1: qx1 - 0.5, z1: qz0 + 2 });
      }
      if ((o.trees ?? "cypress") === "cypress") for (let z = z0 + 3; z < z1 - 2; z += 4) {
        if (Math.abs(z - cz) < 6) continue;
        cypress({ tag: o.treeTag ?? o.tag, x: cx - pw - 1.25, z });
        cypress({ tag: o.treeTag ?? o.tag, x: cx + pw + 1, z });
      }
    } else if (style === "beds") {
      for (let z = z0 + 1; z < z1 - 1.5; z += 3) flowers({ tag: o.tag, x0: x0 + 1, z0: z, x1: x1 - 1, z1: z + 1.5 });
    }
  }

  return {
    // low level, metres
    useScale, box, clear, dot,
    // ground
    floor, path,
    // structures
    wall, enclosure, room, roof: roofOver, gate, verandah, stairs, ladder,
    // things
    charpai, handpump, chulha, tandoor, well, pond, tree, plant, field, animal, object,
    // grand places
    dome, tower, chhatri, arcade, colonnade, pool, causeway, steps, platform, building, spire, flagpole, lamp, palm, portal, jali, mausoleum, sikhTemple,
    // Japan
    templeHall, pagoda, torii, stoneLantern, rock, eaveRoof, archBridge, lotus, raked,
    // gardens
    garden, hedge, flowers, shrub, cypress,
  };
}

export const KIT_DOC = `Kit (all positions and sizes in metres; every call takes a tag)
- floor({x0, z0, x1, z1, material?, tag, y?})                     a floor or yard surface, 25 cm thick
- path({points: [[x, z], ...], width?, material?, tag})
- wall({x0, z0, x1, z1, height?, thick?, material?, tag})         a straight wall (along x when x0..x1 is longer, else along z) with a brick coping
- enclosure({x0, z0, x1, z1, height?, material?, tag, gap?: {side, at?, width}})   four boundary walls; gap leaves an opening (for the gate) on side "front" | "back" | "left" | "right"
- room({tag, x0, z0, x1, z1, height?, wall?, plinth?, floor?, roof?, roofMaterial?, roofTag?, beams?, doors?, windows?, niches?, y?})
    walls 0.5 m thick with a plinth band, a floor, and a roof: "parapet" (flat with a low wall, default), "flat", "thatch", "tin", "tile" or "none".
    doors: [{side, at?, width?, height?, color?, tag?, open?}]   at = metres from the left end (front/back sides) or nearer end (left/right sides), or "center"
    windows: [{side, at?, width?, height?, sill?, color?, bars?, tag?}]   niches: [{side, at?}]
    y lifts the whole room (a room on the roof: y = height of the room below).
- roof({x0, z0, x1, z1, y, style, material?, tag, beams?})          a roof on its own (over a verandah or shed)
- gate({tag, x, z, width?, height?, color?, material?, studs?, arch?, posts?, postsTag?})   an open double gate in the wall line at z, centred on x, leaves swung inward
- verandah({tag, x0, z0, x1, z1, height?, post?, roof?})            posts along the front edge (z0), a roof
- stairs({tag, x, z, width?, toHeight?, direction?: "deeper" | "nearer" | "left" | "right", material?})
- ladder({tag, x, z, height?, along?: "x" | "z"})
- charpai({tag, x, z, along?: "x" | "z"})          a rope cot, 2 m by 1 m, centred at x, z
- handpump({tag, x, z, platformTag?})              a cast-iron hand pump on a small platform
- chulha({tag, x, z, withPot?, potTag?})           a U-shaped clay stove, open towards the entrance
- tandoor({tag, x, z})   well({tag, x, z, radius?, material?})   pond({tag, x0, z0, x1, z1})
- tree({tag, x, z, kind?: "neem" | "pipal" | "banyan" | "mango" | "kikar" | "fruit" | "generic", height?, crown?})
- plant({tag, x, z, kind?: "tulsi" | "flowers" | "bush" | "potted"})
- field({tag, x0, z0, x1, z1, crop?: "wheat" | "mustard" | "rice" | "sugarcane" | "vegetables"})
- animal({tag, x, z, kind?: "buffalo" | "cow" | "goat" | "dog" | "horse", facing?: "left" | "right" | "deeper" | "nearer"})
- object({tag, x, z, kind?, w?, d?, h?, material?, color?})   kind: trunk, chest, table, chair, stool, peedhi, bench, almirah, cupboard, shelf, bed, sofa, tv, matka, pot, haystack, toori, trough, khurli, water_tank, box (anything else: a box of w x d x h)
Grand places (temples, gurdwaras, mosques, palaces, forts, bazaars, monuments)
- useScale(0.5)   call first, before building anything, only when the place cannot fit within about 110 m across and 200 m deep; parts then snap to 0.5 m (coarse: domes and arches turn lumpy)
- dome({tag, x, z, y?, radius, shape?: "onion" | "bulb" | "half" | "stupa", material?, finial?: material or false, drum?, drumMaterial?})
- tower({tag, x, z, height, radius?, material?, balconies?, cap?: "dome" | "chhatri" | "cone" | "flat", capMaterial?, square?})   minarets, clock towers, round bastions
- chhatri({tag, x, z, y?, size?, material?, domeMaterial?})   an open pavilion on four pillars with a small dome; put them on roofs and corners
- arcade({tag, x0, z0, x1, z1, y?, height?, thick?, bay?, pointed?, material?})   a wall of arched openings along a line: cloisters, gateways, arcaded facades
- colonnade({tag, x0, z0, x1, z1, y?, height?, spacing?, radius?, material?, beam?})
- pool({tag, x0, z0, x1, z1, rim?, rimWidth?, rimTag?, steps?})   a sunken pool or sarovar with a walkway rim and steps into the water
- causeway({tag, x0, z0, x1, z1, width?, y?, material?, railing?, lamps?, lampTag?})   a raised walkway along a line, over water or ground
- steps({tag, x0, z0, x1, z1, height, direction?, material?})   platform({tag, x0, z0, x1, z1, height?, material?, steps?: side})
- building({tag, x0, z0, x1, z1, floors?, floorHeight?, wall?, trim?, roof?, roofMaterial?, roofTag?, doors?, windows?, balcony?, floorTags?, y?})   several floors with windows, cornices and balconies
- spire({tag, x, z, y?, base?, height?, material?, top?})   a tiered temple tower (shikhara)
- flagpole({tag, x, z, height?, color?, base?})   lamp({tag, x, z, height?})   tree({kind: "palm" | "cypress" | "flowering" | "gulmohar", ...})
- portal({tag, side?, x?, z?, width?, height?, depth?, y?, material?, inlay?, doorTag?})   a Mughal arch portal (iwan) set into a facade line at x (front/back) or z (left/right): a proud frame with an inlaid border and a deep pointed-arch recess
- jali({tag, x0, z0, x1, z1, y?, height?, material?})   a pierced lattice screen along a line
- mausoleum({tag, x, z, y?, width?, height?, material?, inlay?, domeRadius?, domeTag?, chhatriTag?, finial?})   a whole Mughal tomb centred at x, z: chamfered corners, a framed deep-arched portal on every face with two tiers of arches either side, corner pinnacles, a drum and great onion dome, four chhatris. Use it for the Taj Mahal, Humayun's tomb and their kin.
- templeHall({tag, x0, z0, x1, z1, y?, floors?, floorHeight?, frame?, wall?, goldFloors?: [floor indexes from 0], roofMaterial?, overhang?, taper?, finial?: "phoenix" | "jewel" | "none", doors?: [sides]})   a Japanese temple hall or pavilion: dark posts and beams with white or gilded panels, verandas on upper floors, skirt roofs between floors, a deep flared roof with upswept corners. The Golden Pavilion (Kinkaku-ji): 3 floors, goldFloors [1, 2], roofMaterial "bark_shingle", finial "phoenix", on the edge of its pond.
- pagoda({tag, x, z, y?, stories?, base?, frame?, wall?, roofMaterial?})   a pagoda of 3 or 5 storeys, each under a flared roof, with a ringed spire
- torii({tag, x, z, width?, height?, color?, along?})   a Shinto gate (vermilion by default); put many in a row for a tunnel of gates
- stoneLantern({tag, x, z, height?})   rock({tag, x, z, size?, material?})   eaveRoof({tag, x0, z0, x1, z1, y, overhang?, rise?, material?})   a Japanese roof on its own (a gate, a bell house)
- archBridge({tag, x0, z0, x1, z1, width?, rise?, color?, deck?})   a steep arched drum bridge over water, vermilion railings with gilt caps
- lotus({tag, x0, z0, x1, z1, y?, density?})   lotus pads and pink flowers on a pond's surface (y: the water's top)
- raked({tag, x0, z0, x1, z1, y?, along?})   a raked gravel courtyard
- templeHall finial "shibi" (gilt ridge-end ornaments, as on Nara's great halls); bells: true (default) hangs bronze bells at the roof corners; frame "vermilion" for a red-lacquered hall
- tree kinds for Japan: "sakura" (cherry blossom), "maple" (autumn red), "ginkgo" (autumn yellow), "pine" (sculpted Japanese pine), "bamboo"
- Japanese materials: vermilion (shrine red), dark_tile (grey roof tiles), bark_shingle (cypress-bark roofs), moss
- sikhTemple({tag, x, z, y?, width?, lower?, upper?, domeTag?, kioskTag?, domeRadius?})   a whole Harmandir Sahib style temple centred at x, z: a marble lower storey with arched doorways on every side, a gilded upper storey with balcony windows, gold corner kiosks, a fluted lotus dome and a tall gold finial. Use it for gurdwaras.
- dome(...ribs: n, ribMaterial)   vertical ribs on a dome (the Golden Temple's gilded ribs)
- roof style "crenellated": a parapet with merlons (forts, palaces)
- garden({tag, x0, z0, x1, z1, style?: "charbagh" | "lawn" | "beds", path?, water?, trees?: "cypress" | "fruit" | "none", pathTag?, waterTag?, treeTag?})   hedge({tag, x0, z0, x1, z1, height?})   flowers({tag, x0, z0, x1, z1, colors?})   shrub({tag, x, z, size?, flowers?})
- room and building frame their walls with corner pilasters, a cornice and door jambs (trim; pass trim: null to turn it off).

Recipes for grand places (compose these; adjust to what was said)
- Mughal tomb (Taj Mahal, Humayun's tomb): a wide platform; mausoleum() on it (it draws the chamfered building, the portals, the dome and the chhatris); a minaret (tower, cap "chhatri") at each platform corner; a charbagh garden in front with the water channel on the axis to the gate; a red sandstone gateway building with small domes along its top; a red mosque and its mirror building on either side.
- Gurdwara with a sarovar (Harmandir Sahib): a pool with a wide marble walkway rim; sikhTemple() on a platform in the middle; a lamp-lined causeway from the gateway (darshani deorhi: a building with an arched passage and small gold domes) to the temple; white arcaded buildings around the walkway; Nishan Sahib flagpoles.
- Hindu temple: a platform with steps; a pillared hall (colonnade with a flat roof); a spire (shikhara) over the sanctum; a tank (pool) with steps nearby.
- Mosque: a courtyard with an arcade around it; a prayer hall with a portal in the middle of its front; three domes; two minarets.
- Fort or palace: crenellated walls and round towers (tower, square: false, cap "flat"); a gateway portal; inner courtyards and chhatris on the roofs; jali screens on upper floors.
- Japanese temple garden (Kinkaku-ji, Ginkaku-ji, Byodo-in): a large pond with natural edges (pond, rocks) and small islands carrying pines; the hall on the water's edge so it is mirrored in the pond; a gravel path round the pond; maples and pines thick around; stone lanterns. A shrine (Fushimi Inari): rows of torii close together along a path up a wooded hill. A pagoda temple: a pagoda beside a templeHall in a gravel courtyard.
- Village house: see the main example; city row houses: building() side by side with balconies.
- Materials for grand places: marble, gold, sandstone, red_sandstone, blue_tile, green_tile, black_stone, saffron.
- box(x0, y0, z0, x1, y1, z1, material, tag)   clear(x0, y0, z0, x1, y1, z1)   dot(x, y, z, material, tag)   for anything the kit does not have
- Math is available. No other globals.`;
