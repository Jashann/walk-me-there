import "./style.css";
import { HouseViewer, type Block, type ElementInfo } from "./viewer.ts";
import { startMic, type Mic } from "./mic.ts";

// A public gallery copy hides everything that builds or spends.
void fetch("/api/config").then((r) => r.json()).then((c) => { if (c.gallery) document.body.classList.add("gallery-mode"); }).catch(() => {});

type Turn = { turnId: number; startMs: number; endMs: number; transcript: string; speaker?: string; english: string; original: string; romanized: string | null; file?: string };
type Element = ElementInfo & { material: string; detail: string | null; turns: number[]; size: { phrase: string | null } };
type Relation = { a: string; rel: string; b: string; turns: number[]; quote: string };
type Gap = { question_en: string; question_original: string | null; about: string | null; why: string };
type Graph = { title: string; place: string | null; speaker_relation: string | null; entrance: string | null; landmark?: string | null; surroundings?: string | null; elements: Element[]; relations: Relation[]; gaps: Gap[] };
type Check = { id: string; kind: string; subject: string; text: string; turns: number[]; pass: boolean; detail: string };
type Attempt = { round: number; passed: number; total: number; usd: number; ms: number; error: string | null; failed: { text: string; detail: string }[]; saved?: boolean; look?: boolean };
type House = {
  id: string; source: string; status: string; statusText: string; error: string | null; audioFile: string | null; context: string;
  turns: Turn[]; graph: Graph | null; attempts: Attempt[]; program: string | null; blocks: Block[]; checks: Check[]; usd: number; version: number; blockM: number;
  look?: { problem: string; fix: string }[];
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
function playIcon() {
  const i = document.createElement("span");
  i.className = "icon";
  i.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
  return i;
}

function downloadIcon() {
  const i = document.createElement("span");
  i.className = "icon";
  i.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/></svg>';
  return i;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | false | undefined)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c);
  return el;
}

const app = $("#app");
route();
addEventListener("popstate", route);

function go(path: string) {
  history.pushState(null, "", path);
  route();
}

function route() {
  const m = location.pathname.match(/^\/h\/([a-z0-9-]+)/);
  app.replaceChildren();
  if (m) housePage(m[1]);
  else homePage();
}

// ---------------------------------------------------------------- home

// Clearer names for places whose own title came out of an unclear line.
const TITLES: Record<string, string> = { ad136a: "A covered shopping street in Tokyo", "734377": "A castle game level" };
const placeTitle = (id: string, t?: string | null) => TITLES[id.slice(-6)] ?? t;

