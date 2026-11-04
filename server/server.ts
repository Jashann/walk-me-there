// HTTP API, server-sent progress events, the live microphone socket, and the built web app.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { brotliCompress, constants as zc, gzipSync } from "node:zlib";
import { WebSocketServer } from "ws";
import { activeBuilds, bus, create, dir, list, load, processRecording, processTurns, save } from "./houses.ts";
import { relay, wavHeader } from "./live.ts";
import { mcPack, planFor } from "./export.ts";
import { spent, spendScope } from "./meta.ts";
import { BLOCK_M } from "./world.ts";
import { paint } from "./paint.ts";

if (Number(process.versions.node.split(".")[0]) < 26) {
  console.error("Walk Me There needs Node 26 or newer: the build sandbox relies on its permission model.");
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 8787);
const WEB = join(import.meta.dirname, "..", "web", "dist");
const ADMIN = process.env.ADMIN_TOKEN ?? ""; // when set, visitors build under the public limits and this token skips them
const GALLERY = process.env.GALLERY_ONLY === "1"; // a public copy that only shows places already built: nothing can be built, painted or spent
const PUBLIC_DAILY_USD = Number(process.env.PUBLIC_DAILY_USD ?? 20);
const MAX_UPLOAD = 200 << 20;
const VISITOR_UPLOAD = 50 << 20;
const MAX_BUILDS = Number(process.env.MAX_BUILDS ?? 3); // builds running at once for visitors; the public server is small
const LIVE_MS = 10 * 60_000;

// Visitors share a budget that grows every day and keeps whatever was not spent, counted from the permanent ledger.
const START_DAY = process.env.PUBLIC_START_DAY ?? new Date().toISOString().slice(0, 10);
const VISITOR_DAILY_USD = Number(process.env.VISITOR_DAILY_USD ?? 60);
const TOTAL_USD = Number(process.env.MAX_SPEND_USD ?? 100);
const today = () => new Date().toISOString().slice(0, 10);
const budgetSoFar = () => PUBLIC_DAILY_USD * (Math.floor((Date.parse(today()) - Date.parse(START_DAY)) / 86400000) + 1);
// The proxy appends the real address last; anything earlier in the header is whatever the visitor sent.
const visitorOf = (req: IncomingMessage) => String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress ?? "?";
const owned = new Map<string, { ip: string; day: string }>();
const painted = new Map<string, number>();
function visitorSpent(ip: string) {
  const day = today();
  let usd = painted.get(`${ip} ${day}`) ?? 0;
  for (const [id, o] of owned) if (o.ip === ip && o.day === day) usd += load(id)?.usd ?? 0;
  return usd;
}
function allowVisitor(req: IncomingMessage): string | null {
  const walk = "You can still walk through every place in the gallery.";
  if (spent() >= TOTAL_USD) return `Building is closed: this public demo has used its whole model budget, so no new places can be built. ${walk}`;
  if (spent() >= budgetSoFar()) return `Building is paused: this public demo has used its model budget for now. More is added at midnight UTC, so please try again after that. ${walk}`;
  if (visitorSpent(visitorOf(req)) >= VISITOR_DAILY_USD) return `You have reached today's building limit of $${VISITOR_DAILY_USD} in model costs. It resets at midnight UTC. The places you already built stay at their links. ${walk}`;
  if (activeBuilds() >= MAX_BUILDS) return `This server is busy: it builds up to ${MAX_BUILDS} places at once, and all are in use. Nothing was used up, so please try again in about 5 minutes.`;
  return null;
}
const own = (id: string, req: IncomingMessage) => { if (!owned.has(id)) owned.set(id, { ip: visitorOf(req), day: today() }); };
const isAdmin = (req: IncomingMessage) => !!ADMIN && req.headers.authorization === `Bearer ${ADMIN}`;

// Large bodies (a landmark is hundreds of thousands of blocks) go compressed when the browser accepts it.
const gzipOk = new WeakSet<ServerResponse>();
function json(res: ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body);
  if (text.length > 65536 && gzipOk.has(res)) {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Encoding": "gzip" });
    return res.end(gzipSync(text, { level: 6 }));
  }
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(text);
}

