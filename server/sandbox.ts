// Build programs come from a model that hears strangers' words, so they never run in the server process.
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import type { Block } from "./world.ts";
import type { Material } from "./graph.ts";

const HERE = realpathSync(dirname(fileURLToPath(import.meta.url)));

export type BuildRun = { blocks: Block[]; error: string | null; warnings: string[]; ms: number; blockM: number };

export function runSandboxed(code: string, timeoutMs = 20000): Promise<BuildRun> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${HERE}/`, "--max-old-space-size=2000", `${HERE}/sandbox-child.ts`], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {},
    });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    // A program that prints without end must not fill the server's memory.
    const limit = () => { if (out.length + err.length > 128e6) child.kill("SIGKILL"); };
    child.stdout.setEncoding("utf8").on("data", (c) => { out += c; limit(); });
    child.stderr.setEncoding("utf8").on("data", (c) => { err += c; limit(); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { blocks: [number, number, number, Material, string][]; error: string | null; warnings: string[]; blockM: number };
        resolve({ blocks: j.blocks.map(([x, y, z, m, t]) => ({ x, y, z, m, t })), error: j.error, warnings: j.warnings, ms: Date.now() - t0, blockM: j.blockM === 0.5 ? 0.5 : 0.25});
      } catch {
        resolve({ blocks: [], error: (err.split("\n").find((l) => /Error/.test(l)) ?? "the build program crashed or ran too long").slice(0, 400), warnings: [], ms: Date.now() - t0, blockM: 0.25 });
      }
    });
    child.stdin.end(code);
  });
}
