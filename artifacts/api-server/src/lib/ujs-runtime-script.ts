import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UjsRuntimeScript = "worker.py" | "network_sandbox.py";

export function ujsRuntimeScriptCandidates(moduleUrl: string, script: UjsRuntimeScript): string[] {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  return [
    path.resolve(moduleDirectory, "ujs", script),
    path.resolve(moduleDirectory, "..", "ujs", script),
  ];
}

export function resolveUjsRuntimeScript(moduleUrl: string, script: UjsRuntimeScript): string {
  const resolved = ujsRuntimeScriptCandidates(moduleUrl, script).find(existsSync);
  if (!resolved) throw new Error(`Required UJS runtime script is unavailable: ${script}`);
  return resolved;
}