class BadRequest extends Error {}
async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = JSON.parse((await readBody(req, limit)).toString()); } catch (e) {
    if ((e as Error).message === "too large") throw e;
    throw new BadRequest("That request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("That request was not valid JSON.");
  return body as Record<string, unknown>;
}
async function readBody(req: IncomingMessage, limit = MAX_UPLOAD): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

// What the browser needs; programs and full check lists included because the page shows them.
// The public gallery never changes, so each place is compressed once, ahead of time, and sent as is.
const packed = new Map<string, Buffer>();
async function packGallery() {
  for (const { id } of list().filter((h) => h.public)) {
    const h = load(id);
    if (!h) continue;
    const buf = await new Promise<Buffer>((ok, no) => brotliCompress(JSON.stringify(view(h)), { params: { [zc.BROTLI_PARAM_QUALITY]: 9, [zc.BROTLI_PARAM_LGWIN]: 24 } }, (e, b) => (e ? no(e) : ok(b))));
    packed.set(id, buf);
  }
}

function view(h: NonNullable<ReturnType<typeof load>>) {
  return { ...h, mcVideo: existsSync(join(dir(h.id), "minecraft.mp4")), blockM: h.blockM ?? (0.5), blocks: h.blocks.map((b) => [b.x, b.y, b.z, b.m, b.t]) };
}

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4" };

function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type?: string) {
  const size = statSync(path).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const headers: Record<string, string | number> = { "Content-Type": type ?? TYPES[extname(path)] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
  if (path.includes("/assets/index-")) headers["Cache-Control"] = "public, max-age=31536000, immutable"; // file names change with content
  if (range) {
    const tail = !range[1] && range[2] ? Math.min(Number(range[2]), size) : 0; // "bytes=-10" means the last 10 bytes
    const start = tail ? size - tail : range[1] ? Number(range[1]) : 0;
    const end = tail || !range[2] ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start > end) return void res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
    createReadStream(path).pipe(res);
  }
}

// Live audio is raw PCM; give the browser a WAV (header + data) with range support.
function serveLiveAudio(req: IncomingMessage, res: ServerResponse, pcm: string) {
  const data = statSync(pcm).size;
  const header = wavHeader(data);
  const size = data + 44;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const tail = range && !range[1] && range[2] ? Math.min(Number(range[2]), size) : 0;
  const start = tail ? size - tail : range?.[1] ? Number(range[1]) : 0;
  const end = tail || !range?.[2] ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end) return void res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
  res.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
  if (start < 44) res.write(header.subarray(start, Math.min(44, end + 1)));
  if (end >= 44) createReadStream(pcm, { start: Math.max(0, start - 44), end: end - 44 }).pipe(res);
  else res.end();
}

