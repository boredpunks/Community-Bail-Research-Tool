import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, pool, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, type DiscoveryJobRow, type DiscoveryEntryData } from "@workspace/db";
import { discoveryEvent, discoveryPolicy, jobSummary } from "./discovery";
import { logger } from "./logger";
import { collectionBlock } from "./discovery-safety";
import { clearExpiredDiscoveryResults } from "./discovery-retention";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let activeChild: ChildProcessWithoutNullStreams | null = null;
let stopping = false;
const sourceId = "UJS";

async function pause(job: DiscoveryJobRow, message: string) {
  await db.update(discoveryJobsTable).set({ status: "PAUSED", message, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
  await discoveryEvent(job, "PAUSE", message);
}

// Operator-only assessment calls retain the source pause and use an expected
// counter as a single-use permit. There is no HTTP endpoint for this override.
export async function grant(job: DiscoveryJobRow, requestPath: unknown, method: unknown, assessmentRequestsUsed?: number) {
  const assessment = assessmentRequestsUsed !== undefined;
  if (assessment && (requestPath !== "/Report/CpDocketSheet" || method !== "GET"
      || !Number.isSafeInteger(assessmentRequestsUsed) || assessmentRequestsUsed! < 0)) return { allow: false };
  if (typeof requestPath !== "string" || !["/CaseSearch", "/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css", "/Report/CpDocketSheet"].includes(requestPath)
      || !["GET", "POST"].includes(String(method)) || (method === "POST" && requestPath !== "/CaseSearch")) {
    await pause(job, "Unexpected source request blocked; operator assessment required.");
    return { allow: false };
  }
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
  const anchor = Math.max(source?.lastRequestAt?.getTime() ?? 0, source?.lastCompletedAt?.getTime() ?? 0);
  if (anchor) await delay(Math.max(0, anchor + discoveryPolicy.spacingMs - Date.now()));
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id)).for("update");
    const [control] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).for("update");
    if (!current || current.status !== (assessment ? "PAUSED" : "RUNNING") || stopping) return { allow: false };
    if (assessment && (current.requestsUsed !== assessmentRequestsUsed || !current.calendarComplete
        || control?.blockedReason !== "ACCESS_DENIED" || control.pausedUntil)) return { allow: false };
    if (!assessment && collectionBlock(control)) {
      await tx.update(discoveryJobsTable).set({ status: "PAUSED", message: "Source-wide pause. No new source requests permitted.", updatedAt: new Date() }).where(eq(discoveryJobsTable.id, job.id));
      return { allow: false };
    }
    if (current.requestsUsed >= current.criteria.requestCap) {
      await tx.update(discoveryJobsTable).set({ status: "PAUSED", message: "Explicit request budget exhausted. Partial evidence retained; budget will not increase automatically.", updatedAt: new Date() }).where(eq(discoveryJobsTable.id, job.id));
      return { allow: false };
    }
    const now = new Date();
    // A granted request is not access proof. Clear only a genuinely expired
    // rate-limit cooldown; preserve every other unresolved source block.
    await tx.update(discoverySourceTable).set(!assessment && control?.blockedReason === "RATE_LIMIT"
      ? { lastRequestAt: now, pausedUntil: null, blockedReason: null }
      : { lastRequestAt: now }).where(eq(discoverySourceTable.id, sourceId));
    const [request] = await tx.insert(discoveryRequestsTable).values({ jobId: job.id, ownerId: job.ownerId, path: requestPath, method: String(method), startedAt: now }).returning();
    await tx.update(discoveryJobsTable).set({ requestsUsed: current.requestsUsed + 1, updatedAt: now, message: `Request ${current.requestsUsed + 1}/${current.criteria.requestCap}: ${method} ${requestPath}` }).where(eq(discoveryJobsTable.id, job.id));
    return { allow: true, requestId: request!.id };
  });
}

