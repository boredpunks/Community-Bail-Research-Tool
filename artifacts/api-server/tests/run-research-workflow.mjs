import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(tmpdir(), "research-workflow-"));
try {
  const out = path.join(dir,"checks.mjs");
  await build({entryPoints:["tests/research-workflow.ts"],outfile:out,bundle:true,platform:"node",format:"esm",external:["pg-native"],
    banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"}});
  const result = spawnSync("node",[out],{stdio:"inherit"});
  if(result.status) process.exitCode=result.status;
} finally { await rm(dir,{recursive:true,force:true}); }