function homePage() {
  const ctx = h("input", { class: "ctx", placeholder: "Who is speaking, about which place? (optional)", maxlength: 200 }) as HTMLInputElement;
  const lang = h("select", { class: "lang" },
    h("option", { value: "" }, "Any language"),
    h("option", { value: "Hindi,English" }, "Punjabi or Hindi, with English"),
    h("option", { value: "English" }, "English"),
  ) as HTMLSelectElement;
  const file = h("input", { type: "file", accept: "audio/*,video/mp4", hidden: true }) as HTMLInputElement;
  const text = h("textarea", { class: "type", rows: 6, placeholder: "You came in through a blue wooden gate. The courtyard was open, with a hand pump on the left near the gate..." }) as HTMLTextAreaElement;
  const msg = h("p", { class: "msg" });

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    msg.textContent = `Uploading ${f.name}...`;
    const q = new URLSearchParams({ context: ctx.value, languages: lang.value });
    const r = await fetch(`/api/houses?${q}`, { method: "POST", headers: { "Content-Type": f.type || "audio/mpeg" }, body: f });
    const j = await r.json();
    if (!r.ok) return void (msg.textContent = j.error);
    go(`/h/${j.id}`);
  };

  const typeIt = async () => {
    if (!text.value.trim()) return text.focus();
    msg.textContent = "Starting...";
    const r = await fetch("/api/houses/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.value, context: ctx.value }) });
    const j = await r.json();
    if (!r.ok) return void (msg.textContent = j.error);
    go(`/h/${j.id}`);
  };

  const gallery = h("div", { class: "gallery" });
  // Her house first, then the places built from recordings, then the landmarks.
  const ORDER = ["64e4a6", "3aebe1", "0166d1", "50cfc0", "ad136a", "734377", "b3cbf4", "5be5c1", "718e33", "35b0d6", "ac8fe2", "21a301", "fe4e97", "77e4d2", "fc048c"];
  const rank = (id: string) => { const i = ORDER.findIndex((k) => id.endsWith(k)); return i < 0 ? 99 : i; };
  fetch("/api/houses").then((r) => r.json()).then((list: { id: string; title?: string; source: string }[]) => {
    list.sort((a, b) => rank(a.id) - rank(b.id));
    list.forEach((x, i) => {
      const img = h("img", { src: `/thumbs/${x.id}.jpg`, alt: "", loading: "lazy" }) as HTMLImageElement;
      img.onerror = () => img.remove();
      gallery.append(h("a", { class: i === 0 ? "card lead" : "card", href: `/h/${x.id}`, onclick: (e: Event) => (e.preventDefault(), go(`/h/${x.id}`)) }, img, h("span", { class: "meta" }, h("b", {}, placeTitle(x.id, x.title) ?? "A house"), h("span", {}, x.source === "live" ? "told live" : x.source === "recording" ? "from a recording" : "typed"))));
    });
    if (!list.length) gallery.remove();
  });

  app.append(
    h("main", { class: "home" },
      h("h1", {}, "Walk Me There"),
      h("p", { class: "lede" }, "Describe a place out loud, in your own language. A few minutes later you can walk through it. Every block that was described keeps the words that put it there. Anything the app guessed stays grey, and the scenery around the place is only a backdrop."),
      h("p", { class: "home-links" }, h("a", { href: "https://youtu.be/iIRtdv87Whk", target: "_blank", rel: "noopener" }, "Watch the film"), " · ", h("a", { href: "https://github.com/Jashann/walk-me-there", target: "_blank", rel: "noopener" }, "Read the code")),
      h("div", { class: "setup" }, ctx, lang),
      h("div", { class: "actions" },
        h("button", { class: "big talk", onclick: () => go(`/h/new-live?${new URLSearchParams({ context: ctx.value, languages: lang.value })}`) }, "Talk"),
        h("button", { class: "big", onclick: () => file.click() }, "Upload a recording"),
        file,
      ),
      h("details", { class: "typebox" }, h("summary", {}, "Or type it instead"), text, h("button", { onclick: typeIt }, "Build it")),
      h("p", { class: "gallery-note" }, "This public copy is a gallery of places the app has already built, so building is switched off here. Open any place to walk through it."),
      h("p", { class: "muted upload-note build-only" }, "Your recording or description goes to Meta's Model API to build your place, which gets its own unlisted link. Please only upload speech you have permission to share."),
      msg,
      gallery,
    ),
  );
}

// ---------------------------------------------------------------- house

