import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "court-offline-safety-"));
try {
  const out = path.join(dir, "checks.mjs");
  await build({
    entryPoints: ["tests/safety.ts"], outfile: out, bundle: true, platform: "node", format: "esm",
    external: ["pg-native"], logLevel: "warning",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const check = spawnSync("node", [out], { stdio: "inherit" });
  if (check.status) process.exitCode = check.status;
  const python = spawnSync("python", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_protocol.py"], { stdio: "inherit" });
  if (python.status) process.exitCode = python.status;
} finally { await rm(dir, { recursive: true, force: true }); }
