// An artist's impression: Muse Image repaints a view of the block house as the real place,
// keeping the layout from the build and the materials from what was said. Always labelled as an impression.
import { writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { apiKey, BASE, record } from "./meta.ts";
import type { HouseGraph } from "./graph.ts";

export async function paint(graph: HouseGraph, viewPng: string, outDir: string): Promise<string> {
  const said = graph.elements
    .map((e) => `- ${e.name}${e.original ? ` (${e.original})` : ""}: ${[e.material !== "unspecified" ? e.material.replace(/_/g, " ") : "", e.colour ?? "", e.detail ?? ""].filter(Boolean).join(", ") || "as shown"}`)
    .join("\n");
  const what = graph.landmark ? `a real place, ${graph.landmark}` : "a real home";
  const prompt = `This is a block model of ${what}, built from a spoken memory${graph.place ? ` (${graph.place})` : ""}. Repaint the same view as a natural, richly detailed photograph of the real place, as the person would remember it: real materials, real light, fine architectural detail.
Keep the camera, the layout, and the position and size of every part exactly as in the block model.
What was described:
${said}
The pale grey see-through blocks are guesses nobody described: paint them as plain, simple walls or roofs, nothing decorative.
No text, no signs, no watermark.`;
  const res = await fetch(`${BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "muse-image-1.0", prompt, images: [{ image_url: viewPng }], n: 1, response_format: "b64_json", output_format: "webp" }),
  });
  if (!res.ok) throw new Error(`image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  record({ kind: "image", model: "muse-image-1.0", tag: "paint", usd: 0.01 * j.data.length });
  const b64 = j.data[0].b64_json;
  if (!b64) throw new Error("no image returned");
  const n = readdirSync(outDir).filter((f) => f.startsWith("impression-")).length + 1;
  const file = `impression-${n}.webp`;
  writeFileSync(join(outDir, file), Buffer.from(b64, "base64"));
  return file;
}
