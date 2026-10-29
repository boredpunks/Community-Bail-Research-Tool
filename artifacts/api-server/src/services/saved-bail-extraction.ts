import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { BailDecisionEvidence, DiscoveryProvenanceData } from "@workspace/db";

export function savedEntries(provenance: DiscoveryProvenanceData): BailDecisionEvidence[] | null {
  if (provenance.extractionOutcome !== "EXTRACTED") return null;
  return provenance.entries.map(entry => {
    const percentage = entry.percentageCondition?.match(/(\d+(?:\.\d+)?)\s*%/);
    return {
      date: entry.orderDate ?? "",
      classification: ["MONETARY", "NOMINAL", "UNSECURED", "NONMONETARY", "RECOGNIZANCE", "DENIED"].includes(entry.bailCategory)
        ? entry.bailCategory === "RECOGNIZANCE" ? "nonmonetary" : entry.bailCategory.toLowerCase() : "unknown",
      amount: entry.amountCents === null ? null : entry.amountCents / 100,
      percentage: percentage ? Number(percentage[1]) : null,
      page: entry.sourcePages?.[0] ?? null,
      quote: entry.excerpt ?? entry.wording,
    };
  });
}

/** Reuse the proven Python parser in cache-only mode, with bounded subprocess I/O. */
export function extractSavedBail(docketNumber: string, sourceUrl: string): Promise<BailDecisionEvidence[]> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = [process.cwd(), path.resolve(process.cwd(), "../..")]
    .find(candidate => existsSync(path.join(candidate, "scripts/prove-end-to-end.py")));
  const script = [path.join(moduleDir, "search/prove-end-to-end.py"),
    ...(root ? [path.join(root, "scripts/prove-end-to-end.py")] : [])].find(existsSync);
  if (!script) return Promise.reject(new Error("Saved PDF parser is unavailable."));
  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-u", script, "--cached-json"],
      { cwd: root ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let output = "", exceeded = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.on("data", data => {
      output += data.toString();
      if (output.length > 256_000) { exceeded = true; child.kill("SIGKILL"); }
    });
    child.stderr.resume(); // Never log source text, URLs, or parser diagnostics.
    child.on("error", () => { clearTimeout(timeout); reject(new Error("Saved PDF parser could not start.")); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0 || exceeded) return reject(new Error("Saved PDF could not be validated."));
      try {
        const parsed = JSON.parse(output);
        if (parsed.error) return reject(new Error("Evidence is not locally available. No source request was made."));
        if (!Array.isArray(parsed.entries) || parsed.http_requests !== 0) throw new Error();
        resolve(parsed.entries);
      } catch { reject(new Error("Saved PDF parser returned invalid evidence.")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ docket_number: docketNumber, sourceUrl }));
  });
}
