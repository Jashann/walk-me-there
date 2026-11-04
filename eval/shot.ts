// One framed still of a house: node eval/shot.ts <id> <out.png> <camx> <camy> <camz> <tx> <ty> <tz> [time 0..1] [width]
// Coordinates are the viewer's (x is mirrored from the build: viewer x = -build x).
import puppeteer from "puppeteer-core";
const [id, out, ...n] = process.argv.slice(2);
const [cx, cy, cz, tx, ty, tz, t = 0, w = 1600] = n.map(Number);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
const p = await b.newPage();
await p.setViewport({ width: w, height: Math.round((w * 9) / 16) });
await p.goto(`http://localhost:${process.env.PORT ?? 8787}/h/${id}?quality=high`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => (window as any).viewer?.parts?.length, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate((a) => {
  document.body.classList.add("render");
  (document.querySelector(".labels") as HTMLElement).style.display = "none";
  const v = (window as any).viewer;
  v.view("overview", null);
  v.setTimeOfDay(a[6]);
  v.orbit.target.set(a[3], a[4], a[5]);
  v.camera.position.set(a[0], a[1], a[2]);
  v.orbit.update();
}, [cx, cy, cz, tx, ty, tz, t]);
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: out as `${string}.png` });
await b.close();