export async function sourceOutcome(job: DiscoveryJobRow, message: Record<string, unknown>) {
  if (typeof message.requestId !== "string" || typeof message.outcome !== "string") throw new Error("Malformed source response accounting");
  const completedAt = new Date();
  await db.transaction(async (tx) => {
    const accounted = await tx.update(discoveryRequestsTable).set({
      statusCode: typeof message.status === "number" ? message.status : null,
      outcome: String(message.outcome), completedAt,
    }).where(and(eq(discoveryRequestsTable.id, String(message.requestId)), eq(discoveryRequestsTable.jobId, job.id),
      eq(discoveryRequestsTable.ownerId, job.ownerId), eq(discoveryRequestsTable.outcome, "IN_FLIGHT"))).returning();
    if (accounted.length !== 1) throw new Error("Source request was not pending in this job");
    await tx.update(discoverySourceTable).set({ lastCompletedAt: completedAt }).where(eq(discoverySourceTable.id, sourceId));
  });
  if (message.outcome === "OK") return;
  let pausedUntil: Date | null = null;
  if (message.outcome === "RATE_LIMIT") {
    let retryAt = Date.now() + discoveryPolicy.cooldownMs;
    if (typeof message.retryAfter === "string") {
      const seconds = Number(message.retryAfter);
      const time = /^\d+$/.test(message.retryAfter) ? Date.now() + seconds * 1000 : Date.parse(message.retryAfter);
      if (Number.isFinite(time) && time <= 8_640_000_000_000_000) retryAt = Math.max(retryAt, time);
    }
    pausedUntil = new Date(retryAt);
  }
  if (["RATE_LIMIT", "ACCESS_DENIED", "CHALLENGE", "REDIRECT"].includes(message.outcome)) {
    await db.update(discoverySourceTable).set({
      blockedReason: message.outcome, pausedUntil,
      ...(["ACCESS_DENIED", "CHALLENGE", "REDIRECT"].includes(message.outcome)
        ? { accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null } : {}),
    }).where(eq(discoverySourceTable.id, sourceId));
    const jobs = await db.select().from(discoveryJobsTable).where(inArray(discoveryJobsTable.status, ["RUNNING", "QUEUED"]));
    for (const affected of jobs) await pauseOrQueued(affected, `${message.outcome}: all source traffic stopped.${pausedUntil ? ` Earliest permitted resume: ${pausedUntil.toISOString()}.` : " Operator assessment required; no automatic workaround or retry."}`);
  } else {
    await pause(job, `Source request failed (${message.outcome}). No automatic retries. Partial evidence retained.`);
  }
}

async function pauseOrQueued(job: DiscoveryJobRow, message: string) {
  await db.update(discoveryJobsTable).set({ status: "PAUSED", message, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), inArray(discoveryJobsTable.status, ["RUNNING", "QUEUED"])));
  await discoveryEvent(job, "SOURCE_PAUSE", message);
}

