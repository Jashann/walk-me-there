// Muse Wonder writes a build program from the house graph; the program runs in the sandbox;
// code checks the blocks against what was said; failures go back to Wonder with the words they break.
import { chat, stripFence, type ChatResult } from "./meta.ts";
import { MATERIALS, type HouseGraph } from "./graph.ts";
import { KIT_DOC } from "./kit.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSandboxed } from "./sandbox.ts";
import { runChecks, summarize, type Check } from "./checks.ts";
import type { Block } from "./world.ts";

// A worked example of a grand place at real scale, shown to the builder only when the place is a real landmark.
const GRAND_EXAMPLE = (() => {
  try {
    return readFileSync(join(import.meta.dirname, "grand-example.js"), "utf8");
  } catch {
    return "";
  }
})();

export const BUILDER_MODEL = process.env.BUILDER_MODEL ?? "muse-wonder-1.0";

export const BUILD_RULES = `You are a fine voxel architect. You write a short JavaScript program that builds, in detail, a real home that someone described out loud, so their family can walk through it. It should look like a beautiful, lived-in place from that region and era, and it must be faithful to every word.

Frame and units (metres)
- The person stands at the entrance looking in. -x is their LEFT, +x is their RIGHT, +z is deeper in, lower z is nearer the entrance. y is up; y = 0 is the ground.
- Put the entrance (gate or front door) at about x = 0, z = 0, and build deeper into +z. Keep everything within x -38..38, z -8..68, y 0..18.
- Everything snaps to a 0.25 m grid.

${KIT_DOC}

Materials (exact names): ${MATERIALS.join(", ")}.

Faithful (checked by code on every voxel)
- Tag every part of a described thing with that element's id, exactly. Sub-parts that were not described (a door nobody mentioned, a roof nobody mentioned, boundary walls, a platform) keep their default "unsaid:..." tag or get one from you ("unsaid:boundary_wall"). Guesses show as white clay, so the family can see what was said and what was not.
- Never tag anything with an id that is not in the element list.
- Never lay a guessed floor, lawn or ground cover over open ground: the scene already has ground under and around the place (earth, grass or moss to suit it). Lay floors and paths only where they were described.
- Keep guesses to structure that must be there (boundary walls, roofs, door leaves, posts). Do not add guessed paths, platforms or extra floors: grey at floor level reads as a stain.
- Positions must hold as described: left_of is smaller x, right_of larger x, behind larger z, in_front_of smaller z, inside within its footprint, next_to within 2 m, against_wall_of and opens_into touching, on_top_of directly above. Respect every size that was said, using metres.
- Described gates and doors stand open. You must be able to walk in through the entrance and into every described room: give each room a door on the side facing the courtyard or the way in, unless the description says where it is.

Real places (only when the description has a "landmark")
- When the place is a real, well-known site, you may also build its well-known features that the speaker did not mention, as they really are, tagged "known:<what>" (for example "known:clock_tower", "known:four_doors"). Use only features you are sure the real place has, at roughly their real positions relative to what was described. What the speaker said always wins where it differs from the real place: it is her memory.
- Build at quarter-metre detail (the default scale) whenever the whole place fits within about 110 m across and 200 m deep: domes, arches, windows and flags only read at that detail. Fit it by shrinking open ground (gardens, pools, plazas, walkways) before you shrink any building; keep the main building, its dome and its towers at their real size. Only if the place cannot fit, call useScale(0.5) first. Typical real dimensions: Harmandir Sahib's temple about 12 m square and 20 m tall on a platform in the middle of a sarovar about 150 m square (build the sarovar about 70 to 90 m) with a 6 to 10 m walkway rim, the causeway long enough to cross it; the Taj Mahal's platform 95 m square and 7 m high (build about 70 m), the tomb 57 m wide (build about 40 m), the dome 18 m across (build about 14 m) with its top at about 70 m (build it to fit under 60 m), minarets 40 m (build about 32 m), the garden 300 m long (build about 70 m); a large mosque courtyard 60 to 100 m; a fort wall 10 to 15 m high. Big flat areas cost one layer of voxels and solid masses are hollow inside, but keep the whole place under about 700,000 visible voxels.
- The main building of a Mughal tomb (the Taj Mahal, Humayun's tomb, Bibi Ka Maqbara) must be one mausoleum() call, the main temple of a gurdwara (Harmandir Sahib and its kin) one sikhTemple() call, and the main hall or pavilion of a Japanese temple one templeHall() call (a pagoda one pagoda() call, an arched bridge one archBridge() call, lotus on a pond lotus()): they draw the recognisable form (chamfers, framed arches, the dome, the gilding) far better than boxes and portals. Pass the dome's element id as domeTag and the small domes' as chhatriTag or kioskTag.
- Anything described as at the water's edge, on the water, or reflected in it stands right at the edge (its base touching the water or on stones in it), so the water mirrors it; keep paths narrow (1.5 to 2.5 m) and let grass, moss or garden fill the rest rather than wide paving.
- Keep the main view open: from the entrance you should see the main building across the garden, water or courtyard, with nothing large in between.

Beautiful (this is what the family will see)
- Use the kit, not raw boxes, for anything it covers; it draws plinths, lintels, beams, parapets, studs, rope weave and tree crowns for you.
- Build the whole place the words imply: if rooms are "around the courtyard", the courtyard is an earth floor surrounded by rooms and a boundary wall with the gate in it; a village house has thick plastered walls and flat parapet roofs (thatch, tin or tile only if said or typical for the region); a city flat is rooms in a row with doors between them.
- Choose materials and colours from the region and era when nothing was said, and keep them consistent: one wall material for the house, wood for doors and beams, a blue or green painted door where that is common.
- Give rooms their natural size (3.5 to 5 m a side unless said), walls 3 m high, doors 1 m wide, a courtyard large enough for what is in it, and leave walking space (at least 1.2 m) between things.
- Put furniture where people would use it: a charpai against a wall, a chulha near the kitchen side, a hand pump on a platform near the water's use. Things inside rooms go inside the walls, not through them.

Example (for this description: a blue double gate; inside, an open courtyard (vehra) with a mud floor; the hand pump (nalka) on the left near the gate and the chulha next to it; at the back two rooms side by side, grandmother's room on the right (12 by 10 feet) with her manji against the back wall, the grain room on the left; a big neem tree on the right side; a wooden ladder against the grain room wall to the roof where they slept):
\`\`\`js
// boundary: nobody described it, but a courtyard house is walled; the gate sits in the front wall
enclosure({x0: -9, z0: 0, x1: 9, z1: 17, height: 2.4, tag: "unsaid:boundary_wall", gap: {side: "front", width: 2.5}});
gate({tag: "gate", x: 0, z: 0, width: 2.5, color: "blue", postsTag: "unsaid:gate_posts"});
floor({x0: -8.5, z0: 0.5, x1: 8.5, z1: 12, material: "earth", tag: "courtyard"});
// near the gate on the left: the hand pump, and the chulha next to it
handpump({tag: "hand_pump", x: -3.25, z: 2});
chulha({tag: "chulha", x: -5.25, z: 2.25});
// the neem on the right side, shading the yard
tree({tag: "neem_tree", x: 5.5, z: 6.5, kind: "neem"});
// at the back, side by side: grain room on the left, grandmother's room (3.7 by 3 m) on the right
room({tag: "grain_room", x0: -8.5, z0: 12, x1: -1, z1: 16.5, doors: [{side: "front", at: "center"}], roofTag: "roof"});
room({tag: "grandmother_room", x0: -0.5, z0: 13.25, x1: 3.25, z1: 16.5, doors: [{side: "front", at: "center", color: "blue"}], windows: [{side: "front", at: 0.5}], roofTag: "roof"});
charpai({tag: "manji", x: 1.4, z: 15.4, along: "x"});
// the ladder against the front of the grain room, up to the roof
ladder({tag: "ladder", x: -3, z: 11.75, height: 3.25, along: "x"});
\`\`\`

Output only the program in one \`\`\`js block. Keep it under 250 lines.`;

