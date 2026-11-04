// The land around the place, so it never floats in a void: a village's fields, lane and neighbours, or the
// streets and rooftops of the town round a famous place. Nobody described this; it is scenery, drawn in code
// from a fixed seed, faded with distance, and never counted as part of the memory.
import type { Vox } from "./mesher.ts";

export type Setting = "village" | "town" | "forest";
type Rect = { x0: number; x1: number; z0: number; z1: number }; // metres

export type Scenery = { vox: Vox[]; top: Set<string>; meadow: Set<string>; radius: number; S: number };

function hash(x: number, z: number, k = 0) {
  let h = (x * 374761393 + z * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// build: the footprint of what was described; door: where the way in is (x centre, on the front, -z, side)
// top: the height of the tallest thing described (the town stays well below it)
export function makeScenery(build: Rect, doorX: number, setting: Setting, top = 20): Scenery {
  const size = Math.max(build.x1 - build.x0, build.z1 - build.z0, 10);
  // metres per scenery voxel: half-metre detail round a home, metre blocks round a big place
  const S = size > 60 ? 1 : 0.5;
  const n = (m: number) => Math.max(1, Math.round(m / S)); // metres to voxels
  const yard = setting === "town" ? 3 : 3;
  const ring = setting === "town" ? Math.max(26, size * 0.45) : Math.max(22, size * 0.9);
  const inner: Rect = { x0: build.x0 - yard, x1: build.x1 + yard, z0: build.z0 - yard, z1: build.z1 + yard };
  const outer: Rect = { x0: inner.x0 - ring, x1: inner.x1 + ring, z0: inner.z0 - ring, z1: inner.z1 + ring };
  const vx = (m: number) => Math.floor(m / S);
  const X0 = vx(outer.x0), X1 = vx(outer.x1), Z0 = vx(outer.z0), Z1 = vx(outer.z1);
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2, rx = (X1 - X0) / 2, rz = (Z1 - Z0) / 2;
  const wob = (x: number, z: number) => Math.sin(x * 0.37 + z * 0.11) * 0.5 + Math.sin(z * 0.29 - x * 0.17) * 0.5;
  const corner = n(5); // voxels of rounding at the island's corners

  const grid = new Map<string, Vox>();
  const put = (x: number, y: number, z: number, m: string, t = "scenery") => grid.set(`${x},${y},${z}`, { x, y, z, m, t });
  const topCells = new Set<string>(), meadow = new Set<string>();
  // distance (m) outside the inner yard, and outside the build
  const outIn = (x: number, z: number) => Math.hypot(Math.max(0, inner.x0 - x * S, x * S - inner.x1), Math.max(0, inner.z0 - z * S, z * S - inner.z1));
  const inBuild = (x: number, z: number) => x * S >= build.x0 && x * S < build.x1 && z * S >= build.z0 && z * S < build.z1;

  // the island's outline: a rounded rectangle with a wobbly edge; depth below grows toward the middle
  const edgeDist = (x: number, z: number) => {
    const dx = Math.max(0, Math.abs(x - cx) - (rx - corner)), dz = Math.max(0, Math.abs(z - cz) - (rz - corner));
    const r = Math.hypot(dx, dz) + wob(x, z) * 1.2;
    const fromSide = Math.min(rx - Math.abs(x - cx), rz - Math.abs(z - cz));
    return r > 0 ? corner - r : corner + fromSide; // voxels inside the edge
  };

  // lanes: one from the way in straight out to the edge, one across in front of the place
  const laneW = setting === "town" ? 10 : 4;
  const crossZ = inner.z0 - (setting === "town" ? 2 : 5);
  const onLane = (x: number, z: number) => {
    const mx = x * S, mz = z * S;
    if (mz < inner.z0 && Math.abs(mx - doorX) < laneW / 2) return true;
    if (Math.abs(mz - crossZ) < laneW / 2 && mz < inner.z0 + 1) return true;
    return false;
  };

  const cols: [number, number, number][] = []; // x, z, depth
  for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
    const e = edgeDist(x, z);
    if (e < 0) continue;
    // a floating island: shallow at the rim, deep in the middle, like a plug of earth lifted out whole
    const depth = Math.round(n(1.5) + Math.min(e * 0.55, n(size * 0.25 + 5)) + (wob(x * 2, z * 2) + 1) * 1.5);
    cols.push([x, z, depth]);
    topCells.add(`${x},${z}`);
  }
  const depthAt = new Map(cols.map(([x, z, d]) => [`${x},${z}`, d]));

  // the surface
  for (const [x, z] of cols) {
    const o = outIn(x, z);
    let m: string;
    const forest = setting === "forest";
    if (inBuild(x, z)) m = setting === "town" ? "plaza" : forest ? "moss" : "yard";
    else if (o <= 0) m = setting === "town" ? "plaza" : forest ? "moss" : "yard";
    else if (onLane(x, z)) m = setting === "town" ? "street" : forest ? "gravel" : "lane";
    else m = "meadow";
    put(x, -1, z, m, "ground");
    if (m === "meadow") meadow.add(`${x},${z}`);
  }
  // the rock below: only the shell people can see (sides and underside), in bands of soil and stone
  for (const [x, z, d] of cols) {
    let nmin = d;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) nmin = Math.min(nmin, depthAt.get(`${x + dx},${z + dz}`) ?? 0);
    for (let y = -2; y >= -d; y--) {
      if (-y <= nmin && y !== -d) continue;
      const band = Math.floor((-y + wob(x * 0.5, z * 0.5) * 1.5) / n(1.5));
      put(x, y, z, -y <= n(1.5) ? "soil" : band % 3 === 0 ? "rock_light" : band % 3 === 1 ? "rock" : "rock_dark", "ground");
    }
  }

  const free = (x: number, z: number) => meadow.has(`${x},${z}`);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: string, shell = true) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) {
      if (shell && x > x0 && x < x1 - 1 && z > z0 && z < z1 - 1 && y < y1 - 1) continue;
      put(x, y, z, m);
    }
  };
  const tree = (x: number, z: number, h: number, r: number) => {
    for (let y = 0; y < h; y++) put(x, y, z, "trunk");
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) {
      const d = Math.hypot(dx, dy * 1.3, dz);
      if (d <= r + 0.3 - hash(x + dx, z + dz, dy) * 0.9) put(x + dx, h + dy, z + dz, "leaves");
    }
  };
  const claim = (x0: number, z0: number, x1: number, z1: number) => {
    for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) if (!free(x, z)) return false;
    for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) meadow.delete(`${x},${z}`);
    return true;
  };

  if (setting === "forest") {
    // wooded hills rising all round, as round a temple garden in Kyoto: the ground climbs with distance from
    // the place, thick with pines, maples and the odd ginkgo, turning in autumn colour
    const rise = (x: number, z: number) => Math.max(0, outIn(x, z) - 4) * 0.42 + wob(x * 0.4, z * 0.4) * 1.5;
    for (const key of [...meadow]) {
      const [x, z] = key.split(",").map(Number);
      const hgt = Math.min(n(16), Math.floor(rise(x, z) / S));
      if (hgt <= 0) continue;
      for (let y = 0; y < hgt; y++) {
        // only the shell shows: the top and any side that steps down to a lower neighbour
        let edge = y === hgt - 1;
        if (!edge) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Math.floor(rise(x + dx, z + dz) / S) <= y) edge = true;
        if (edge) put(x, y, z, y === hgt - 1 ? "moss" : "soil", "ground");
      }
    }
    const kinds = ["pine", "pine", "leaves", "pine", "maple", "leaves", "pine", "pine", "ginkgo"];
    for (let i = 0; i < 2200; i++) {
      const x = X0 + Math.floor(hash(i, 51) * (X1 - X0)), z = Z0 + Math.floor(hash(i, 52) * (Z1 - Z0));
      if (outIn(x, z) < 3 || edgeDist(x, z) < n(2) || onLane(x, z) || !meadow.has(`${x},${z}`)) continue;
      const y0 = Math.max(0, Math.min(n(16), Math.floor(rise(x, z) / S)));
      const kind = kinds[Math.floor(hash(i, 53) * kinds.length)], h = n(3 + hash(i, 54) * 4), r = n(1.4 + hash(i, 55) * 1.4);
      for (let y = 0; y < h; y++) put(x, y0 + y, z, kind === "pine" ? "dark_wood" : "trunk");
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) {
        const flat = kind === "pine" ? 2.2 : 1.25;
        if (Math.hypot(dx, dy * flat, dz) <= r + 0.3 - hash(x + dx, z + dz, dy) * 0.9) put(x + dx, y0 + h + dy, z + dz, kind);
      }
    }
  } else if (setting === "village") {
    // neighbours: low mud houses with flat roofs and a parapet, facing the lanes
    const spots: [number, number][] = [];
    const laneOut = vx(crossZ - laneW / 2 - 1); // just beyond the cross lane, away from the place
    for (let k = 0; k < 6; k++) {
      // along the cross lane, both sides of the way in
      spots.push([vx(doorX + (k % 2 ? 1 : -1) * (laneW / 2 + 6 + Math.floor(k / 2) * 11)), laneOut]);
      // along the lane that leads away, both sides
      spots.push([vx(doorX + (k % 2 ? 1 : -1) * (laneW / 2 + 5)), laneOut - n(11) - Math.floor(k / 2) * n(10)]);
    }
    for (const [hx, hz] of spots) {
      if (hash(hx, hz, 12) < 0.25) continue; // not every lot is built on
      const w = n(7 + hash(hx, hz) * 3), d = n(6 + hash(hz, hx) * 3), h = n(3);
      const x0 = hx - (w >> 1), z0 = hz - d;
      if (!claim(x0, z0, x0 + w, z0 + d)) continue;
      const wall = hash(hx, hz, 2) < 0.5 ? "mud_plaster" : hash(hx, hz, 3) < 0.5 ? "mud_brick" : "lime_plaster";
      box(x0, 0, z0, x0 + w, h, z0 + d, wall);
      box(x0, h, z0, x0 + w, h + 1, z0 + d, wall); // roof
      for (let x = x0; x < x0 + w; x++) { put(x, h + 1, z0, wall); put(x, h + 1, z0 + d - 1, wall); }
      for (let z = z0; z < z0 + d; z++) { put(x0, h + 1, z, wall); put(x0 + w - 1, h + 1, z, wall); }
      // a door and a small window on the side facing the lane
      const fz = z0 + d - 1, dx = x0 + (w >> 1);
      for (let y = 0; y < n(2); y++) { put(dx, y, fz, hash(hx, 5) < 0.5 ? "blue" : "dark_wood"); put(dx + 1, y, fz, hash(hx, 5) < 0.5 ? "blue" : "dark_wood"); }
      put(x0 + 3, 2, fz, "window"); put(x0 + 3, 3, fz, "window");
      // a stack of fodder or dung cakes by the wall
      const sx = x0 + w + 1, sz = z0 + 2;
      if (free(sx, sz)) for (let y = 0; y < 4; y++) for (let dx2 = -(3 - y); dx2 <= 3 - y; dx2++) for (let dz2 = -(3 - y); dz2 <= 3 - y; dz2++) put(sx + 3 + dx2, y, sz + 3 + dz2, hash(hx, hz, 9) < 0.5 ? "straw" : "dung_cake");
    }
    // a buffalo or two tethered by the neighbours' walls, and a tractor parked along the lane
    const buffalo = (x: number, z: number, along: boolean) => {
      // a water buffalo: four legs, a deep body, a low head out front with swept-back horns
      const L = n(2.2), W = n(0.9);
      const at = (u: number, w: number, y: number, m: string) => (along ? put(x + u, y, z + w, m) : put(x + w, y, z + u, m));
      for (const [u, w] of [[0, 0], [L - 1, 0], [0, W - 1], [L - 1, W - 1]]) for (let y = 0; y < n(0.7); y++) at(u, w, y, "black_stone");
      for (let u = 0; u < L; u++) for (let w = 0; w < W; w++) for (let y = n(0.7); y < n(1.4); y++) at(u, w, y, "black_stone");
      for (let u = L; u < L + n(0.6); u++) for (let w = Math.floor(W / 2) - 1; w <= Math.floor(W / 2); w++) for (let y = n(0.8); y < n(1.3); y++) at(u, w, y, "black_stone");
      for (const w of [Math.floor(W / 2) - 2, Math.floor(W / 2) + 1]) at(L, w, n(1.3), "stone"); // horns
      at(-1, Math.floor(W / 2), n(1.1), "black_stone"); // tail
    };
    let beasts = 0;
    for (let i = 0; i < 60 && beasts < 4; i++) {
      const x = X0 + Math.floor(hash(i, 41) * (X1 - X0)), z = Z0 + Math.floor(hash(i, 42) * (Z1 - Z0));
      if (outIn(x, z) < 3 || edgeDist(x, z) < n(4) || !claim(x, z, x + n(2.6), z + n(2.6))) continue;
      buffalo(x, z, hash(i, 43) < 0.5);
      beasts++;
    }
    // the tractor: red body, big black back wheels, small front ones, beside the lane away from the house
    const tx = vx(doorX + laneW / 2 + 0.5), tz = vx(crossZ - laneW / 2 - n(16) * S);
    if (free(tx, tz) && free(tx + n(1.8), tz + n(3.5))) {
      const rx = tx, rz = tz;
      for (let dx = 0; dx < n(1.4); dx++) for (let dz = 0; dz < n(3.4); dz++) for (let y = n(0.5); y < n(1.4); y++) put(rx + dx, y, rz + dz, "red");
      for (let y = n(1.4); y < n(2.4); y++) put(rx + n(0.7), y, rz + n(0.8), "iron"); // exhaust
      for (const side of [-1, n(1.4)]) {
        for (let dz = 0; dz < n(1.4); dz++) for (let y = 0; y < n(1.4); y++) put(rx + side, y, rz + dz, "black_stone");
        for (let dz = n(2.6); dz < n(3.4); dz++) for (let y = 0; y < n(0.8); y++) put(rx + side, y, rz + dz, "black_stone");
      }
      for (let dx = 0; dx < n(1.4); dx++) for (let dz = 0; dz < n(1); dz++) put(rx + dx, n(1.4), rz + dz, "black_stone"); // seat
    }
    // fields: a patchwork of plots, each one crop, with raised earth bunds between them
    const plot = n(11);
    const crops = ["wheat", "mustard", "wheat", "cane", "fodder", "furrow", "mustard", "wheat"];
    for (const key of [...meadow]) {
      const [x, z] = key.split(",").map(Number);
      if (outIn(x, z) < 2.5) continue;
      const px = Math.floor((x + 3) / plot), pz = Math.floor((z + 5) / (plot + n(3)));
      const bund = (x + 3) % plot === 0 || (z + 5) % (plot + n(3)) === 0;
      if (bund) { put(x, 0, z, "meadow"); continue; }
      const crop = crops[Math.floor(hash(px, pz, 4) * crops.length)];
      meadow.delete(key);
      const row = (hash(px, pz, 6) < 0.5 ? x : z) % 2 === 0;
      if (crop === "furrow") { put(x, -1, z, row ? "furrow" : "soil_dark", "ground"); continue; }
      put(x, -1, z, "soil_dark", "ground");
      // a crop is a carpet one voxel deep (cane stands taller), with a ripple of taller heads in rows
      const hgt = crop === "cane" ? 3 + (hash(x, z) < 0.3 ? 1 : 0) : 1;
      for (let y = 0; y < hgt; y++) put(x, y, z, crop === "mustard" && y < hgt - 1 ? "fodder" : crop);
      if (crop === "wheat" && row && hash(x, z, 8) < 0.12) put(x, 1, z, "wheat");
    }
    // trees along the lanes and field edges
    for (let i = 0; i < 400; i++) {
      const x = X0 + Math.floor(hash(i, 21) * (X1 - X0)), z = Z0 + Math.floor(hash(i, 22) * (Z1 - Z0));
      if (outIn(x, z) < 4 || edgeDist(x, z) < n(3)) continue;
      const L = n(4.5), nearLane = onLane(x + L, z) || onLane(x - L, z) || onLane(x, z + L) || onLane(x, z - L);
      if (onLane(x, z) || (!nearLane && hash(i, 23) < 0.85)) continue;
      if (grid.has(`${x},0,${z}`) && grid.get(`${x},0,${z}`)!.m !== "meadow" && !["wheat", "fodder", "mustard"].includes(grid.get(`${x},0,${z}`)!.m)) continue;
      tree(x, z, n(2.5 + hash(i, 24) * 2), n(1.5 + hash(i, 25)));
    }
  } else {
    // town: blocks of tall narrow houses with roof parapets, water tanks and stair huts, along a street grid
    const block = n(15); // between streets
    const street = n(4);
    const pastel = ["lime_plaster", "cream", "peach", "fired_brick", "lime_plaster", "sky", "cream", "mint", "sandstone"];
    const lots: Rect[] = [];
    for (let bx = Math.floor(X0 / (block + street)); bx * (block + street) < X1; bx++) for (let bz = Math.floor(Z0 / (block + street)); bz * (block + street) < Z1; bz++) {
      const x0 = bx * (block + street) + street, z0 = bz * (block + street) + street;
      // split each block into houses 10-16 voxels wide, two rows back to back
      for (let row = 0; row < 2; row++) {
        let x = x0;
        while (x < x0 + block) {
          const w = Math.min(x0 + block - x, n(5 + hash(x, z0 + row, 1) * 3.5));
          if (w >= n(3)) lots.push({ x0: x, x1: x + w, z0: z0 + row * (block >> 1), z1: z0 + (row + 1) * (block >> 1) });
          x += w;
        }
      }
    }
    for (const r of lots) {
      let ok = true;
      for (let x = r.x0; x < r.x1 && ok; x++) for (let z = r.z0; z < r.z1 && ok; z++) if (!free(x, z) || outIn(x, z) < 1) ok = false;
      if (!ok) continue;
      // never taller than about half the place's own skyline, and low and sparse behind it, where the
      // views look past it into open sky
      const behind = r.z0 * S > build.z1 && r.x1 * S > build.x0 - 15 && r.x0 * S < build.x1 + 15;
      if (behind && hash(r.x0, r.z0, 11) < 0.6) continue;
      const cap = Math.max(1, Math.floor((top * 0.5) / 3));
      const floors = behind ? 1 : Math.min(cap, 1 + Math.floor(hash(r.x0, r.z0, 3) ** 2 * 3) + (hash(r.x0, r.z0, 4) < 0.5 ? 1 : 0));
      const fh = n(3), h = floors * fh;
      const m = pastel[Math.floor(hash(r.x0, r.z0, 5) * pastel.length)];
      const x1 = r.x1 - 1, z1 = r.z1; // a one-voxel gap so the houses read as separate
      box(r.x0, 0, r.z0, x1, h, z1, m);
      for (let x = r.x0; x < x1; x++) { put(x, h, r.z0, m); put(x, h, z1 - 1, m); }
      for (let z = r.z0; z < z1; z++) { put(r.x0, h, z, m); put(x1 - 1, h, z, m); }
      // windows on every face, a few lit after dark
      for (let f = 0; f < floors; f++) {
        const y = f * fh + n(1), step = n(1.5), wh = n(1);
        for (let x = r.x0 + step; x < x1 - step; x += step) for (const z of [r.z0, z1 - 1]) {
          const lit = hash(x, z, f) < 0.45;
          for (let dy = 0; dy < wh; dy++) put(x, y + dy, z, lit ? "window" : "dark_wood");
        }
        for (let z = r.z0 + step; z < z1 - step; z += step) for (const x of [r.x0, x1 - 1]) {
          const lit = hash(x, z, f + 9) < 0.45;
          for (let dy = 0; dy < wh; dy++) put(x, y + dy, z, lit ? "window" : "dark_wood");
        }
      }
      // roof clutter: a black water tank or a stair hut
      const k = hash(r.x0, r.z1, 7);
      if (k < 0.45) box(r.x0 + n(1), h, r.z0 + n(1), r.x0 + n(2), h + n(1), r.z0 + n(2), "black_stone", false);
      else if (k < 0.7) box(x1 - n(3), h, r.z0 + n(1), x1 - n(1), h + n(2.5), r.z0 + n(3), m, false);
      if (hash(r.x1, r.z0, 8) < 0.12) for (let y = 0; y < 3; y++) for (let dx = -2 + y; dx <= 2 - y; dx++) for (let dz = -2 + y; dz <= 2 - y; dz++) put(((r.x0 + x1) >> 1) + dx, h + 1 + y, ((r.z0 + z1) >> 1) + dz, "lime_plaster");
      for (let x = r.x0; x < r.x1; x++) for (let z = r.z0; z < r.z1; z++) meadow.delete(`${x},${z}`);
    }
    // what is left between the houses is paved street, with a few trees
    for (const key of [...meadow]) {
      const [x, z] = key.split(",").map(Number);
      if (outIn(x, z) < 1.5) continue;
      put(x, -1, z, "street", "ground");
      meadow.delete(key);
      if (hash(x, z, 31) < 0.0035 * S * S * 4 && edgeDist(x, z) > n(3)) tree(x, z, n(2.5), n(1.5));
    }
  }
  return { vox: [...grid.values()], top: topCells, meadow, radius: Math.max(outer.x1 - outer.x0, outer.z1 - outer.z0) / 2, S };
}