async function runJob(job: DiscoveryJobRow) {
  const [running] = await db.update(discoveryJobsTable).set({ status: "RUNNING", message: "Starting one paced browser session. Asset traffic counts against your budget.", updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "QUEUED"))).returning();
  if (!running) return;
  await discoveryEvent(job, "START", "Worker acquired this job; original query and ordering retained.");
  const items = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id)).orderBy(asc(discoveryItemsTable.position));
  const processed = items.filter((item) => item.provenance.extractionOutcome !== "UNPROCESSED").length;
  const initialCounts = await jobSummary(running);
  if (initialCounts.targetReached) {
    await db.update(discoveryJobsTable).set({ status: "COMPLETED", message: `Matching target reached (${initialCounts.matching}/${running.criteria.matchTarget}). No further downloads.`, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
    return;
  }
  if (processed >= job.criteria.recordCap) {
    await db.update(discoveryJobsTable).set({ status: "COMPLETED", message: "Explicit record cap reached; remaining discovered dockets were not processed.", updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
    return;
  }
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ujs", "worker.py");
  const child = spawn("python", ["-u", script], { stdio: ["pipe", "pipe", "pipe"], detached: true });
  activeChild = child;
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let finished = false;
  let stderrBytes = 0;
  child.stderr.on("data", (buffer: Buffer) => { stderrBytes += buffer.length; }); // Never log source/cookie/PDF text.
  child.stdin.write(JSON.stringify({
    criteria: job.criteria, calendarComplete: job.calendarComplete,
    pendingItems: items.filter((item) => item.provenance.extractionOutcome === "UNPROCESSED").map((item) => ({ docketNumber: item.docketNumber, sourceUrl: item.sourceUrl })),
    remainingRecords: job.criteria.recordCap - processed,
  }) + "\n");
  try {
    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      if (line.length > 2_000_000) throw new Error("Worker message exceeds bound");
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.kind === "request") {
        child.stdin.write(JSON.stringify(await grant(job, message.path, message.method)) + "\n");
      } else if (message.kind === "response") {
        await sourceOutcome(job, message);
      } else if (message.kind === "calendar") {
        const rows = message.rows as { docketNumber: string; position: number; sourceUrl: string; eventDate: string | null; filingDate: string | null }[];
        if (!Array.isArray(rows) || rows.length > 1000 || typeof message.retrievedAt !== "string") throw new Error("Invalid calendar checkpoint");
        await db.transaction(async (tx) => {
          for (const row of rows) {
            if (!/^CP-02-CR-\d{7}-\d{4}$/.test(row.docketNumber) || !row.sourceUrl.startsWith("https://ujsportal.pacourts.us/Report/CpDocketSheet?")) throw new Error("Calendar identity conflict");
            await tx.insert(discoveryItemsTable).values({
              jobId: job.id, ownerId: job.ownerId, ...row,
              provenance: {
                calendarUrl: "https://ujsportal.pacourts.us/CaseSearch", calendarRetrievedAt: message.retrievedAt as string,
                courtOffice: job.criteria.courtOffice, eventType: job.criteria.eventType,
                eventDate: row.eventDate, filingDate: row.filingDate, extractionOutcome: "UNPROCESSED",
                postedEntryState: "UNKNOWN", entries: [],
              },
            }).onConflictDoNothing({ target: [discoveryItemsTable.jobId, discoveryItemsTable.docketNumber] });
          }
          await tx.update(discoveryJobsTable).set({
            calendarComplete: true, paginationComplete: message.paginationComplete === true,
            resultCapReached: message.resultCapReached === true, updatedAt: new Date(),
          }).where(eq(discoveryJobsTable.id, job.id));
        });
        await discoveryEvent(job, "CALENDAR", `Validated ${rows.length} distinct result-linked dockets in source order. ${message.paginationComplete ? "All rows in this returned table inspected; no remote pagination detected." : "Pagination or source result cap limits coverage."} Nonessential assets blocked before transmission: ${Number(message.blockedAssets) || 0}.`);
      } else if (message.kind === "docket") {
        const [item] = await db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.docketNumber, String(message.docketNumber))));
        if (!item || item.provenance.extractionOutcome !== "UNPROCESSED") continue;
        const outcome = String(message.extractionOutcome);
        if (!["EXTRACTED", "MISSING_BAIL_SECTION", "UNREADABLE", "UNSUPPORTED_LAYOUT", "IDENTITY_MISMATCH", "RETRIEVAL_FAILED"].includes(outcome)) throw new Error("Invalid extraction outcome");
        await db.update(discoveryItemsTable).set({
          sourceRetrievedAt: typeof message.retrievedAt === "string" ? new Date(message.retrievedAt) : null,
          excerpt: typeof message.excerpt === "string" ? message.excerpt : null,
          detail: typeof message.detail === "string" ? message.detail : null,
          provenance: { ...item.provenance,
            extractionOutcome: outcome as typeof item.provenance.extractionOutcome,
            postedEntryState: message.postedEntryState as typeof item.provenance.postedEntryState,
            entries: message.entries as DiscoveryEntryData[],
          },
        }).where(eq(discoveryItemsTable.id, item.id));
        await discoveryEvent(job, "DOCUMENT", `Document ${item.position + 1}: ${outcome}. PDF disposed after processing. Custody remains unknown.`);
      } else if (message.kind === "checkpoint") {
        const [current] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
        const counts = current ? await jobSummary(current) : null;
        child.stdin.write(JSON.stringify({ continue: current?.status === "RUNNING" && !counts?.targetReached }) + "\n");
      } else if (message.kind === "finished") {
        finished = true;
      } else if (message.kind === "barrier") {
        await pause(job, `Source barrier: ${String(message.code).slice(0, 180)}. Not an empty search. Completed results retained.`);
      } else {
        throw new Error("Unrecognized worker protocol");
      }
    }
    const code = await exit;
    const [current] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
    if (current?.status === "RUNNING") {
      if (finished && code === 0) {
        const counts = await jobSummary(current);
        const message = counts.targetReached
          ? `Matching target reached (${counts.matching}/${current.criteria.matchTarget}). Remaining discovered dockets were not downloaded.`
          : counts.unprocessed > 0
          ? "Explicit record cap reached. Partial docket processing; unprocessed rows remain visible."
          : counts.discovered === 0 ? "Validated result table contained no docket rows. This is a completed empty search, not a returned form."
            : `Returned calendar results exhausted. ${counts.matching} matching docket(s)${current.criteria.matchTarget ? ` of ${current.criteria.matchTarget} requested` : ""}. No date-range expansion; ${current.paginationComplete ? "no remote pagination detected" : "remote pagination/coverage remains incomplete"}. Evidence remains unreviewed; custody unknown.`;
        await db.update(discoveryJobsTable).set({ status: "COMPLETED", message, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
        await discoveryEvent(job, "FINISHED", message);
      } else await pause(job, `Worker stopped before completion (exit ${code}; ${stderrBytes} diagnostic bytes). No automatic retry; partial results retained.`);
    }
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    }
    activeChild = null;
  }
}

