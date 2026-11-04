// From a recording to the house graph: Muse Voice Transcribe gives timed, speaker-labelled turns;
// Muse Spark translates non-English turns and maps what was said into the house graph.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chatJSON, transcribeWav, type Turn } from "./meta.ts";
import { GRAPH_SCHEMA, sanitizeGraph, type HouseGraph } from "./graph.ts";

// ffmpeg and ffprobe run without blocking, so a long upload does not freeze people walking through the gallery.
const exec = promisify(execFile);
const ffmpegOut = async (args: string[]) => (await exec("ffmpeg", args, { encoding: "buffer", maxBuffer: 1 << 30 })).stdout as unknown as Buffer;

export const SPARK = process.env.SPARK_MODEL ?? "muse-spark-1.3";

// Words that come up when people describe old Punjabi village homes, to bias recognition.
export const HOUSE_WORDS = ["vehra", "nalka", "chulha", "chaunka", "manji", "kotha", "kothri", "dalan", "darwaza", "deodi", "chaubara", "bhadola", "tandoor", "pipal", "nimm", "kikkar", "toori", "khurli", "haveli", "baithak", "parchhatti", "mamti", "chhat", "pasar", "galli"];

export type SaidTurn = Turn & { english: string; original: string; romanized: string | null; file?: string };

// Any audio file -> mono 16-bit 24 kHz WAV chunks of at most 9.5 minutes (the endpoint takes 10).
export async function toWavChunks(path: string): Promise<Buffer[]> {
  const durS = Number((await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])).stdout.toString().trim());
  const chunk = 570;
  const out: Buffer[] = [];
  for (let s = 0; s < durS; s += chunk) {
    out.push(await ffmpegOut(["-v", "error", "-ss", String(s), "-t", String(chunk), "-i", path, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-f", "wav", "pipe:1"]));
  }
  return out;
}

export async function transcribeFile(path: string, opts: { languageBias?: string[] } = {}): Promise<Turn[]> {
  const turns: Turn[] = [];
  let offset = 0;
  for (const wav of await toWavChunks(path)) {
    const r = await transcribeWav(wav, { mode: "DIARIZATION", languageBias: opts.languageBias, keywords: HOUSE_WORDS });
    for (const t of r.turns) turns.push({ ...t, startMs: t.startMs + offset, endMs: t.endMs + offset });
    if (!r.turns.length && r.transcript.trim()) turns.push({ turnId: 0, startMs: offset, endMs: offset + r.audioDurationMs, transcript: r.transcript, speaker: "A" });
    offset += r.audioDurationMs;
  }
  // One person talking for a minute comes back as one turn; split long turns at the speaker's pauses so
  // each line keeps its own words and its own few seconds of audio.
  const out: Turn[] = [];
  for (const t of turns) {
    if (t.endMs - t.startMs <= LONG_TURN_MS) { out.push(t); continue; }
    const parts = await splitTurn(path, t, opts);
    out.push(...(parts.length ? parts : [t]));
  }
  return out.map((t, i) => ({ ...t, turnId: i + 1 }));
}

const LONG_TURN_MS = 14000;

// Pauses (start and end, in seconds) between fromS and toS.
async function silences(path: string, fromS: number, toS: number) {
  const log = await new Promise<string>((resolve) => {
    const c = spawn("ffmpeg", ["-v", "info", "-ss", String(fromS), "-t", String(toS - fromS), "-i", path, "-af", "silencedetect=noise=-32dB:d=0.25", "-f", "null", "-"]);
    let err = "";
    c.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    c.on("close", () => resolve(err));
    c.on("error", () => resolve(err));
  });
  const out: { a: number; b: number }[] = [];
  for (const m of log.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)) {
    const b = fromS + Number(m[1]);
    out.push({ a: b - Number(m[2]), b });
  }
  return out;
}

// Cut at the longest pauses first, never leaving a piece under 2 s, until pieces average about 6 s and none
// is over 12 s (or no pause is left to cut at).
export function cutPoints(fromS: number, toS: number, gaps: { a: number; b: number }[]): number[] {
  const cuts: number[] = [];
  const pieces = () => { const p = [fromS, ...cuts.sort((x, y) => x - y), toS]; return p.slice(1).map((e, i) => e - p[i]); };
  for (const g of [...gaps].sort((x, y) => (y.b - y.a) - (x.b - x.a))) {
    const lens = pieces();
    if (lens.length >= (toS - fromS) / 6 && Math.max(...lens) <= 12) break;
    const at = (g.a + g.b) / 2;
    const p = [fromS, ...cuts, toS].sort((x, y) => x - y);
    const i = p.findIndex((x) => x > at);
    if (at - p[i - 1] < 2 || p[i] - at < 2) continue;
    cuts.push(at);
  }
  return cuts.sort((x, y) => x - y);
}

async function splitTurn(path: string, t: Turn, opts: { languageBias?: string[] }): Promise<Turn[]> {
  const fromS = t.startMs / 1000, toS = t.endMs / 1000;
  const p = [fromS, ...cutPoints(fromS, toS, await silences(path, fromS, toS)), toS];
  const pieces = p.slice(1).map((e, i) => ({ s: p[i], e }));
  const heard = await Promise.all(pieces.map(async ({ s, e }) => {
    const wav = await ffmpegOut(["-v", "error", "-ss", String(s), "-t", String(e - s), "-i", path, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-f", "wav", "pipe:1"]);
    const r = await transcribeWav(wav, { mode: "ENDPOINTING", languageBias: opts.languageBias, keywords: HOUSE_WORDS });
    return { s, e, text: (r.transcript || r.turns.map((x) => x.transcript).join(" ")).trim() };
  }));
  return heard.filter((x) => x.text).map((x) => ({ turnId: 0, startMs: Math.round(x.s * 1000), endMs: Math.round(x.e * 1000), transcript: x.text, speaker: t.speaker }));
}

// Latin letters alone are not enough (Spanish, French, romanized Punjabi): also want common English words.
const EN_WORDS = new Set("the and was there with on in of a to it is we our my at from by had were".split(" "));
const looksEnglish = (s: string) => {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (!letters.length || letters.replace(/[A-Za-z]/g, "").length / letters.length >= 0.1) return false;
  const words = s.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.filter((w) => EN_WORDS.has(w)).length / Math.max(words.length, 1) >= 0.15;
};

const TRANSLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["turnId", "english", "romanized", "gurmukhi"],
        properties: { turnId: { type: "integer" }, english: { type: "string" }, romanized: { type: "string" }, gurmukhi: { type: "string" } },
      },
    },
  },
};

