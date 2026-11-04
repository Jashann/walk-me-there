// Turns voxels into one mesh per element: only exposed faces, smooth corner ambient occlusion
// (the shading that makes voxel scenes read as solid), and a little colour variation per voxel.
import * as THREE from "three";

export type Vox = { x: number; y: number; z: number; m: string; t: string };

// Hand-tuned palettes, a few shades each; a voxel picks one by hash so walls look made, not flat.
export const PALETTE: Record<string, string[]> = {
  mud_brick: ["#a8774c", "#a2714a", "#ad7c51", "#9c6c44"],
  fired_brick: ["#a4472d", "#9a4129", "#b05236", "#8e3b25"],
  lime_plaster: ["#f1ebdf", "#eee7da", "#f3eee4", "#ebe3d5"],
  mud_plaster: ["#c6a072", "#c29c6e", "#c9a476", "#bf996b"],
  cement: ["#b4b2ac", "#aaa8a2", "#bebcb5"],
  stone: ["#9b958a", "#8d877c", "#a8a296", "#837d72"],
  wood: ["#9c6b3c", "#916236", "#a67444", "#875a31"],
  dark_wood: ["#5c3b22", "#53351f", "#664227"],
  thatch: ["#c8a457", "#bf9b4e", "#d1ad62", "#b69246"],
  tin: ["#9fa8ad", "#949da2", "#aab3b8"],
  earth: ["#b9946c", "#b58f68", "#bc976f", "#b28c65"],
  dung_floor: ["#a98b63", "#a68860", "#ac8e66"],
  tile: ["#b8653f", "#ad5d39", "#c26e46"],
  grass: ["#78a046", "#6e963f", "#82aa4e", "#668c39"],
  water: ["#3f93b5", "#3a8cae", "#4699bb", "#3488aa"],
  lava: ["#ff6a1a", "#ff8a24", "#f25010", "#ffa030"],
  leaves: ["#4f7f35", "#477530", "#5a8a3c", "#3f6a2a", "#628f42"],
  trunk: ["#6b4a2e", "#62432a", "#745034"],
  cloth: ["#dccbab", "#d3c2a2", "#e3d3b4"],
  rope_weave: ["#cdb07d", "#c3a674", "#d6ba86", "#b89b69"],
  iron: ["#4e555a", "#474e53", "#565d62"],
  clay: ["#b8693f", "#ae6139", "#c27346"],
  glass: ["#cfe5ec"],
  white: ["#f2eee6", "#ebe6dd"],
  blue: ["#3d6ea8", "#3766a0", "#4377b0"],
  green: ["#4b8a56", "#45824f", "#52925d"],
  yellow: ["#d8b23f", "#cfa938", "#e0bb48"],
  red: ["#a8423a", "#9e3b34", "#b24a41"],
  unspecified: ["#c9b08a", "#c1a882", "#d0b792"],
  marble: ["#e6e1d6", "#e1dbcf", "#eae5db", "#dcd6c9"],
  gold: ["#f2c54e", "#eabb42", "#f7cf5c", "#e4b23b"],
  sandstone: ["#d9b98a", "#d2b183", "#dec092", "#cba97a"],
  red_sandstone: ["#a8513a", "#9f4a35", "#b05a41", "#964431"],
  blue_tile: ["#2f6fa8", "#3a7bb3", "#285f93", "#4a8bc0"],
  green_tile: ["#3f8a6a", "#46936f", "#377c5f"],
  black_stone: ["#3a3a3c", "#333335", "#424245"],
  saffron: ["#f08a24", "#e8801c", "#f5952e"],
  pink: ["#e48aa8", "#da7d9c", "#ee97b3"],
  gravel: ["#cfc8bb", "#c8c1b4", "#d6cfc2", "#c2bbae"],
  vermilion: ["#d0442c", "#c83f28", "#d84b32"],
  dark_tile: ["#4a4f57", "#454a52", "#50555d"],
  bark_shingle: ["#5e4636", "#584232", "#644a39"],
  moss: ["#5f7d3a", "#587536", "#66853f", "#516e31"],
  maple: ["#c2361e", "#d04a1f", "#b52d1c", "#d9631f", "#c84320"],
  ginkgo: ["#e3b52a", "#d9a823", "#ebc136"],
  pine: ["#2f5530", "#2a4e2b", "#355c35"],
  blossom: ["#f2bfd0", "#efb2c6", "#f6cad8", "#eaa7bf"],
  // the diorama base and the scenery round it
  plaza: ["#c9a98a", "#c3a283", "#cfb091", "#bd9c7e", "#d4b89c"],
  street: ["#a8978a", "#a19083", "#ae9d90", "#9a8a7d"],
  lane: ["#a88a64", "#a2845f", "#ad8f69", "#9d805b"],
  rock_light: ["#9c8d7a", "#958673", "#a29380"],
  rock: ["#7d6f60", "#776a5b", "#837565"],
  rock_dark: ["#5f554b", "#594f46", "#655a50"],
  soil_dark: ["#6e5238", "#684d35", "#73563b"],
  furrow: ["#8a6a48", "#846544", "#8f6e4c"],
  wheat: ["#d9b85e", "#d2b056", "#dfbf66", "#cca851"],
  mustard: ["#f0cf2a", "#e9c623", "#f5d636"],
  cane: ["#5f8f3a", "#588735", "#66973f"],
  fodder: ["#4f8a33", "#4a822f", "#55903a"],
  straw: ["#d6b977", "#cfb170", "#dcc07f"],
  dung_cake: ["#7a5a3a", "#735536", "#80603f"],
  window: ["#8a6a3e", "#83643a"],
  cream: ["#efe2c4", "#eadcbd", "#f2e6ca"],
  peach: ["#e9b896", "#e4b28f", "#edbe9c"],
  sky: ["#a9c6d6", "#a3c0d0", "#afcbdb"],
  mint: ["#b5d3b8", "#afcdb2", "#bbd8be"],
  soil: ["#7c5b3c", "#73553a", "#836141", "#6d5036"],
  meadow: ["#7fa04a", "#7b9c48", "#84a44e", "#789946"],
  yard: ["#c2a174", "#c09f72", "#c4a376", "#bf9e71"],
};
// How much each material glows after dark (gilt catches lamplight, lamps and flames burn).
const GILT = ["#fbcb52", "#f8c74e", "#fdcf58"];
export const GLOW: Record<string, number> = { lava: 3, window: 7, gold: 0.55, saffron: 0.25, yellow: 0.35, glass: 0.6, white: 0.12, marble: 0.1 }; // marble and whitewash hold a little moonlight