export async function startDiscoveryWorker() {
  while (!stopping) {
    const lease = await pool.connect();
    try {
      const acquired = await lease.query("SELECT pg_try_advisory_lock(74651283) AS acquired");
      if (!acquired.rows[0]?.acquired) { await delay(5000); continue; }
      await db.insert(discoverySourceTable).values({ id: sourceId }).onConflictDoNothing();
      // Recovery never retries source work silently. Consumed slots stay consumed.
      const interrupted = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.status, "RUNNING"));
      for (const job of interrupted) await pause(job, "Application restarted during collection. Partial results and consumed request slots preserved. Resume explicitly.");
      const uncertain = await db.update(discoveryRequestsTable).set({ outcome: "UNCERTAIN_AFTER_RESTART", completedAt: new Date() }).where(eq(discoveryRequestsTable.outcome, "IN_FLIGHT")).returning();
      if (uncertain.length) {
        await db.update(discoverySourceTable).set({ pausedUntil: new Date(Date.now() + 45_000), blockedReason: "RESTART_IN_FLIGHT" }).where(eq(discoverySourceTable.id, sourceId));
      }
      let cleanupAt = 0;
      while (!stopping) {
        if (Date.now() >= cleanupAt) {
          await clearExpiredDiscoveryResults();
          cleanupAt = Date.now() + 60_000;
        }
        const [job] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.status, "QUEUED")).orderBy(asc(discoveryJobsTable.createdAt)).limit(1);
        if (job) {
          try { await runJob(job); }
          catch (error) {
            logger.error({ err: error instanceof Error ? { name: error.name, message: error.message.slice(0, 180) } : undefined }, "Discovery worker stopped a job");
            await pause(job, "Local worker failure. No fabricated results or automatic retries. Operator should inspect setup.");
          }
        } else await delay(1000);
      }
      await lease.query("SELECT pg_advisory_unlock(74651283)");
    } catch (error) {
      logger.error({ err: error instanceof Error ? { name: error.name } : undefined }, "Discovery worker unavailable");
      await delay(5000);
    } finally { lease.release(); }
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  stopping = true;
  if (activeChild?.pid) {
    try { process.kill(-activeChild.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
});