const server = createServer(async (req, res) => {
  if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) gzipOk.add(res);
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    if (p === "/api/config") return json(res, 200, { gallery: GALLERY });
    if (GALLERY && req.method !== "GET" && req.method !== "HEAD") return json(res, 403, { error: "This public copy is a gallery of places the app has already built. To build your own, run Walk Me There from its code." });
    if (p === "/api/houses" && req.method === "GET") return json(res, 200, list().filter((h) => h.public || (!GALLERY && (!ADMIN || isAdmin(req)) && url.searchParams.get("all") === "1")));

    // Upload a recording: the body is the audio file itself. POST /api/houses/<id>/recordings adds to a house.
    const addTo = p.match(/^\/api\/houses\/([a-z0-9-]+)\/recordings$/);
    if ((p === "/api/houses" || addTo) && req.method === "POST") {
      if (ADMIN && !isAdmin(req)) {
        const why = allowVisitor(req);
        if (why) return json(res, 429, { error: why });
      }
      const target = addTo ? load(addTo[1]) : null;
      if (ADMIN && !isAdmin(req) && target?.public) return json(res, 403, { error: "The places in the gallery cannot be changed. Upload your own recording to build a new place." });
      const ext = (String(req.headers["content-type"] ?? "").match(/audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a|m4a|ogg|webm|aac)/)?.[1] ?? "bin").replace("mpeg", "mp3").replace(/x-?/, "");
      const body = await readBody(req, ADMIN && !isAdmin(req) ? VISITOR_UPLOAD : MAX_UPLOAD);
      const h = addTo ? load(addTo[1]) : create("recording", url.searchParams.get("context") ?? "");
      if (!h) return json(res, 404, { error: "No such house" });
      if (h.status !== "ready" && h.status !== "error" && addTo) return json(res, 409, { error: "This house is still being built. Try again in a minute." });
      const n = h.turns.length ? new Set(h.turns.map((t) => t.file).filter(Boolean)).size + 1 : 1;
      const file = `recording-${n}.${ext}`;
      mkdirSync(dir(h.id), { recursive: true });
      writeFileSync(join(dir(h.id), file), body);
      if (!h.audioFile) h.audioFile = file;
      h.error = null;
      save(h);
      const bias = url.searchParams.get("languages")?.split(",").filter(Boolean);
      if (ADMIN && !isAdmin(req)) own(h.id, req);
      void processRecording(h, join(dir(h.id), file), bias, file);
      return json(res, 201, { id: h.id });
    }

    // Typed description, one turn per line or sentence.
    if (p === "/api/houses/text" && req.method === "POST") {
      const why = !ADMIN || isAdmin(req) ? null : allowVisitor(req);
      if (why) return json(res, 429, { error: why });
      const body = await readJson(req, 64 << 10);
      const text = String(body.text ?? "").slice(0, 6000);
      const parts = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
      if (!parts.length) return json(res, 400, { error: "Describe a place first." });
      const h = create("text", String(body.context ?? ""));
      if (ADMIN && !isAdmin(req)) own(h.id, req);
      void processTurns(h, parts.map((s, i) => ({ turnId: i + 1, transcript: s, speaker: "A" })));
      return json(res, 201, { id: h.id });
    }

    const m = p.match(/^\/api\/houses\/([a-z0-9-]+)(\/[a-z0-9.]+)?$/);
    if (m) {
      const ready = (GALLERY || ADMIN) && !m[2] && req.method === "GET" && /\bbr\b/.test(String(req.headers["accept-encoding"] ?? "")) ? packed.get(m[1]) : undefined;
      if (ready) {
        res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "br", "Cache-Control": "public, max-age=600", Vary: "Accept-Encoding" });
        return void res.end(ready);
      }
      const h = load(m[1]);
      if (!h) return json(res, 404, { error: "No such house" });
      const sub = m[2] ?? "";
      if (sub === "" && req.method === "GET") return json(res, 200, view(h));
      if (sub === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`data: ${JSON.stringify({ type: "hello", status: h.status, statusText: h.statusText, version: h.version })}\n\n`);
        const on = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
        bus.on(h.id, on);
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => (bus.off(h.id, on), clearInterval(ping)));
        return;
      }
      if (sub === "/audio" && h.audioFile) {
        const want = url.searchParams.get("file");
        const name = want && /^(recording-\d+\.[a-z0-9]+|live\.pcm)$/.test(want) ? want : h.audioFile;
        const f = join(dir(h.id), name);
        if (!existsSync(f)) return json(res, 404, { error: "no audio" });
        return name.endsWith(".pcm") ? serveLiveAudio(req, res, f) : serveFile(req, res, f);
      }
      // Big places take seconds to work out, so the public copy serves a pack prepared ahead of time.
      if (sub === "/minecraft.zip") {
        const ready = join(dir(h.id), "minecraft.zip");
        if (!h.blocks?.length) return json(res, 409, { error: "This place has not been built yet." });
        const name = { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="walkmethere-${h.id}.zip"` };
        if (existsSync(ready)) { res.writeHead(200, name); return void createReadStream(ready).pipe(res); }
        res.writeHead(200, name);
        return void res.end(mcPack(planFor(h), h.graph?.title ?? h.id));
      }
      if (sub === "/minecraft.mp4") {
        const film = join(dir(h.id), "minecraft.mp4");
        if (existsSync(film)) return void serveFile(req, res, film, "video/mp4");
        return json(res, 404, { error: "No video for this place" });
      }
      if (sub === "/paint" && req.method === "POST") {
        if (!h.graph) return json(res, 409, { error: "Nothing to paint yet" });
        const why = isAdmin(req) || !ADMIN ? null : allowVisitor(req);
        if (why) return json(res, 429, { error: why });
        const body = await readJson(req, 12 << 20);
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(String(body.image))) return json(res, 400, { error: "bad image" });
        const scope = { usd: 0 };
        const file = await spendScope.run(scope, () => paint(h.graph!, String(body.image), dir(h.id)));
        if (ADMIN && !isAdmin(req)) { const k = `${visitorOf(req)} ${today()}`; painted.set(k, (painted.get(k) ?? 0) + scope.usd); }
        return json(res, 201, { url: `/api/houses/${h.id}/impression?file=${file}` });
      }
      if (sub === "/attempt") {
        const n = Number(url.searchParams.get("n"));
        const f = join(dir(h.id), `attempt-${n}.json`);
        if (!Number.isInteger(n) || n < 0 || !existsSync(f)) return json(res, 404, { error: "no such build" });
        const a = JSON.parse(readFileSync(f, "utf8")) as { blocks: { x: number; y: number; z: number; m: string; t: string }[]; checks: unknown[]; blockM?: number };
        return json(res, 200, { ...a, blockM: a.blockM ?? h.blockM ?? 0.5, blocks: a.blocks.map((b) => [b.x, b.y, b.z, b.m, b.t]) });
      }
      if (sub === "/impression") {
        const f = url.searchParams.get("file") ?? "";
        if (!/^impression-\d+\.webp$/.test(f) || !existsSync(join(dir(h.id), f))) return json(res, 404, { error: "no such impression" });
        return serveFile(req, res, join(dir(h.id), f), "image/webp");
      }
      if (sub === "/publish" && req.method === "POST" && isAdmin(req)) {
        h.public = !h.public;
        save(h);
        return json(res, 200, { public: h.public });
      }
    }

    if (p === "/api/budget") return json(res, 200, { spent: Number(spent().toFixed(2)) });

    if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });
    // Static web app.
    if (existsSync(WEB)) {
      let f = join(WEB, p === "/" ? "index.html" : p);
      if (!f.startsWith(WEB) || !existsSync(f) || statSync(f).isDirectory()) f = join(WEB, "index.html");
      return serveFile(req, res, f);
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof BadRequest) return json(res, 400, { error: e.message });
    if ((e as Error).message === "too large") return json(res, 413, { error: `That file is too large. The limit is ${VISITOR_UPLOAD >> 20} MB, so please upload a shorter recording.` });
    if (res.headersSent) return void res.destroy();
    json(res, 500, { error: String((e as Error).message ?? e) });
  }
});
// One bad request must never take down the builds other people are waiting for.
process.on("uncaughtException", (e) => console.error("uncaught", e));
process.on("unhandledRejection", (e) => console.error("unhandled", e));

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (GALLERY) return void socket.destroy();
  let url: URL;
  try { url = new URL(req.url ?? "/", "http://x"); } catch { return void socket.destroy(); }
  if (url.pathname !== "/api/live") return socket.destroy();
  const refused = !isAdmin(req) && ADMIN && url.searchParams.get("token") !== ADMIN ? allowVisitor(req) : null;
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (refused) {
      ws.send(JSON.stringify({ type: "error", message: refused }));
      return void ws.close(1008);
    }
    const id = url.searchParams.get("house");
    const existing = id ? load(id) : null;
    const visitor = !!ADMIN && !isAdmin(req) && url.searchParams.get("token") !== ADMIN;
    if (visitor && existing?.public) return void ws.close(1008, "The places in the gallery cannot be changed. Start a new one from the home page.");
    if (visitor) { const stop = setTimeout(() => ws.close(1000, "This session reached its 10-minute limit. What you said so far is saved in this place, and you can start a new one from the home page."), LIVE_MS); ws.on("close", () => clearTimeout(stop)); }
    const h = existing || create("live", url.searchParams.get("context") ?? "");
    if (visitor) own(h.id, req);
    ws.send(JSON.stringify({ type: "house", id: h.id }));
    relay(ws, h, { languageBias: url.searchParams.get("languages")?.split(",").filter(Boolean) });
  });
});

if (GALLERY || ADMIN) void packGallery().catch((e) => console.error("packing the gallery failed", e));
// Without an admin token there are no visitor limits, so a plain local run stays on this machine unless HOST says otherwise.
const HOST = process.env.HOST ?? (GALLERY || ADMIN ? "0.0.0.0" : "127.0.0.1");
server.listen(PORT, HOST, () => console.log(`Walk Me There on http://localhost:${PORT}  (spent so far $${spent().toFixed(2)})`));