export const CLAY = ["#cfccc6", "#cac7c1", "#d3d0ca"]; // guesses: solid cool grey like an architect's model, a colour no real material here uses
const TRANSPARENT = new Set(["water", "glass"]);
export const FOLIAGE = new Set(["leaves", "maple", "ginkgo", "pine", "blossom"]);
const METAL = new Set(["gold"]);
const SMOOTH = new Set(["marble", "gold", "white", "glass", "blue_tile", "green_tile"]);

// face table: normal, u, v with u x v = normal, so (0,0) (1,0) (1,1) (0,1) is counter-clockwise from outside
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO = [0.52, 0.68, 0.84, 1.0];

function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type TagMesh = { tag: string; geometry: THREE.BufferGeometry; faceVox: Vox[]; guess: boolean; transparent: boolean; metal: boolean };

export function meshVoxels(voxels: Vox[], size: number): TagMesh[] {
  // Neighbour lookups run millions of times, so voxels sit in flat arrays indexed by position.
  // The margin keeps every neighbour offset used below inside the arrays.
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of voxels) {
    if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
    if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
  }
  const M = 4;
  const nx_ = voxels.length ? x1 - x0 + 1 + 2 * M : 0, ny_ = voxels.length ? y1 - y0 + 1 + 2 * M : 0, nz_ = voxels.length ? z1 - z0 + 1 + 2 * M : 0;
  const key = (x: number, y: number, z: number) => (x - x0 + M) * ny_ * nz_ + (y - y0 + M) * nz_ + (z - z0 + M);
  // very sparse, very large builds fall back to hash maps so the arrays never get huge
  const dense = nx_ * ny_ * nz_ <= 2e8;
  const cells = dense ? new Int32Array(nx_ * ny_ * nz_) : null;
  const cellMap = dense ? null : new Map<number, Vox>();
  voxels.forEach((v, i) => { if (cells) cells[key(v.x, v.y, v.z)] = i + 1; else cellMap!.set(key(v.x, v.y, v.z), v); });
  const voxAt = (x: number, y: number, z: number): Vox | undefined => {
    if (!cells) return cellMap!.get(key(x, y, z));
    const i = cells[key(x, y, z)];
    return i ? voxels[i - 1] : undefined;
  };
  const isGuess = (v: Vox) => v.t.startsWith("unsaid");
  const occludes = (x: number, y: number, z: number) => {
    const v = voxAt(x, y, z);
    return !!v && !TRANSPARENT.has(v.m);
  };

  // Curved stone and gilt (domes, drums, bulbs) are shaded as the smooth shapes they stand for: each face's
  // normal leans toward the local surface direction, found from which neighbours are solid. Flat walls are
  // unchanged (their neighbours say the same as their face); a stepped dome stops showing terrace rings.
  const occ = dense ? new Uint8Array(cells!.length) : null;
  const occSet = dense ? null : new Set<number>();
  for (const v of voxels) if (!TRANSPARENT.has(v.m) && !FOLIAGE.has(v.m)) { if (occ) occ[key(v.x, v.y, v.z)] = 1; else occSet!.add(key(v.x, v.y, v.z)); }
  const smoothN = (v: Vox): [number, number, number] | null => {
    let gx = 0, gy = 0, gz = 0;
    // a ball of radius 3 voxels: wide enough to see past single terrace steps
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
      if ((!dx && !dy && !dz) || dx * dx + dy * dy + dz * dz > 10) continue;
      const kk = key(v.x + dx, v.y + dy, v.z + dz);
      if (occ ? occ[kk] : occSet!.has(kk)) (gx -= dx), (gy -= dy), (gz -= dz);
    }
    const l = Math.hypot(gx, gy, gz);
    return l < 5 ? null : [gx / l, gy / l, gz / l];
  };
  type Acc = { pos: number[]; nor: number[]; col: number[]; glow: number[]; idx: number[]; faceVox: Vox[]; guess: boolean; transparent: boolean; metal: boolean };
  const groups = new Map<string, Acc>();
  const color = new THREE.Color();
  // parsing a colour string or testing a pattern per block adds up, so each is worked out once
  const parsed = new Map<string, THREE.Color>();
  const setHex = (hex: string) => {
    let c = parsed.get(hex);
    if (!c) parsed.set(hex, (c = new THREE.Color(hex)));
    color.copy(c);
  };
  const weathers = new Map<string, boolean>(), damps = new Map<string, boolean>();
  const weathered = (m: string) => { let w = weathers.get(m); if (w === undefined) weathers.set(m, (w = /plaster|mud_brick/.test(m))); return w; };
  const dampable = (m: string) => { let w = damps.get(m); if (w === undefined) damps.set(m, (w = /plaster|brick|stone|white/.test(m))); return w; };

  for (const v of voxels) {
    const guess = isGuess(v);
    const transparent = TRANSPARENT.has(v.m);
    // gilt gets its own polished metal material in the viewer
    const metal = !guess && METAL.has(v.m);
    const gkey = `${v.t}|${transparent ? "t" : metal ? "m" : "o"}`;
    let g = groups.get(gkey);
    if (!g) groups.set(gkey, (g = { pos: [], nor: [], col: [], glow: [], idx: [], faceVox: [], guess, transparent, metal }));
    const known = v.t.startsWith("known:");
    const pal = guess ? CLAY : PALETTE[v.m] ?? PALETTE.unspecified;
    const r = hash(v.x, v.y, v.z);
    setHex(pal[Math.floor(r * pal.length)]);
    if (v.m === "gold" && !guess) setHex(GILT[Math.floor(r * GILT.length)]); // metal: the colour is the reflectance
    // parts of a real place that the speaker did not mention: true colours, a little muted
    if (known) color.lerp(new THREE.Color(color.r * 0.3 + color.g * 0.59 + color.b * 0.11, color.r * 0.3 + color.g * 0.59 + color.b * 0.11, color.r * 0.3 + color.g * 0.59 + color.b * 0.11), 0.35);
    // polished stone and metal stay smooth; everything else varies a little per voxel
    let jitter = SMOOTH.has(v.m) ? 0.985 + hash(v.z, v.x, v.y) * 0.03 : 0.96 + hash(v.z, v.x, v.y) * 0.08;
    // weathering: plaster in soft patches of about half a metre, and a darker damp band near the ground
    if (!guess && weathered(v.m)) jitter *= 0.97 + hash(v.x >> 1, v.y >> 1, v.z >> 1) * 0.06;
    const sm = !guess && SMOOTH.has(v.m) && v.m !== "glass" ? smoothN(v) : null;
    // guesses carry a faint diagonal hatch, like pencil on an architect's model
    if (guess && (((v.x + v.y + v.z) % 6) + 6) % 6 < 2) jitter *= 0.8; // bold diagonal stripes, readable on video
    for (const [n, u, w] of FACES) {
      const nx = v.x + n[0], ny = v.y + n[1], nz = v.z + n[2];
      let fn: number[] = n;
      if (sm && sm[0] * n[0] + sm[1] * n[1] + sm[2] * n[2] > 0.2) {
        const b = [n[0] * 0.3 + sm[0], n[1] * 0.3 + sm[1], n[2] * 0.3 + sm[2]], bl = Math.hypot(b[0], b[1], b[2]);
        fn = [b[0] / bl, b[1] / bl, b[2] / bl];
      }
      const nb = voxAt(nx, ny, nz);
      if (nb) {
        const nbT = TRANSPARENT.has(nb.m);
        // Keep the face when the neighbour can be hidden (a guess next to something said) or see-through.
        const hide = transparent ? nbT : !nbT && !(isGuess(nb) && !guess) && !FOLIAGE.has(nb.m);
        if (hide) continue;
        if (FOLIAGE.has(v.m) && FOLIAGE.has(nb.m)) continue;
      }
      const ao: number[] = [];
      const base = g.pos.length / 3;
      for (const [cu, cv] of CORNERS) {
        const su = cu ? 1 : -1, sv = cv ? 1 : -1;
        const s1 = occludes(nx + su * u[0], ny + su * u[1], nz + su * u[2]) ? 1 : 0;
        const s2 = occludes(nx + sv * w[0], ny + sv * w[1], nz + sv * w[2]) ? 1 : 0;
        const c = occludes(nx + su * u[0] + sv * w[0], ny + su * u[1] + sv * w[1], nz + su * u[2] + sv * w[2]) ? 1 : 0;
        const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        ao.push(level);
        // voxel (x, y, z) covers [x, x+1) x [y, y+1) x [z, z+1) in voxel units
        const px = v.x + 0.5 + 0.5 * n[0] + (cu - 0.5) * u[0] + (cv - 0.5) * w[0];
        const py = v.y + 0.5 + 0.5 * n[1] + (cu - 0.5) * u[1] + (cv - 0.5) * w[1];
        const pz = v.z + 0.5 + 0.5 * n[2] + (cu - 0.5) * u[2] + (cv - 0.5) * w[2];
        g.pos.push(px * size, py * size, pz * size);
        g.nor.push(fn[0], fn[1], fn[2]);
        const damp = !guess && n[1] === 0 && v.y <= 1 && dampable(v.m) ? 0.86 + 0.07 * v.y : 1;
        // curved surfaces keep only a whisper of corner shading, or every terrace of a dome draws a ring
        const shade = (sm || (!guess && SMOOTH.has(v.m)) ? 0.82 + 0.18 * AO[level] : AO[level]) * jitter * damp;
        g.col.push(color.r * shade, color.g * shade, color.b * shade);
        g.glow.push(guess ? 0 : GLOW[v.m] ?? 0);
      }
      // Flip the diagonal where it hides the occlusion gradient.
      if (ao[0] + ao[2] < ao[1] + ao[3]) g.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      else g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      g.faceVox.push(v);
    }
  }

  const out: TagMesh[] = [];
  for (const [key, g] of groups) {
    if (!g.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(g.glow, 1));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    out.push({ tag: key.split("|")[0], geometry: geo, faceVox: g.faceVox, guess: g.guess, transparent: g.transparent, metal: g.metal });
  }
  return out;
}
