// Hero stills of a house for review: wide day, golden hour, night, and frames from the fly-through.
// node eval/stills.ts <house-id> <out-dir> [width]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const [id, out, width = "1600"] = process.argv.slice(2);
const W = Number(width), H = Math.round((W * 9) / 16);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${process.env.PORT ?? 8787}/h/${id}?quality=high`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => (window as any).viewer?.parts?.length, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));
await page.evaluate(() => {
  document.body.classList.add("render");
  (document.querySelector(".labels") as HTMLElement).style.display = "none";
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (name: string) => {
  await wait(700);
  await page.screenshot({ path: `${out}/${name}.png` as `${string}.png` });
};
const v = (fn: string) => page.evaluate(fn);

await v("viewer.setTimeOfDay(0); viewer.view('overview', null)");
await shot("1-day-wide");
await v("viewer.setTimeOfDay(0.45)");
await shot("2-golden-wide");
await v("viewer.setNight(true)");
await shot("3-night-wide");
await v("viewer.setNight(false)");
// fly-through frames: start the flight, then sample it
const secs = 30;
await page.evaluate(() => {
  [...document.querySelectorAll(".tools button")].find((b) => b.textContent === "Fly through")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
const t0 = Date.now();
await wait(300);
const flightMs = (await page.evaluate("viewer.flightMs")) as number || secs * 1000;
for (const f of [0.2, 0.38, 0.55, 0.72]) {
  const at = t0 + f * flightMs;
  await wait(Math.max(0, at - Date.now()));
  await page.screenshot({ path: `${out}/4-fly-${Math.round(f * 100)}.png` as `${string}.png` });
}
await browser.close();
console.log("wrote", out);
