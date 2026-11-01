import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = await mkdtemp(path.join(process.cwd(), "tests/.live-search-pdf-"));
try {
  const out = path.join(dir, "live-search-pdf.mjs");
  await build({
    entryPoints: ["tests/live-search-pdf.test.ts"],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["pg-native", "pino", "pino-http", "pino-pretty", "thread-stream"],
    banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" },
  });
  const result = spawnSync("node", [out], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  });
  if (result.status) process.exitCode = result.status;
} finally {
  await rm(dir, { recursive: true, force: true });
}
