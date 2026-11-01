import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = await mkdtemp(path.join(process.cwd(), "tests/.clear-search-history-"));
try {
  const out = path.join(dir, "clear-search-history.mjs");
  await build({
    entryPoints: ["tests/clear-search-history.test.ts"],
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
