// Runs inside a separate Node process started with --permission and read access to this folder only:
// no network, no file writes, no subprocesses. Reads a build program on stdin, prints blocks as JSON.
import { runProgram } from "./world.ts";

let code = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (code += c));
process.stdin.on("end", () => {
  const run = runProgram(code, 6000);
  let error = run.error, list: ReturnType<typeof run.world.list> = [];
  try {
    list = run.world.visible();
  } catch (e) {
    error = String((e as Error).message ?? e);
  }
  const world = run.world;
  const blocks = list.map((b) => [b.x, b.y, b.z, b.m, b.t]);
  process.stdout.write(JSON.stringify({ blocks, error, warnings: world.warnings, blockM: world.s }));
});
