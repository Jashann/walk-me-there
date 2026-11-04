// Paint a saved still of a house with Muse Image (an impression): node eval/paint-still.ts <house-id> <still.png>
import { readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { paint } from "../server/paint.ts";
import { load, dir } from "../server/houses.ts";

const [id, png, out] = process.argv.slice(2);
const h = load(id)!;
const file = await paint(h.graph!, "data:image/png;base64," + readFileSync(png).toString("base64"), dir(id));
if (out) copyFileSync(join(dir(id), file), out);
console.log("wrote", join(dir(id), file));
