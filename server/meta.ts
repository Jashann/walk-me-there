// Thin client for Meta Model API: chat completions (streamed), file transcription,
// and a spend ledger with a hard cap so a runaway loop cannot drain the credit.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const BASE = "https://api.meta.ai/v1";
const DATA = join(import.meta.dirname, "..", "data");
const LEDGER = join(DATA, "ledger.jsonl");

export function apiKey(): string {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY.trim();
  const p = join(homedir(), ".meta_api_key");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("Set MODEL_API_KEY or put the key in ~/.meta_api_key");
}

// USD per 1M tokens: [input, cached input, output]
const PRICES: Record<string, [number, number, number]> = {
  "muse-wonder-1.0": [4, 0.2, 20],
  "muse-spark-1.3": [1.25, 0.15, 4.25],
  "muse-spark-1.2": [1.25, 0.15, 4.25],
  "muse-spark-1.1": [1.25, 0.15, 4.25],
};
const VOICE_PER_HOUR = 0.18;
const CAP = Number(process.env.MAX_SPEND_USD ?? 100);

let spentCache: number | null = null;
export function spent(): number {
  if (spentCache !== null) return spentCache;
  spentCache = 0;
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (line.trim()) spentCache += JSON.parse(line).usd ?? 0;
    }
  }
  return spentCache;
}

// Spend attributed to whatever is running (one house's build), even when several run at once.
export const spendScope = new AsyncLocalStorage<{ usd: number }>();

export function record(entry: Record<string, unknown> & { usd: number }) {
  mkdirSync(DATA, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  spentCache = spent() + entry.usd;
  const scope = spendScope.getStore();
  if (scope) scope.usd += entry.usd;
}

function guard() {
  if (spent() >= CAP) throw new Error(`Spend cap reached ($${spent().toFixed(2)} of $${CAP}). Raise MAX_SPEND_USD to continue.`);
}

export type Usage = { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return ((u.prompt_tokens - cached) * p[0] + cached * p[1] + u.completion_tokens * p[2]) / 1e6;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatPart[] };

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  schema?: { name: string; schema: object };
  tag: string; // what this call is for, kept in the ledger
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

export type ChatResult = { text: string; usage: Usage; usd: number; ms: number };

// Streams by default: long non-streamed requests hit a server time limit.
export async function chat(o: ChatOptions): Promise<ChatResult> {
  guard();
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: o.maxTokens ?? 16000,
  };
  if (o.effort) body.reasoning_effort = o.effort;
  if (o.schema) body.response_format = { type: "json_schema", json_schema: { name: o.schema.name, schema: o.schema.schema, strict: true } };

  const t0 = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: o.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status} ${await res.text()}`);
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${o.model} ${res.status}: ${(await res.text()).slice(0, 600)}`);
      let text = "";
      let usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
      for await (const ev of sse(res)) {
        if (ev === "[DONE]") break;
        const j = JSON.parse(ev);
        if (j.error) throw new Error(`${o.model} stream error: ${JSON.stringify(j.error).slice(0, 400)}`);
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          text += d;
          o.onDelta?.(d);
        }
        if (j.usage) usage = j.usage;
      }
      const usd = costOf(o.model, usage);
      record({ kind: "chat", model: o.model, tag: o.tag, usd, in: usage.prompt_tokens, out: usage.completion_tokens, ms: Date.now() - t0 });
      return { text, usage, usd, ms: Date.now() - t0 };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastErr = e;
      if (String(e).includes(" 4") && !String(e).includes(" 429")) throw e;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

// Structured output is schema-valid unless the output hits the token limit (reasoning counts toward it);
// on a cut-off answer, try once more with twice the room.
export async function chatJSON<T>(o: ChatOptions & { schema: { name: string; schema: object } }): Promise<{ data: T } & ChatResult> {
  const r = await chat(o);
  try {
    return { ...r, data: JSON.parse(stripFence(r.text)) as T };
  } catch {
    const again = await chat({ ...o, maxTokens: (o.maxTokens ?? 16000) * 2, tag: `${o.tag}:retry` });
    return { ...again, usd: r.usd + again.usd, data: JSON.parse(stripFence(again.text)) as T };
  }
}

export function stripFence(s: string): string {
  const m = s.match(/```(?:json|javascript|js|ts)?\s*\n([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

async function* sse(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

export type Turn = { turnId: number; startMs: number; endMs: number; transcript: string; speaker?: string };
export type Transcription = { sessionId: string; transcript: string; audioDurationMs: number; turns: Turn[] };

// Muse Voice Transcribe, file endpoint. WAV mono 16-bit, 16 or 24 kHz, at most 10 minutes.
export async function transcribeWav(wav: Buffer, opts: { mode?: "ENDPOINTING" | "DIARIZATION"; languageBias?: string[]; keywords?: string[] } = {}): Promise<Transcription> {
  guard();
  const request: Record<string, unknown> = { model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: opts.mode ?? "DIARIZATION" };
  if (opts.languageBias?.length) request.languageBias = opts.languageBias;
  if (opts.keywords?.length) request.keywords = opts.keywords;
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" }, body: form });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const out = (await res.json()) as Transcription;
  const usd = (Math.floor(out.audioDurationMs / 1000) / 3600) * VOICE_PER_HOUR;
  record({ kind: "asr", model: "muse-voice-transcribe-1.0", tag: "transcribe", usd, audioMs: out.audioDurationMs, ms: Date.now() - t0 });
  return out;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