// Speech recognition writes Punjabi phonetically in Devanagari; turn it into faithful English,
// a romanized line and Gurmukhi, one row per turn so every quote keeps its timestamp.
export async function translateTurns(turns: Turn[], context: string): Promise<SaidTurn[]> {
  if (turns.every((t) => looksEnglish(t.transcript))) return turns.map((t) => ({ ...t, english: t.transcript, original: t.transcript, romanized: null }));
  const out = new Map<number, { english: string; romanized: string; gurmukhi: string }>();
  for (let i = 0; i < turns.length; i += 40) {
    const batch = turns.slice(i, i + 40);
    const { data } = await chatJSON<{ turns: { turnId: number; english: string; romanized: string; gurmukhi: string }[] }>({
      model: SPARK,
      effort: "low",
      tag: "translate",
      schema: { name: "translation", schema: TRANSLATE_SCHEMA },
      messages: [
        {
          role: "system",
          content:
            "You translate someone describing a place they remember. It may be in any language; often it is Punjabi (mixed with Hindi, Urdu and English), and then the speech recognizer wrote the Punjabi phonetically in Devanagari script, sometimes with errors. First work out the language actually spoken. For each turn give: a faithful English translation (keep the speaker's own words for places and things in brackets after the English, e.g. 'courtyard (vehra)', 'public bath (sento)'; do not add anything that was not said; if a phrase is unclear write [unclear]), the turn romanized in plain Latin letters, and the turn written in that language's own script in the field named gurmukhi (Gurmukhi for Punjabi, Devanagari for Hindi, Japanese script for Japanese, the Latin original for Spanish or French, and so on; never write a non-Punjabi language in Gurmukhi). Keep every turnId. In an old village home these words mean: nalka = hand pump (not a tap), chulha = clay stove, tandoor = clay oven, manja or manji = woven string cot, vehra = courtyard, paudi or pauri = ladder (a wooden ladder, not a staircase, unless they say steps were built), kotha = room, chhat = flat roof, kandh = wall, deodi = covered entrance.",
        },
        { role: "user", content: `${context ? `Context: ${context}\n\n` : ""}${batch.map((t) => `[${t.turnId}] (${t.speaker ?? "?"}) ${t.transcript}`).join("\n")}` },
      ],
    });
    for (const r of data.turns) out.set(r.turnId, r);
  }
  return turns.map((t) => {
    const r = out.get(t.turnId);
    return { ...t, english: r?.english ?? t.transcript, original: r?.gurmukhi || t.transcript, romanized: r?.romanized ?? null };
  });
}

