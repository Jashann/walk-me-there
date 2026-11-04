// The build program comes from a model, so the sandbox must hold even when the program tries to break out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSandboxed } from "../server/sandbox.ts";

const escape = 'const proc = Math.constructor.constructor("return process")();';

test("a normal program builds", async () => {
  const r = await runSandboxed(`box(0, 0, 0, 1, 1, 1, "stone", "x");`);
  assert.equal(r.error, null);
  assert.ok(r.blocks.length > 0);
});

test("an escaped program sees no API key in its environment", async () => {
  process.env.MODEL_API_KEY = "must-not-leak";
  // The operating system may add its own variable (macOS does); nothing of ours may be there.
  const r = await runSandboxed(`${escape} const k = Object.keys(proc.env).filter((x) => x !== "__CF_USER_TEXT_ENCODING"); if (k.length || proc.env.MODEL_API_KEY) throw new Error("env:" + k);`);
  assert.equal(r.error, null);
});

test("an escaped program cannot write files or start processes", async () => {
  const write = await runSandboxed(`${escape} proc.getBuiltinModule("node:fs").writeFileSync("/tmp/wmt-sandbox-test", "x");`);
  assert.match(String(write.error), /ERR_ACCESS_DENIED|permission|denied/i);
  const run = await runSandboxed(`${escape} proc.getBuiltinModule("node:child_process").execSync("id");`);
  assert.match(String(run.error), /ERR_ACCESS_DENIED|permission|denied/i);
});

test("a program that never ends is killed", async () => {
  const t0 = Date.now();
  const r = await runSandboxed("while (true) {}", 1500);
  assert.ok(r.error);
  assert.ok(Date.now() - t0 < 10000);
});

test("a program that prints without end is stopped", async () => {
  const r = await runSandboxed(`${escape} const big = "x".repeat(1 << 20); while (true) proc.stdout.write(big);`, 20000);
  assert.ok(r.error);
});
