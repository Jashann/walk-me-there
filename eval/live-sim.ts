// Streams a raw 24 kHz PCM file to the live socket at real-time pace, as a browser microphone would.
import WebSocket from "ws";
import { readFileSync } from "node:fs";

const pcm = readFileSync(process.argv[2]);
const ws = new WebSocket(`ws://localhost:8787/api/live?context=${encodeURIComponent(process.argv[3] ?? "")}`);
const FRAME = 3840; // 80 ms of 16-bit audio at 24 kHz
let house = "";
ws.on("message", (m) => {
  const ev = JSON.parse(m.toString());
  if (ev.type === "house") house = ev.id;
  if (ev.type === "partial") return;
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(ev).slice(0, 200));
});
ws.on("open", async () => {
  for (let i = 0; i < pcm.length; i += FRAME) {
    ws.send(pcm.subarray(i, i + FRAME));
    await new Promise((r) => setTimeout(r, 80));
  }
  // trailing silence so the last turn completes
  for (let i = 0; i < 30; i++) { ws.send(Buffer.alloc(FRAME)); await new Promise((r) => setTimeout(r, 80)); }
  ws.send(JSON.stringify({ type: "end" }));
  setTimeout(() => { console.log("house", house); ws.close(); process.exit(0); }, 4000);
});