// The builder's instructions; real landmarks also get a worked example of a grand place at real scale.
export function rulesFor(g: HouseGraph) {
  if (!g.landmark || !GRAND_EXAMPLE) return BUILD_RULES;
  return `${BUILD_RULES}\n\nExample of a grand place at about real scale (a Mughal tomb complex). Match this scale and density for real landmarks. Where a whole-building part fits the main building, use it rather than composing boxes: mausoleum() for a Mughal tomb (as here), sikhTemple() for a gurdwara like Harmandir Sahib; they carry the detail that makes the place recognisable. Use portals, cornices, domes, chhatris, gardens and water the way it does:\n\`\`\`js\n${GRAND_EXAMPLE}\n\`\`\``;
}

export function graphForPrompt(g: HouseGraph, quotes: Map<number, string>) {
  return JSON.stringify(
    {
      title: g.title,
      landmark: g.landmark ?? null,
      entrance: g.entrance,
      entrance_faces: g.entrance_faces,
      elements: g.elements.map((e) => ({ id: e.id, kind: e.kind, name: e.name, original: e.original, material: e.material, colour: e.colour, size: e.size, level: e.level, detail: e.detail, said: e.turns.map((t) => quotes.get(t)).filter(Boolean) })),
      relations: g.relations.map((r) => ({ a: r.a, rel: r.rel, b: r.b, said: r.quote })),
    },
    null,
    1,
  );
}

