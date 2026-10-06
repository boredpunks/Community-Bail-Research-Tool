/**
 * Operator-only, single-use assessment. Stop the managed API workflow first;
 * this command takes its same advisory lease and calls its same request grant.
 * Requires explicit user approval for the supplied job's next request count.
 * Never clears the source pause, enables an adapter, or saves/reviews a record.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { db, pool, discoveryItemsTable, discoveryJobsTable, type DiscoveryEntryData } from "@workspace/db";
import { grant, sourceOutcome } from "../lib/discovery-worker";
import { discoveryEvent, discoveryPolicy } from "../lib/discovery";

async function main() {
  const [jobId, expectedRaw, approval] = process.argv.slice(2);
  const expected = Number(expectedRaw);
  if (!jobId || !Number.isSafeInteger(expected) || expected < 0 || approval !== "--approved-one-request") {
    throw new Error("Specify job UUID, expected consumed count, and --approved-one-request after obtaining approval.");
  }
  const lease = await pool.connect();
  let acquired = false;
  try {
    acquired = (await lease.query("SELECT pg_try_advisory_lock(74651283) AS acquired")).rows[0]?.acquired === true;
    if (!acquired) throw new Error("The application worker is running; no assessment request was made.");
    const [job] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, jobId));
    if (!job || job.status !== "PAUSED" || !job.calendarComplete || job.requestsUsed !== expected) {
      throw new Error("Paused calendar checkpoint/counter does not match. No request was made.");
    }
    const items = await db.select().from(discoveryItemsTable).where(and(
      eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.ownerId, job.ownerId),
    )).orderBy(asc(discoveryItemsTable.position));
    if (items.filter((item) => item.provenance.extractionOutcome !== "UNPROCESSED").length >= job.criteria.recordCap) {
      throw new Error("Original record cap is exhausted.");
    }
    const item = items.find((row) => row.provenance.extractionOutcome === "UNPROCESSED");
    if (!item) throw new Error("No unprocessed result-linked docket is available; original evidence will not be overwritten.");
    await discoveryEvent(job, "ASSESSMENT", "User approved one standard public HTTP docket download. Source-wide pause remains; original budgets and prior denial retained.");
    const child = spawn("python", ["-u", fileURLToPath(new URL("./assess-download.py", import.meta.url))], {
      stdio: ["pipe", "pipe", "pipe"], detached: true,
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    let granted = false;
    let requestId: string | undefined;
    let responded = false;
    let documentRecorded = false;
    let diagnosticBytes = 0;
    child.stderr.on("data", (buffer: Buffer) => { diagnosticBytes += buffer.length; });
    const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ } } };
    const timeout = setTimeout(terminate, discoveryPolicy.spacingMs + 60_000);
    child.stdin.write(JSON.stringify({ docketNumber: item.docketNumber, sourceUrl: item.sourceUrl }) + "\n");
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line.length > 20_000) throw new Error("Assessment message exceeds minimal evidence bound.");
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.kind === "request") {
          if (granted) throw new Error("Assessment attempted a second request; stopped.");
          const permission = await grant(job, message.path, message.method, expected);
          granted = permission.allow;
          requestId = "requestId" in permission ? permission.requestId : undefined;
          child.stdin.write(JSON.stringify(permission) + "\n");
        } else if (message.kind === "response") {
          if (!requestId || responded || message.requestId !== requestId) throw new Error("Unexpected assessment response.");
          await sourceOutcome(job, message);
          responded = true;
          console.log(JSON.stringify({ status: message.status, outcome: message.outcome, requestsUsed: expected + 1 }));
        } else if (message.kind === "docket") {
          if (!responded || documentRecorded || message.docketNumber !== item.docketNumber) throw new Error("Unexpected evidence identity.");
          const outcomes = ["EXTRACTED", "MISSING_BAIL_SECTION", "UNREADABLE", "UNSUPPORTED_LAYOUT", "IDENTITY_MISMATCH", "RETRIEVAL_FAILED"];
          if (!outcomes.includes(String(message.extractionOutcome))) throw new Error("Unsupported extraction outcome.");
          const updated = {
            ...item.provenance, extractionOutcome: message.extractionOutcome as typeof item.provenance.extractionOutcome,
            postedEntryState: message.postedEntryState as typeof item.provenance.postedEntryState,
            entries: message.entries as DiscoveryEntryData[],
          };
          await db.update(discoveryItemsTable).set({
            sourceRetrievedAt: typeof message.retrievedAt === "string" ? new Date(message.retrievedAt) : null,
            excerpt: typeof message.excerpt === "string" ? message.excerpt : null,
            detail: typeof message.detail === "string" ? message.detail : null, provenance: updated,
          }).where(and(eq(discoveryItemsTable.id, item.id), eq(discoveryItemsTable.ownerId, job.ownerId)));
          await discoveryEvent(job, "DOCUMENT", `Approved single-download assessment: ${updated.extractionOutcome}. PDF disposed; no save, review, custody or operative-order conclusion.`);
          documentRecorded = true;
          console.log(JSON.stringify({ docketNumber: item.docketNumber, outcome: updated.extractionOutcome,
            postedEntryState: updated.postedEntryState, entries: updated.entries }));
        } else if (message.kind === "barrier") {
          console.log(JSON.stringify({ barrier: message.code }));
        } else throw new Error("Unexpected assessment protocol.");
      }
      if (await exit !== 0 || !documentRecorded) throw new Error(`Assessment incomplete (${diagnosticBytes} diagnostic bytes); no retry.`);
    } finally {
      clearTimeout(timeout);
      terminate();
      if (requestId && !responded) await sourceOutcome(job, {
        requestId, status: null, outcome: "UNCERTAIN_AFTER_ASSESSMENT", retryAfter: null,
      });
      await db.update(discoveryJobsTable).set({
        status: "PAUSED", updatedAt: new Date(),
        message: "Approved single-download assessment ended. Evidence/checkpoints and original budget retained. Collection remains paused pending assessment; no automatic next request.",
      }).where(eq(discoveryJobsTable.id, job.id));
    }
  } finally {
    if (acquired) await lease.query("SELECT pg_advisory_unlock(74651283)");
    lease.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Assessment failed.");
  process.exitCode = 1;
}).finally(() => pool.end());