function housePage(id: string) {
  const stage = h("div", { class: "stage" });
  const title = h("h2", {}, "...");
  const sub = h("p", { class: "sub" });
  const status = h("span", { class: "status" });
  const copyLink = h("button", { type: "button", onclick: async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyLink.textContent = "Copied";
    } catch {
      copyLink.textContent = "Copy it from the address bar";
    }
    setTimeout(() => (copyLink.textContent = "Copy link"), 2500);
  } }, "Copy link");
  const saveLink = h("p", { class: "save-link", hidden: true }, h("span", {}, h("b", {}, "Save this page's link."), " It's the only way back to this place, and it isn't listed anywhere public."), copyLink);
  // Check sentences and details read back with display names and normal grammar.
  // Details name things by their ids; sentences already use display names.
  const sayDetail = (t: string) => {
    let out = t;
    for (const e of house?.graph?.elements ?? []) out = out.replace(new RegExp(`\\b${e.id}\\b(?= (centre|stands|from|covers))`, "g"), e.name);
    return out;
  };
  const say = (t: string) => {
    const out = t;
    return out
      .replace(/\b([\w' -]+) \(\1\)$/i, "$1")
      .replace(/\bthere is a the /g, "there is the ")
      .replace(/\bthere is a ([A-Z])/g, "there is $1")
      .replace(/\bthere is a ([aeiou])/g, "there is an $1")
      .replace(/\bthe the\b/g, "the")
      .replace(/\bthe ([A-Z][a-z]+ [A-Z][a-z]+'s)/g, "$1")
      .replace(/\bthe (Bibi Ji's)/g, "$1")
      .replace(/everything in colour belongs/, "everything in colour inside the place belongs")
      .replace(/everything in colour is cited/, "everything in colour inside the place is cited, and scenery outside it is not counted");
  };
  // In the empty scene before a place exists: what is about to happen there.
  const emptyTitle = h("p", { class: "empty-title" });
  const emptySub = h("p", { class: "empty-sub" });
  const emptySpin = h("div", { class: "spinner" });
  const emptyNote = h("div", { class: "empty-note", hidden: true }, emptySpin, emptyTitle, emptySub);
  let micOn = false;
  const renderEmpty = () => {
    const building = !!house && ["transcribing", "translating", "mapping", "building"].includes(house.status);
    const blank = !house?.blocks?.length && !viewer.parts.length && house?.status !== "error" && title.textContent !== "No such place";
    const noPlace = !house?.blocks?.length && !viewer.parts.length;
    houseEl.classList.toggle("no-place", noPlace);
    houseEl.classList.toggle("no-house", !house);
    houseEl.classList.toggle("no-mic", !micOn);
    emptyNote.hidden = !blank || (!building && !micOn && id !== "new-live" && house?.source !== "live");
    emptySpin.hidden = !building && !micOn;
    emptyTitle.textContent = building ? "Building your place" : micOn ? "Listening..." : "Your place will appear here";
    emptySub.textContent = building ? "This can take a few minutes. You can keep talking, or come back to this link later." : micOn ? "Keep talking, and pause between thoughts. It starts building after you pause." : "Press Start talking, then describe it.";
  };
  const card = h("aside", { class: "card-info", hidden: true });
  const panel = h("aside", { class: "panel" });
  const ticker = h("div", { class: "ticker", hidden: true });
  const audio = new Audio();
  audio.preload = "auto";
  let house: House | null = null;
  let selected: string | null = null;
  let tab = "said";
  let shownAttempt: number | null = null; // an earlier build shown from the Builds tab
  let showHeard = false; // "What was said" also shows the raw transcript Muse Voice Transcribe wrote
  let stopAt = 0;
  audio.ontimeupdate = () => stopAt && audio.currentTime >= stopAt && (audio.pause(), (stopAt = 0));

  const viewer = new HouseViewer(stage);
  (window as unknown as { viewer: HouseViewer }).viewer = viewer; // handy from the console
  const guessBtn = h("button", { class: "on", onclick: () => { viewer.setShowGuesses(!viewer.showGuesses); guessBtn.classList.toggle("on", viewer.showGuesses); } }, "Guesses");
  const labelBtn = h("button", { class: "on", onclick: () => { viewer.setShowLabels(!viewer.showLabels); labelBtn.classList.toggle("on", viewer.showLabels); } }, "Labels");
  const walkBtn = h("button", { class: "primary", onclick: () => (viewer.mode === "walk" ? viewer.setMode("orbit") : (viewer.walkIn(house?.graph?.entrance ?? null), (viewer.camera.position.z -= 2.4))) }, "Walk in");
  viewer.onModeChange = (m) => {
    walkBtn.textContent = m === "walk" ? "Back to overview" : "Walk in";
    flyBtn.textContent = m === "fly" ? "Stop" : "Fly through";
    walkBtn.classList.toggle("primary", m !== "fly");
    document.body.classList.toggle("flying", m === "fly");
    document.body.classList.toggle("walking", m === "walk");
    if (m === "walk" && !selected) card.hidden = true;
  };
  viewer.onHover = (tag) => {
    if (!selected && viewer.mode === "orbit") showCard(tag);
    stage.style.cursor = tag && !tag.startsWith("unsaid") && !tag.startsWith("known:") ? "pointer" : "";
  };
  viewer.onSelect = (tag) => {
    selected = tag && !tag.startsWith("unsaid") && !tag.startsWith("known:") ? tag : null;
    viewer.highlight(selected);
    showCard(tag);
  };

  const mcLink = h("button", { class: "mc-btn", onclick: () => openMcDialog() }, downloadIcon(), "Download for Minecraft");
  const mcFilm = h("button", { class: "mc-btn", hidden: true, onclick: () => openMcFilm() }, playIcon(), "Watch in Minecraft");
  const copyRow = (text: string) => {
    const btn = h("button", { class: "copy", type: "button", onclick: () => {
      void navigator.clipboard?.writeText(text).then(() => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy"), 1500); });
    } }, "Copy");
    return h("div", { class: "cmd" }, h("code", {}, text), btn);
  };
  const openDialog = (...kids: (Node | string)[]) => {
    const dlg = h("dialog", { class: "mc-dialog" }, ...kids, h("button", { class: "mc-close", type: "button", onclick: () => dlg.close() }, "Close"));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  };
  const openMcFilm = () => {
    const film = h("video", { class: "mc-film", src: `/api/houses/${id}/minecraft.mp4`, controls: true, playsinline: true });
    openDialog(
      h("h3", {}, `${house?.graph?.title ?? "This place"} in Minecraft`),
      film,
    );
    film.muted = true; // browsers only autoplay muted video, and the attribute alone is not enough here
    void film.play().catch(() => {});
  };
  const openMcDialog = () => {
    openDialog(
      h("h3", {}, "Build this place in Minecraft"),
      h("p", { class: "muted" }, "For Minecraft: Java Edition, in a world with cheats on. Tested on version 26.3."),
      h("a", { class: "btn primary mc-download", href: `/api/houses/${id}/minecraft.zip`, download: "" }, downloadIcon(), "Download the data pack"),
      h("h4", {}, "1. Add it to your world"),
      h("p", {}, "Put the downloaded zip, unopened, in .minecraft/saves/your world/datapacks."),
      h("h4", {}, "2. Stand where the entrance should go"),
      h("p", {}, "Use a big flat area. Press T to open the chat, run these two commands, and stay in the same spot."),
      copyRow("/reload"),
      copyRow("/function walkmethere:setup"),
      h("h4", {}, "3. Wait about 5 seconds, then build"),
      copyRow("/function walkmethere:place"),
      h("p", { class: "muted" }, "The game may freeze for a while on the largest places. When it is done, this lets the area unload again:"),
      copyRow("/function walkmethere:done"),
    );
  };
  const storyBtn = h("button", { onclick: () => void playStory() }, "Play story");
  // The most important thing to fly to: what the speaker talked about most, especially if it is the
  // landmark itself ("Harmandir Sahib"), weighed with how big it is. Never the entrance.
  const focusOf = () => {
    if (!house?.graph) return null;
    const words = `${house.graph.landmark ?? ""} ${house.graph.title}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    let best: string | null = null, top = -1;
    for (const e of house.graph.elements) {
      if (e.id === house.graph.entrance || ["tree", "wall", "boundary_wall", "path", "street", "field", "courtyard", "pond", "water_tank", "animal", "object", "furniture"].includes(e.kind)) continue;
      const bx = viewer.boxes.get(e.id);
      if (!bx) continue;
      const named = words.some((w) => `${e.id} ${e.name}`.toLowerCase().includes(w)) ? 4 : 1;
      const v = named * (1 + e.turns.length) * (bx.y1 - bx.y0) * Math.sqrt((bx.x1 - bx.x0) * (bx.z1 - bx.z0));
      if (v > top) (top = v), (best = e.id);
    }
    return best;
  };
  const flyBtn = h("button", { onclick: () => (viewer.mode === "fly" ? viewer.stopFlight() : viewer.flyThrough(house?.graph?.entrance ?? null, focusOf())) }, "Fly through");
  const more = h("input", { type: "file", accept: "audio/*,video/mp4", hidden: true }) as HTMLInputElement;
  const moreBtn = h("button", { class: "build-only", title: "Add a recording that answers the Ask next questions", onclick: () => more.click() }, "Add a recording");
  more.onchange = async () => {
    const f = more.files?.[0];
    if (!f) return;
    status.textContent = `Uploading ${f.name}`;
    const r = await fetch(`/api/houses/${id}/recordings?languages=${encodeURIComponent(new URLSearchParams(location.search).get("languages") ?? "")}`, { method: "POST", headers: { "Content-Type": f.type || "audio/mpeg" }, body: f });
    if (!r.ok) status.textContent = (await r.json()).error;
    more.value = "";
  };
  const paintBtn = h("button", { class: "build-only", title: "Muse Image paints an impression of this view", onclick: () => void paintView() }, "Paint this view");
  const nightBtn = h("button", { onclick: () => { const toNight = viewer.night < 0.5; if (toNight) viewer.playDusk(6); else viewer.setNight(false); nightBtn.classList.toggle("on", toNight); } }, "Night");
  const detailsBtn = h("button", { class: "only-mobile", onclick: () => document.body.classList.toggle("panel-open") }, "Details");
  const tools = h("div", { class: "tools" }, walkBtn, flyBtn, storyBtn, nightBtn, detailsBtn, paintBtn, guessBtn, labelBtn, mcFilm, mcLink, moreBtn, more);

  // Muse Image repaints the current view. Shown beside the blocks, always labelled as an impression.
  async function paintView() {
    if (!house?.graph) return;
    paintBtn.textContent = "Painting...";
    (paintBtn as HTMLButtonElement).disabled = true;
    const labelsWere = viewer.showLabels;
    viewer.setShowLabels(false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const view = viewer.snapshot();
    viewer.setShowLabels(labelsWere);
    try {
      const r = await fetch(`/api/houses/${id}/paint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: view }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const overlay = h("div", { class: "impression", onclick: (e: Event) => e.target === overlay && overlay.remove() },
        h("figure", {},
          h("div", { class: "pair" }, h("img", { src: view, alt: "The block house" }), h("img", { src: j.url, alt: "An impression of the place" })),
          h("figcaption", {}, "Right: an impression painted by Muse Image from this view and the words that were said. The layout comes from the blocks; textures, light and small details are invented."),
          h("button", { onclick: () => overlay.remove() }, "Close"),
        ),
      );
      document.body.append(overlay);
    } catch (e) {
      status.textContent = `Painting failed: ${(e as Error).message}`;
    } finally {
      paintBtn.textContent = "Paint this view";
      (paintBtn as HTMLButtonElement).disabled = false;
    }
  }
  let storyRun = 0;

  // Rebuild the house in the order it was told: each line plays in the speaker's own voice
  // while the things it introduced rise; guesses come last, in grey.
  async function playStory() {
    if (!house?.graph) return;
    const run = ++storyRun;
    if (storyBtn.textContent === "Stop story") return void ((storyBtn.textContent = "Play story"), endStory());
    storyBtn.textContent = "Stop story";
    viewer.setMode("orbit");
    viewer.frameOverview();
    viewer.orbit.autoRotate = true;
    viewer.orbit.autoRotateSpeed = 0.5;
    const firstTurn = new Map<string, number>();
    for (const e of house.graph.elements) firstTurn.set(e.id, Math.min(...e.turns));
    const shown: Block[] = [];
    viewer.setBlocks([], false);
    ticker.hidden = false;
    for (const t of house.turns) {
      if (run !== storyRun) return;
      const ids = new Set([...firstTurn].filter(([, n]) => n === t.turnId).map(([id]) => id));
      shown.push(...house.blocks.filter((b) => ids.has(b[4])));
      viewer.setBlocks([...shown], true);
      ticker.replaceChildren(h("span", {}, t.english), t.romanized ? h("span", { class: "orig" }, t.original) : "");
      const ms = house.audioFile && t.endMs > t.startMs ? t.endMs - t.startMs + 400 : Math.max(2500, t.english.length * 55);
      if (house.audioFile && t.endMs > t.startMs) void play(t);
      await new Promise((r) => setTimeout(r, ms));
    }
    if (run !== storyRun) return;
    viewer.setBlocks(house.blocks, true);
    ticker.replaceChildren(h("span", {}, "Everything grey is a guess. Nobody said it."));
    await new Promise((r) => setTimeout(r, 4000));
    if (run === storyRun) endStory();
  }
  function endStory() {
    storyRun++;
    storyBtn.textContent = "Play story";
    viewer.orbit.autoRotate = false;
    audio.pause();
    ticker.hidden = true;
    if (house) viewer.setBlocks(house.blocks, false);
  }
  const hint = h("div", { class: "hint" }, "W A S D to walk, mouse to look, Space to step up. Click a block to see what was said. Esc to stop and to use the buttons.");
  app.append(h("div", { class: "house" }, stage, h("header", {}, h("a", { href: "/", class: "home-link", onclick: (e: Event) => (e.preventDefault(), go("/")) }, "Walk Me There"), title, sub, status, saveLink), tools, hint, panel, card, ticker));
  // While a place loads: a clear loader instead of an empty sky and blank panels.
  const houseEl = app.querySelector(".house") as HTMLElement;
  const loader = h("div", { class: "loader" }, h("div", { class: "spinner" }), h("p", {}, "Loading this place..."));
  houseEl.classList.add("loading");
  houseEl.append(loader, emptyNote);
  const doneLoading = () => { houseEl.classList.remove("loading"); loader.remove(); };
  const loadStart = Date.now();
  const loadTimer = setInterval(() => {
    const waiting = id !== "new-live" && title.textContent !== "No such place" && (!house || (house.status === "ready" && !viewer.parts.length));
    if (!waiting || Date.now() - loadStart > 60000) { clearInterval(loadTimer); doneLoading(); }
  }, 150);
  // The info card starts just under the title box, whatever its height.
  const titleBox = app.querySelector(".house header") as HTMLElement;
  const placeCard = () => (app.querySelector(".house") as HTMLElement)?.style.setProperty("--header-bottom", `${titleBox.getBoundingClientRect().bottom + 10}px`);
  new ResizeObserver(placeCard).observe(titleBox);
  // Labels that would land on an earlier one stay hidden until there is room.
  const declutter = () => {
    const taken: DOMRect[] = [];
    for (const l of document.querySelectorAll<HTMLElement>(".labels .label")) {
      const r = l.getBoundingClientRect();
      if (!r.width) continue;
      const hit = taken.some((t) => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top);
      l.classList.toggle("crowded", hit);
      if (!hit) taken.push(r);
    }
  };
  const declutterTimer = setInterval(() => { if (!document.querySelector(".house")) clearInterval(declutterTimer); else declutter(); }, 400);

  async function play(t: Turn) {
    if (!house?.audioFile) return;
    const src = `/api/houses/${id}/audio${t.file ? `?file=${t.file}` : ""}`;
    if (!audio.src.endsWith(src)) {
      audio.src = src;
      await new Promise((r) => audio.addEventListener("loadedmetadata", r, { once: true }));
    }
    audio.currentTime = Math.max(0, t.startMs / 1000 - 0.15);
    stopAt = t.endMs / 1000 + 0.25;
    void audio.play();
  }

  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  function turnLine(t: Turn) {
    return h("div", { class: "quote" },
      house?.audioFile && t.endMs > t.startMs ? h("button", { class: "play", title: "Hear it", onclick: () => void play(t) }, "▶") : null,
      h("div", {},
        // what Muse Voice Transcribe wrote, with its timing, before any translation
        showHeard ? h("p", { class: "heard" }, t.endMs > t.startMs ? `${clock(t.startMs)}–${clock(t.endMs)}  ` : "", t.transcript) : null,
        h("p", {}, `"${t.english}"`),
        t.romanized ? h("p", { class: "orig" }, t.original) : null,
      ),
    );
  }

  function showCard(tag: string | null) {
    if (!house?.graph || !tag) return void (card.hidden = !selected);
    card.hidden = false;
    if (tag.startsWith("known:")) {
      card.replaceChildren(h("h3", {}, tag.slice(6).replace(/_/g, " ")), h("p", { class: "muted" }, `Part of the real ${house.graph.landmark ?? "place"}, added from what is known about it. Nobody said it, so it is shown a little muted, and "Guesses" hides it.`));
      return;
    }
    if (tag.startsWith("unsaid")) {
      card.replaceChildren(h("h3", {}, "A guess"), h("p", { class: "muted" }, `Nobody described this (${tag.slice(7).replace(/_/g, " ") || "filler"}). The app added it as a guess, and it stays grey.`));
      return;
    }
    const e = house.graph.elements.find((x) => x.id === tag);
    if (!e) return void (card.hidden = true);
    const turns = e.turns.map((n) => house!.turns.find((t) => t.turnId === n)).filter(Boolean) as Turn[];
    const checks = house.checks.filter((c) => c.subject === e.id || c.id.includes(`:${e.id}`));
    card.replaceChildren(...[
      h("h3", {}, e.name, e.original && e.original.toLowerCase() !== e.name.toLowerCase() ? h("i", {}, ` ${e.original}`) : null),
      h("p", { class: "muted" }, [e.material !== "unspecified" ? e.material.replace(/_/g, " ") : null, e.size?.phrase].filter(Boolean).join(" · ")),
      e.detail ? h("p", {}, e.detail) : null,
      h("h4", {}, "What was said"),
      ...turns.map(turnLine),
      checks.length ? h("h4", {}, "Checked against the build") : null,
      ...checks.map((c) => h("p", { class: `check ${c.pass ? "pass" : "fail"}` }, `${c.pass ? "✓" : "✗"} ${say(c.text)}`)),
      selected ? h("button", { class: "close", onclick: () => viewer.onSelect(null) }, "Close") : null,
    ].filter((x) => !!x) as HTMLElement[]);
  }

  // Show one earlier build in place of the latest (null: back to the latest), with what failed in it lit up.
  async function showAttempt(i: number | null) {
    if (!house) return;
    shownAttempt = i;
    if (i === null) {
      viewer.setBlocks(house.blocks, false, house.blockM);
      viewer.highlight(null);
    } else {
      const r = await fetch(`/api/houses/${id}/attempt?n=${i}`);
      if (!r.ok) return;
      const x = (await r.json()) as { blocks: Block[]; checks: Check[]; blockM: number };
      viewer.setBlocks(x.blocks, false, x.blockM);
      viewer.highlight(x.checks.find((c) => !c.pass)?.subject ?? null);
    }
    renderPanel();
  }

  function renderPanel() {
    if (!house) return;
    const tabs = [["said", "What was said"], ["checks", "Checks"], ["ask", "Ask next"], ["builds", "Builds"]];
    const body = h("div", { class: "panel-body" });
    if (tab === "said") {
      if (house.source !== "text" && house.turns.some((t) => t.transcript)) body.append(h("button", { class: "heard-toggle", onclick: () => ((showHeard = !showHeard), renderPanel()) }, showHeard ? "Hide the raw transcript" : "Show the raw transcript"));
      for (const t of house.turns) {
        const els = house.graph?.elements.filter((e) => e.turns.includes(t.turnId)) ?? [];
        const row = turnLine(t);
        if (new Set(house.turns.map((x) => x.speaker)).size > 1) row.prepend(h("span", { class: "who" }, t.speaker ?? ""));
        if (els.length) row.append(h("div", { class: "chips" }, ...els.map((e) => h("button", { class: "chip", onclick: () => viewer.onSelect(e.id) }, e.name))));
        body.append(row);
      }
      if (!house.turns.length) body.append(h("p", { class: "muted" }, house.source === "live" ? "Start talking. Each sentence adds to the house." : "Listening..."));
    } else if (tab === "checks") {
      const pass = house.checks.filter((c) => c.pass).length;
      body.append(h("p", { class: "muted" }, `${pass} of ${house.checks.length} pass. Most checks come from the words, the rest test that you can walk it. Code runs them all on the blocks.`));
      for (const c of [...house.checks].sort((a, b) => Number(a.pass) - Number(b.pass))) {
        body.append(h("div", { class: `check ${c.pass ? "pass" : "fail"}`, onclick: () => c.subject && viewer.onSelect(c.subject) }, h("b", {}, `${c.pass ? "✓" : "✗"} ${say(c.text)}`), h("small", {}, sayDetail(c.detail))));
      }
    } else if (tab === "ask") {
      body.append(h("p", { class: "muted" }, house.source === "text" ? "Questions that would make this place more faithful. Answer them if you describe it again." : "Questions that would make this place more faithful. Ask them next time you talk."));
      for (const q of house.graph?.gaps ?? []) body.append(h("div", { class: "ask" }, h("b", {}, q.question_en), q.question_original ? h("p", { class: "orig" }, q.question_original) : null, h("small", {}, q.why)));
    } else {
      if (shownAttempt !== null) body.append(h("button", { class: "showing", onclick: () => void showAttempt(null) }, `Showing an earlier build. Back to the latest`));
      house.attempts.forEach((a, i) => {
        body.append(h("div", { class: `attempt${shownAttempt === i ? " on" : ""}` },
          h("b", {}, a.look ? "Rebuilt from Muse Spark's notes" : a.round === 0 ? "First build" : `Repair ${a.round}`),
          a.saved ? h("button", { class: "show", onclick: () => void showAttempt(i) }, shownAttempt === i ? "Shown" : "Show") : null,
          h("span", {}, ` ${a.passed} of ${a.total} checks pass · ${(a.ms / 1000).toFixed(0)} s · $${a.usd.toFixed(3)}`),
          a.error ? h("small", { class: "fail" }, a.error) : null,
          ...a.failed.slice(0, 6).map((f) => h("small", { class: "fail" }, `✗ ${f.text}`)),
        ));
      });
      if (house.look?.length) {
        body.append(h("h4", {}, "Looked at it and improved"), h("p", { class: "muted" }, "Muse Spark looked at renders of the build as an art director; Muse Wonder rebuilt it from these notes, and the new build was kept only if every check still passed."));
        for (const n of house.look) body.append(h("div", { class: "attempt" }, h("span", {}, n.problem), n.fix ? h("small", {}, `Fix: ${n.fix}`) : null));
      }
      body.prepend(h("p", {}, "Every version of this place, in order. A failing check goes back to the builder with the speaker's words, and a later version is kept only if no check gets worse."));
      body.append(h("p", { class: "muted" }, `Total model spend for this place: $${house.usd.toFixed(2)}`));
      if (house.program) body.append(h("details", {}, h("summary", {}, "The build program Muse Wonder wrote"), h("pre", {}, house.program)));
    }
    panel.replaceChildren(h("nav", {}, ...tabs.map(([k, label]) => h("button", { class: k === tab ? "on" : "", onclick: () => ((tab = k), renderPanel()) }, label))), body);
  }

  function renderHead() {
    if (!house) return;
    mcFilm.hidden = !(house as unknown as { mcVideo?: boolean }).mcVideo;
    moreBtn.hidden = !!(house as unknown as { public?: boolean }).public;
    saveLink.hidden = !!(house as unknown as { public?: boolean }).public;
    title.textContent = placeTitle(house.id, house.graph?.title) ?? (house.source === "live" ? "Tell me about a place" : house.blocks?.length ? "Preview" : "Listening");
    sub.textContent = [house.graph?.place, house.context].filter(Boolean).join(" · ");
    status.textContent = house.statusText || house.status;
    status.className = `status ${house.status}${house.status === "ready" && house.checks.some((c) => !c.pass) ? " partial" : ""}`;
    renderEmpty();
  }

  let lastVersion = -1;
  async function refresh(animate = true) {
    const r = await fetch(`/api/houses/${id}`);
    if (!r.ok) {
      title.textContent = "No such place";
      sub.replaceChildren(h("a", { href: "/", onclick: (e: Event) => (e.preventDefault(), go("/")) }, "See the places on the home page."));
      return renderEmpty();
    }
    house = (await r.json()) as House;
    renderHead();
    renderPanel();
    if (house.version !== lastVersion) {
      const first = lastVersion === -1;
      lastVersion = house.version;
      shownAttempt = null;
      viewer.setElements((house.graph?.elements ?? []).map((e) => ({ id: e.id, name: e.name, original: e.original, kind: e.kind, mentions: e.turns?.length ?? 1 })));
      const around = house.graph?.surroundings;
      viewer.setPlace(around === "forest" ? "forest" : around === "town" ? "town" : around === "fields" ? "village" : house.graph?.landmark ? "town" : "village", house.graph?.entrance ?? null);
      viewer.setBlocks(house.blocks, animate, house.blockM);
      renderEmpty();
      viewer.setFocus(focusOf());
      if (first || viewer.mode === "orbit") viewer.frameOverview();
    }
  }

  function listen() {
    const es = new EventSource(`/api/houses/${id}/events`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (house && ev.statusText !== undefined) {
        house.status = ev.status;
        house.statusText = ev.statusText;
        renderHead();
      }
      if (["turns", "graph", "attempt", "built"].includes(ev.type)) void refresh(true);
    };
  }

  // Render mode (used by the server to look at a build): no interface, one fixed view, then a ready signal.
  const renderView = new URLSearchParams(location.search).get("render") as "overview" | "entrance" | "plan" | "back" | null;
  if (renderView) {
    document.body.classList.add("render");
    viewer.setShowLabels(false);
    void (async () => {
      const r = await fetch(`/api/houses/${id}`);
      const x = (await r.json()) as House;
      viewer.setBlocks(x.blocks, false, x.blockM);
      viewer.view(renderView, x.graph?.entrance ?? null);
      await new Promise((ok) => setTimeout(ok, 700));
      document.title = "ready";
    })();
    return;
  }
  if (id === "new-live") return startLive();
  void refresh(true).then(() => {
    listen();
    if ((house as unknown as { source?: string } | null)?.source === "live") startLive(id);
  });

  // ------------------------------------------------ live
  function startLive(existing?: string) {
    const params = new URLSearchParams(location.search);
    const micBtn = h("button", { class: "mic" }, "Start talking");
    const meter = h("div", { class: "meter" }, h("i"));
    tools.prepend(micBtn, meter);
    title.textContent = "Tell me about a place";
    renderEmpty();
    sub.textContent = "Talk about a place you remember: how you came in, what was where. Pause between thoughts.";
    let mic: Mic | null = null;
    let ws: WebSocket | null = null;
    micBtn.onclick = async () => {
      if (mic) {
        mic.stop();
        mic = null;
        micOn = false;
        renderEmpty();
        ws?.send(JSON.stringify({ type: "end" }));
        micBtn.textContent = "Start talking";
        micBtn.classList.remove("live");
        return;
      }
      const q = new URLSearchParams({ context: params.get("context") ?? "", languages: params.get("languages") ?? "" });
      if (existing || id !== "new-live") q.set("house", existing ?? id);
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live?${q}`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.type === "house" && id === "new-live") {
          id = ev.id;
          history.replaceState(null, "", `/h/${id}`);
          void refresh(true).then(listen);
        } else if (ev.type === "partial") {
          ticker.hidden = false;
          ticker.textContent = ev.text;
        } else if (ev.type === "turn") {
          ticker.textContent = ev.turn.transcript;
          const q = house?.graph?.gaps?.[0];
          if (q) ticker.append(h("span", { class: "nextq" }, `Ask next: ${q.question_en}`), q.question_original ? h("span", { class: "orig" }, q.question_original) : "");
        } else if (ev.type === "error") {
          ticker.hidden = false;
          ticker.textContent = ev.message;
        }
      };
      ws.onclose = (e) => {
        if (mic) {
          mic.stop();
          mic = null;
          micOn = false;
          renderEmpty();
          micBtn.textContent = "Start talking";
          micBtn.classList.remove("live");
        }
        if (!e.reason) return;
        ticker.hidden = false;
        ticker.textContent = e.reason;
      };
      ws.onopen = async () => {
        try {
          const started = await startMic((pcm) => ws?.readyState === WebSocket.OPEN && ws.send(pcm));
          if (ws?.readyState !== WebSocket.OPEN) return void started.stop(); // the server said no while the microphone was starting
          mic = started;
          micOn = true;
          renderEmpty();
          micBtn.textContent = "Stop";
          micBtn.classList.add("live");
          const tick = () => {
            if (!mic) return;
            (meter.firstChild as HTMLElement).style.width = `${Math.min(100, mic.level() * 220)}%`;
            requestAnimationFrame(tick);
          };
          tick();
        } catch (e) {
          ticker.hidden = false;
          ticker.textContent = `Microphone: ${(e as Error).message}`;
        }
      };
    };
  }
}