export const MAP_RULES = `You turn a spoken description of a home into a house graph. The graph is the only thing a builder will see, and code will check the build against it: everything that was said must be in it, and nothing that was not.

Rules
- Include every physical thing the speaker says was there, however small: rooms and yards, but also objects (a TV, a trunk, boots by the door, icons in a corner, a gas bottle, a mosquito net) and parts of the building they describe (a raised plinth, posts under the house, a tin roof, ceiling beams, a railing, a little roof over the stove, an opening with no gate). Each becomes its own element.
- Leave out people, food, clothing being worn, and things the speaker says were not there.
- When the speaker corrects themselves ("on the right... no, the left", "water... no, lava"), keep only the correction: the last version they settle on. A correction is not a denial.
- Never add a room, object, size, material or position that was not said or clearly implied by the words. If a position is uncertain, leave that relation out and put the uncertainty in "detail".
- Every element and relation lists the turn ids that support it. Use only turn ids from the transcript.
- ids are short snake_case and unique (gate, courtyard, nani_room, hand_pump, neem_tree).
- "original" is the speaker's own word for it, romanized (vehra, nalka, chulha), or null.
- Relations use the frame of someone standing at the entrance looking in. Record every position word as a relation:
  - "on the left as you come in", "on the left side of the courtyard" -> left_of the courtyard (and also inside the courtyard if it is in it); same for right_of.
  - "at the back of the courtyard" -> behind the courtyard's front part: use behind relative to the entrance or to things nearer the gate.
  - "near the gate", "at the front" -> next_to the gate, or in_front_of what is further in.
  - "side by side" with "the one on the right was X" -> X right_of the other. Use north_of etc. only when the speaker used compass directions, and set entrance_faces only if they said which way the gate or door faces.
- Convert spoken sizes to metres when they are given ("ten feet" = 3.0, "two cots long" is about 4.0, "big" is not a size). Put the spoken words in size.phrase.
- material: pick the closest from the list; use "unspecified" if nothing was said about it.
- level: "roof" for things on the flat roof, "upper" for an upper storey, otherwise "ground".
- entrance: the id of the gate or door you enter through, if one was described.
- gaps: the 3 most useful questions to ask the speaker next, the ones whose answers would let the house be built more faithfully (where a door is, which side something is on, how big a room was). Write each in simple English and, if the speaker spoke Punjabi, also in simple Punjabi in Gurmukhi (question_original). Ask about things they mentioned, never introduce new objects.
- title: a short name for the place in the speaker's terms ("Nani's house in the village", "The Golden Temple when I was twelve").
- landmark: if the place is a real, well-known site (a temple, gurdwara, mosque, fort, palace, monument, famous market), its proper name and city ("Harmandir Sahib, Amritsar"); otherwise null. Homes are never landmarks.
- surroundings: what lies around the place, as the speaker describes it or as the real place is: "fields" (a village among farmland), "town" (streets and houses close around), "forest" (wooded hills or a garden in the woods, as round many temples in Japan), or null if you cannot tell. For a real landmark you know, always choose from what the real place is like (the Golden Pavilion in Kyoto: "forest"; the Golden Temple in Amritsar: "town").`;

export async function mapHouse(said: SaidTurn[], prior?: HouseGraph): Promise<{ graph: HouseGraph; dropped: string[]; usd: number }> {
  const lines = said.map((t) => `[${t.turnId}] (${t.speaker ?? "?"}) ${t.english}${t.romanized ? `  || ${t.romanized}` : ""}`).join("\n");
  const r = await chatJSON<HouseGraph>({
    model: SPARK,
    effort: "medium",
    tag: "map",
    maxTokens: 32000,
    schema: { name: "house_graph", schema: GRAPH_SCHEMA },
    messages: [
      { role: "system", content: MAP_RULES },
      { role: "user", content: `${prior ? `Graph so far (keep its ids for the same things, extend or correct it with the new turns):\n${JSON.stringify(prior)}\n\n` : ""}Transcript:\n${lines}` },
    ],
  });
  const { graph, dropped } = sanitizeGraph(r.data, new Set(said.map((t) => t.turnId)));
  return { graph, dropped, usd: r.usd };
}
