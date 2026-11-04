// The look-and-improve step: render the build, let Muse Spark look at it as an art director, then give
// Muse Wonder the pictures and the notes to improve the program. The improved build is kept only if it
// still passes every check that the current build passes, so beauty never costs faithfulness.
import { rmSync } from "node:fs";
import { chat, chatJSON, stripFence, type ChatPart } from "./meta.ts";
import { rulesFor, BUILDER_MODEL, graphForPrompt, type Attempt } from "./builder.ts";
import type { HouseGraph } from "./graph.ts";
import { runSandboxed } from "./sandbox.ts";
import { runChecks, summarize } from "./checks.ts";
import { renderViews } from "./render.ts";
import { create, dir, save } from "./houses.ts";

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ready", "issues"],
  properties: {
    ready: { type: "boolean" },
    issues: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["problem", "fix"], properties: { problem: { type: "string" }, fix: { type: "string" } } },
    },
  },
};

const DIRECTOR = `You are the art director for voxel dioramas of real homes that people described from memory. You see three renders of one build: a three-quarter overview, the view standing at the entrance, and a top-down plan. Coloured parts are things the person described; translucent grey parts are guesses.

Find what stops it looking like a real, lived-in, beautiful place from that region and era, and say exactly how to fix it with the building kit (rooms, walls, enclosure, gate, verandah, stairs, ladder, floor, path, roof, tree, charpai, handpump, chulha, tandoor, well, pond, plant, field, animal, object). Look for:
- proportions: rooms too long or thin, a courtyard far bigger than its contents, walls too low or high, things too small to read;
- composition: everything pushed into corners, large empty areas, awkward gaps between rooms that should share walls, things blocking doors or paths;
- craft: parts floating or cutting through walls, doors facing a wall, roofs that do not cover a room, mismatched materials within one house;
- life: surfaces that read flat where the region would have plaster, brick courses, beams, paths worn to doors, a raised plinth.
- grandeur (for real landmarks): built too small or too sparse for the real place, a main view from the entrance that is blocked, missing signature features of the real place (which may be added as "known:" parts), facades without portals, arcades, cornices or domes where the real place has them.

Rules: never ask for an object, room or animal that the description does not mention (for a real, well-known place, features the real place truly has are allowed, tagged "known:"). Structural guesses (boundary walls, roofs, door leaves) are fine and stay grey; do not ask for guessed paths, platforms or floors, because grey at floor level reads as a stain. A tree described as big should dominate its part of the yard, not the whole house. Keep the house readable from the overview. Do not move anything in a way that breaks a stated position (left, right, at the back, next to, inside). Give at most 8 issues, most important first. Set ready to true only if there is nothing worth fixing.`;

export type ReviewResult = { kept: boolean; notes: { problem: string; fix: string }[]; before: string; after: string | null; usd: number; attempt: Attempt | null };

export async function reviewAndImprove(g: HouseGraph, quotes: Map<number, string>, current: Attempt, tag: string): Promise<ReviewResult> {
  let usd = 0;
  // Render the current build through a temporary house.
  const tmp = create("text", "review", `tmp-${tag.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 20)}-${Math.random().toString(36).slice(2, 7)}`);
  tmp.graph = g;
  tmp.blocks = current.blocks;
  tmp.blockM = current.blockM;
  tmp.status = "ready";
  save(tmp);
  try {
    const shots = await renderViews(tmp.id, ["overview", "entrance", "plan"]);
    const graphText = graphForPrompt(g, quotes);
    const images: ChatPart[] = shots.map((s) => ({ type: "image_url", image_url: { url: s.dataUrl } }));
    const notes = await chatJSON<{ ready: boolean; issues: { problem: string; fix: string }[] }>({
      model: "muse-spark-1.3",
      effort: "medium",
      tag: `review:${tag}`,
      schema: { name: "art_notes", schema: NOTES_SCHEMA },
      messages: [
        { role: "system", content: DIRECTOR },
        { role: "user", content: [{ type: "text", text: `What was described:\n${graphText}\n\nRenders (overview, entrance, plan):` }, ...images] },
      ],
    });
    usd += notes.usd;
    const before = `${current.passed}/${current.total}`;
    if (notes.data.ready || !notes.data.issues.length) return { kept: false, notes: notes.data.issues, before, after: null, usd, attempt: null };

    const r = await chat({
      model: BUILDER_MODEL,
      effort: g.landmark ? "high" : "medium",
      maxTokens: 48000,
      tag: `improve:${tag}`,
      messages: [
        { role: "system", content: rulesFor(g) },
        {
          role: "user",
          content: [
            { type: "text", text: `Description:\n${graphText}\n\nYour current program:\n\`\`\`js\n${current.program}\n\`\`\`\n\nHere is how it looks (overview, entrance, plan):` },
            ...images,
            { type: "text", text: `An art director's notes:\n${notes.data.issues.map((i, n) => `${n + 1}. ${i.problem} Fix: ${i.fix}`).join("\n")}\n\nImprove the program to address the notes. Every position, size and tag rule still applies, and nothing that was not described may be added except grey structural guesses. Return the whole program in one \`\`\`js block.` },
          ],
        },
      ],
    });
    usd += r.usd;
    const passedBefore = new Set(current.checks.filter((c) => c.pass).map((c) => c.id));
    const tryProgram = async (program: string, cost: number, ms: number) => {
      const run = await runSandboxed(program);
      const checks = runChecks(g, run.blocks, run.error, run.blockM);
      const s = summarize(checks);
      const regressed = checks.filter((c) => !c.pass && passedBefore.has(c.id));
      const attempt: Attempt = { round: current.round + 1, program, blocks: run.blocks, checks, passed: s.passed, total: s.total, error: run.error, usd: cost, ms: ms + run.ms, blockM: run.blockM };
      return { attempt, regressed, ok: !run.error && regressed.length === 0 };
    };
    let res = await tryProgram(stripFence(r.text), r.usd, r.ms);
    // Up to two repair turns: keep the improvements, put back what the improvement broke.
    for (let fixTurn = 0; fixTurn < 2 && !res.ok; fixTurn++) {
      const fix = await chat({
        model: BUILDER_MODEL,
        effort: "medium",
        maxTokens: 48000,
        tag: `improve-fix${fixTurn}:${tag}`,
        messages: [
          { role: "system", content: rulesFor(g) },
          { role: "user", content: `Description:\n${graphText}` },
          { role: "assistant", content: "```js\n" + res.attempt.program + "\n```" },
          { role: "user", content: `Code checked this improved program. ${res.attempt.error ? `It failed to run: ${res.attempt.error}. ` : ""}These checks passed before the improvement and fail now:\n${res.regressed.map((c) => `- ${c.text}. The build shows: ${c.detail}.`).join("\n")}\n\nFix only these, keeping the visual improvements. Return the whole program in one \`\`\`js block.` },
        ],
      });
      usd += fix.usd;
      res = await tryProgram(stripFence(fix.text), r.usd + fix.usd, r.ms + fix.ms);
    }
    return { kept: res.ok, notes: notes.data.issues, before, after: `${res.attempt.passed}/${res.attempt.total}`, usd, attempt: res.attempt };
  } finally {
    rmSync(dir(tmp.id), { recursive: true, force: true });
  }
}
