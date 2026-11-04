// Live mode: the browser streams microphone PCM to us, we relay it to Muse Voice Transcribe realtime,
// and every completed turn grows the house. The raw audio is kept so each block can replay its words.
import WebSocket from "ws";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { apiKey } from "./meta.ts";
import { HOUSE_WORDS } from "./listen.ts";
import { addLiveTurn, dir, save, type House } from "./houses.ts";

const RT = "wss://api.meta.ai/v1/asr/realtime";
export const LIVE_RATE = 24000;

export function relay(client: WebSocket, h: House, opts: { languageBias?: string[] }) {
  mkdirSync(dir(h.id), { recursive: true });
  const pcmPath = join(dir(h.id), "live.pcm");
  h.audioFile = "live.pcm";
  save(h);
  const upstream = new WebSocket(`${RT}?sessionId=wmt-${h.id}-${Date.now()}`);
  let ready = false;
  const queue: Buffer[] = [];
  const speakers = new Map<number, string>();
  const starts = new Map<number, number>();
  let currentTurn = 0;
  let turnBase = h.turns.reduce((m, t) => Math.max(m, t.turnId), 0);
  let audioBaseMs = 0; // audio already recorded before this session, so timestamps line up in live.pcm
  try {
    audioBaseMs = Math.floor((statSync(pcmPath).size / 2 / LIVE_RATE) * 1000);
  } catch {}

  const send = (o: unknown) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(o));

  upstream.on("open", () => {
    let key: string;
    try { key = apiKey(); } catch (e) {
      send({ type: "error", message: String((e as Error).message) });
      return void upstream.close();
    }
    const hs: Record<string, unknown> = {
      authorization: { accessToken: `Bearer ${key}` },
      audioEncoding: "PCM_24KHZ",
      model: "muse-voice-transcribe-1.0",
      mode: "ENDPOINTING", // one turn per utterance, so the house grows sentence by sentence
      partialMode: "CUMULATIVE",
      emitAudioProgress: false,
      keywords: HOUSE_WORDS,
    };
    if (opts.languageBias?.length) hs.languageBias = opts.languageBias;
    upstream.send(JSON.stringify(hs));
  });

  upstream.on("message", (raw, isBinary) => {
    if (isBinary) return;
    let ev;
    try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (!ready) {
      if (ev.sessionId && !ev.type) {
        ready = true;
        for (const b of queue.splice(0)) upstream.send(b);
        send({ type: "ready" });
      } else send({ type: "error", message: ev.message ?? "Could not start live transcription" });
      return;
    }
    switch (ev.type) {
      case "speechStart":
        currentTurn = ev.turnId;
        starts.set(ev.turnId, ev.audioProcessedMs ?? 0);
        break;
      case "speaker":
        speakers.set(currentTurn, ev.label);
        break;
      case "transcript":
        send({ type: "partial", text: ev.transcript });
        break;
      case "speechComplete": {
        const text = String(ev.transcript ?? "").trim();
        if (!text) break;
        const turn = {
          turnId: turnBase + ev.turnId + 1,
          startMs: audioBaseMs + (starts.get(ev.turnId) ?? 0),
          endMs: audioBaseMs + (ev.audioProcessedMs ?? 0),
          transcript: text,
          speaker: speakers.get(ev.turnId) ?? "A",
          english: "",
          original: text,
          romanized: null,
        };
        send({ type: "turn", turn });
        void addLiveTurn(h, turn);
        break;
      }
      case "error":
        send({ type: "error", message: ev.message });
        break;
    }
  });

  upstream.on("close", (code) => send({ type: "closed", code }));
  upstream.on("error", (e) => send({ type: "error", message: String(e.message) }));

  client.on("message", (data, isBinary) => {
    if (!isBinary) {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.type === "end" && upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: "endStream" }));
      return;
    }
    const buf = data as Buffer;
    appendFileSync(pcmPath, buf);
    if (ready && upstream.readyState === WebSocket.OPEN) upstream.send(buf);
    else queue.push(buf);
  });
  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: "endStream" }));
    setTimeout(() => upstream.close(), 15000);
  });
}

// live.pcm -> a WAV header so the browser can play and seek it.
export function wavHeader(dataBytes: number, rate = LIVE_RATE) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataBytes, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}
