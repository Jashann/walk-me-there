// Microphone -> 24 kHz signed 16-bit mono PCM in 80 ms frames, the format Muse Voice Transcribe expects.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1920); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        const out = new Int16Array(this.buf.length);
        for (let j = 0; j < out.length; j++) { const s = Math.max(-1, Math.min(1, this.buf[j])); out[j] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("tap", Tap);
`;

export type Mic = { stop: () => void; level: () => number };

export async function startMic(onFrame: (pcm: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 24000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "tap");
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(tap);
  src.connect(analyser);
  tap.port.onmessage = (e) => onFrame(e.data as ArrayBuffer);
  const data = new Uint8Array(analyser.fftSize);
  return {
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
    level: () => {
      analyser.getByteTimeDomainData(data);
      let m = 0;
      for (const v of data) m = Math.max(m, Math.abs(v - 128));
      return m / 128;
    },
  };
}
