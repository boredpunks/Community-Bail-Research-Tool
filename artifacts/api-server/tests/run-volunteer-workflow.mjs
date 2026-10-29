import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(tmpdir(), "volunteer-workflow-"));
try {
  const out = path.join(dir, "checks.mjs");
  await build({ entryPoints: ["tests/volunteer-workflow.test.ts"], outfile: out, bundle: true, platform: "node", format: "esm" });
  const result = spawnSync("node", ["--test", out], { stdio: "inherit" });
  if (result.status) process.exitCode = result.status;
} finally { await rm(dir, { recursive: true, force: true }); }
