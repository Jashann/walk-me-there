// Screenshots of a build, taken by a headless Chrome that loads the house page in render mode.
// Used so the models can look at what they built. One browser is kept open and shared.
import puppeteer, { type Browser } from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.env.RENDER_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8787}`;

let browser: Promise<Browser> | null = null;
function getBrowser() {
  browser ??= puppeteer
    .launch({ executablePath: CHROME, headless: true, args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=swiftshader", ...(process.platform === "darwin" ? [] : ["--enable-unsafe-swiftshader", "--no-sandbox"]), "--enable-webgl", "--ignore-gpu-blocklist", "--window-size=1280,720"] })
    .then((b) => {
      b.on("disconnected", () => (browser = null));
      return b;
    });
  return browser;
}

export type View = "overview" | "entrance" | "plan" | "back";

export async function renderViews(houseId: string, views: View[] = ["overview", "entrance", "plan"]): Promise<{ view: View; dataUrl: string }[]> {
  try {
    return await renderOnce(houseId, views);
  } catch {
    browser = null; // the browser went away; start a fresh one and try once more
    return renderOnce(houseId, views);
  }
}

async function renderOnce(houseId: string, views: View[]): Promise<{ view: View; dataUrl: string }[]> {
  const b = await getBrowser();
  const out: { view: View; dataUrl: string }[] = [];
  for (const view of views) {
    const page = await b.newPage();
    try {
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await page.goto(`${ORIGIN}/h/${houseId}?render=${view}&quality=high`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => document.title === "ready", { timeout: 120000 });
      const b64 = await page.screenshot({ type: "jpeg", quality: 82, encoding: "base64" });
      out.push({ view, dataUrl: `data:image/jpeg;base64,${b64}` });
    } finally {
      await page.close();
    }
  }
  return out;
}

export async function closeRenderer() {
  if (browser) (await browser).close();
  browser = null;
}