export type Attempt = { round: number; program: string; blocks: Block[]; checks: Check[]; passed: number; total: number; error: string | null; usd: number; ms: number; blockM: number };

export type BuildEvent =
  | { type: "attempt"; attempt: Attempt }
  | { type: "status"; text: string };

export async function build(
  g: HouseGraph,
  quotes: Map<number, string>,
  opts: { maxRepairs?: number; effort?: "low" | "medium" | "high"; onEvent?: (e: BuildEvent) => void; previous?: string; tag?: string } = {},
): Promise<{ best: Attempt; attempts: Attempt[] }> {
  const maxRepairs = opts.maxRepairs ?? 3;
  const attempts: Attempt[] = [];
  const graphText = graphForPrompt(g, quotes);
  const rules = rulesFor(g);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: rules },
    {
      role: "user",
      content: opts.previous
        ? `The description grew. Update this program so it builds everything in the new element list, keeping what already works.\n\nCurrent program:\n\`\`\`js\n${opts.previous}\n\`\`\`\n\nDescription:\n${graphText}`
        : `Build this house.\n\n${graphText}`,
    },
  ];

  for (let round = 0; round <= maxRepairs; round++) {
    const lastFailed = attempts.at(-1)?.checks.find((c) => !c.pass);
    opts.onEvent?.({ type: "status", text: round === 0 ? "Writing the build" : `Fixing: ${lastFailed?.text ?? "the build program"}` });
    const r: ChatResult = await chat({ model: BUILDER_MODEL, messages, effort: opts.effort ?? (g.landmark ? "high" : "medium"), maxTokens: 48000, tag: `${opts.tag ?? "build"}:r${round}` });
    const program = stripFence(r.text);
    const run = await runSandboxed(program);
    const checks = runChecks(g, run.blocks, run.error, run.blockM);
    const s = summarize(checks);
    const attempt: Attempt = { round, program, blocks: run.blocks, checks, passed: s.passed, total: s.total, error: run.error, usd: r.usd, ms: r.ms + run.ms, blockM: run.blockM };
    attempts.push(attempt);
    opts.onEvent?.({ type: "attempt", attempt });
    const failed = checks.filter((c) => !c.pass);
    if (!failed.length && !run.error) break;
    if (round === maxRepairs) break;
    messages.push({ role: "assistant", content: "```js\n" + program + "\n```" });
    messages.push({ role: "user", content: repairNote(failed, quotes, run.warnings) });
  }
  const best = attempts.reduce((a, b) => (b.passed > a.passed || (b.passed === a.passed && !b.error && a.error) ? b : a));
  return { best, attempts };
}

function repairNote(failed: Check[], quotes: Map<number, string>, warnings: string[]) {
  const lines = failed.slice(0, 40).map((c) => {
    const said = c.turns.map((t) => quotes.get(t)).filter(Boolean).slice(0, 2).map((q) => `"${q}"`).join(" / ");
    return `- ${c.text}${said ? ` (said: ${said})` : ""}. The build shows: ${c.detail}.`;
  });
  return `Code checked the blocks your program produced. These checks failed:\n${lines.join("\n")}${warnings.length ? `\nWarnings: ${warnings.slice(0, 8).join("; ")}` : ""}\n\nFix the program so every check passes without breaking the others. Return the whole corrected program in one \`\`\`js block.`;
}
