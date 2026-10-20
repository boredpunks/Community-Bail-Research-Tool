import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "court-offline-safety-"));
try {
  const packaged = spawnSync("node", ["build.mjs"], { stdio: "inherit" });
  if (packaged.status !== 0) throw new Error("Cannot test an unverified worker package.");
  const out = path.join(dir, "checks.mjs");
  await build({
    entryPoints: ["tests/safety.ts"], outfile: out, bundle: true, platform: "node", format: "esm",
    external: ["pg-native"], logLevel: "warning", sourcemap: "inline",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const check = spawnSync("node", ["--enable-source-maps", out], { stdio: "inherit" });
  if (check.status) process.exitCode = check.status;
  const capture = path.join(dir, "calendar-diagnostics.jsonl");
  // Keep the full suite as the default, but allow one named offline regression
  // to use the same real-worker → parent-validator harness.
  const target = process.env.CALENDAR_PYTHON_TEST_TARGET;
  if (target && !/^test_[a-z0-9_]+\.[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*$/.test(target))
    throw new Error("Invalid CALENDAR_PYTHON_TEST_TARGET.");
  const pythonArgs = target ? ["-m", "unittest", target]
    : ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"];
  const python = spawnSync("python", pythonArgs, {
    stdio: "inherit", env: {
      ...process.env,
      PYTHONPATH: [path.resolve("tests"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      CALENDAR_DIAGNOSTIC_CAPTURE: capture,
    },
  });
  if (python.status) process.exitCode = python.status;
  const wire = path.join(dir, "wire.mjs");
  await build({
    stdin: { contents: `
      import { readFileSync } from "node:fs";
      import { validCalendarResponseDiagnostic } from "./src/lib/calendar-response-diagnostics";
      const lines = readFileSync(process.argv[2], "utf8").trim().split("\\n").filter(Boolean);
      if (!lines.length) throw new Error("No actual-worker response diagnostic captured.");
      for (const line of lines) {
        const value = JSON.parse(line);
        if (!validCalendarResponseDiagnostic(value)) throw new Error("Parent rejected an actual-worker diagnostic.");
        if (["REDACTION_SENTINEL", "private-fixture", "invalid.test", "https:", "http:", "?token"]
            .some(value => line.includes(value)))
          throw new Error("Unsafe content in actual-worker diagnostic.");
      }
      console.log("PASS: parent accepted " + lines.length + " actual calendar worker diagnostics, including pre-transmission; redaction checked.");
    `, resolveDir: process.cwd(), sourcefile: "wire-check.ts" },
    outfile: wire, bundle: true, platform: "node", format: "esm",
  });
  const wireCheck = spawnSync("node", [wire, capture], { stdio: "inherit" });
  if (wireCheck.status) process.exitCode = wireCheck.status;
} finally { await rm(dir, { recursive: true, force: true }); }
