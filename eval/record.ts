// Records a house's fly-through (or story) as a video with headless Chrome, for the demo video.
// node eval/record.ts <house-id> <out.mp4> [fly|story] [seconds]
import puppeteer from "puppeteer-core";

const [id, out, what = "fly", secs = "31", night = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1920,1080"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${process.env.PORT ?? 8787}/h/${id}?quality=high`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => (window as unknown as { viewer?: { parts: unknown[] } }).viewer?.parts?.length, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));
await page.evaluate(() => {
  document.body.classList.add("render");
  (document.querySelector(".labels") as HTMLElement).style.display = "none";
});
if (night === "night") await page.evaluate(() => (window as unknown as { viewer: { setNight(on: boolean): void } }).viewer.setNight(true));
// "dusk": the sun sets and the lamps come on during the shot
if (night === "dusk") await page.evaluate((s) => (window as unknown as { viewer: { playDusk(s: number): void } }).viewer.playDusk(s), (Number(secs) || 50) * 0.8);
if (night === "golden") await page.evaluate(() => (window as unknown as { viewer: { setTimeOfDay(t: number): void } }).viewer.setTimeOfDay(0.42));
const rec = await page.screencast({ path: out as `${string}.mp4`, fps: 30 } as never);
await page.evaluate((w) => {
  const label = w === "story" ? "Play story" : "Fly through";
  [...document.querySelectorAll(".tools button")].find((b) => b.textContent === label)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}, what);
// "auto": as long as the flight itself takes
await new Promise((r) => setTimeout(r, 400));
const ms = secs === "auto" ? (((await page.evaluate("viewer.flightMs")) as number) || 30000) + 1500 : Number(secs) * 1000;
await new Promise((r) => setTimeout(r, ms));
await rec.stop();
await browser.close();
console.log("wrote", out);
