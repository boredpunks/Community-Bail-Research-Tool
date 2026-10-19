import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function inspectLocalPdf(body: Buffer, expected = ""): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-u", path.join(path.dirname(fileURLToPath(import.meta.url)), "ujs/local_document.py"), expected],
      { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.on("data", data => {
      output += data.toString();
      if (output.length > 128_000) { overflow = true; child.kill("SIGKILL"); }
    });
    // Parser stderr may contain source text; never log it.
    child.stderr.resume();
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || overflow) return reject(new Error("Local PDF could not be verified. Check the expected docket, readable Allegheny header, page count and file size."));
      try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid local extraction result.")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(body);
  });
}
