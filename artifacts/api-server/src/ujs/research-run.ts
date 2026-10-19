/** Operator-only, exact one-use run. --user-approved reflects the explicit
 * October 18 user authorization; it is not a web-session permission. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, discoveryAssessmentsTable as permits, discoveryJobsTable as jobs,
  discoveryRequestsTable as requests, discoverySourceTable as sources } from "@workspace/db";
import { WORKSPACE_OWNER_ID } from "../middlewares/researchAuth";
import { calendarPreviewSourceAllowed } from "../lib/discovery-safety";
import { easternToday } from "../lib/calendar-criteria";
import { makeResearchCriteria, proofDockets, proofUrls, proofMethod, researchMethod } from "../lib/research-scope";
import { reserveSourceRequest, accountSourceResponse } from "../lib/discovery-scheduler";
import { runJob } from "../lib/discovery-worker";
import { jobSummary } from "../lib/discovery";

const args = process.argv.slice(2);
const command = args[0];
const argument = (key: string) => args[args.indexOf(`--${key}`) + 1];
const root = path.dirname(fileURLToPath(import.meta.url));
async function main() {
  if (!args.includes("--user-approved")) throw new Error("Explicit operator authorization required");
  const day = argument("day");
  if (!args.includes("--day") || day !== "2026-10-19" || day < easternToday())
    throw new Error("This authorization is for October 19, 2026; source-backed date fallback requires a new exact scope, never a silent substitution.");
  if (command === "verify-samples") {
    const id = argument("proof-id");
    const [permit] = await db.select().from(permits).where(eq(permits.id, id));
    if (!permit || permit.stage !== "RESEARCH_PROOF" || permit.state !== "SAMPLES_RETRIEVED"
        || permit.expectedMethod !== proofMethod || permit.criteria.startDate !== day || !permit.jobId)
      throw new Error("Four successfully retrieved source PDFs are required; missing/denied samples are not proof.");
    const ledger = await db.select().from(requests).where(eq(requests.jobId, permit.jobId));
    if (ledger.length !== 4 || ledger.some(row => row.outcome !== "OK"))
      throw new Error("Regression request ledger is incomplete.");
    const result = spawnSync("python", [path.join(root, "ujs/document_regression.py"), "verify",
      path.resolve(process.cwd(), "../../generated-artifacts/document-regression")],
      {encoding: "utf8", timeout: 60000, maxBuffer: 20000});
    console.log(result.stdout.trim());
    if (result.status !== 0) throw new Error("Real-source PDF regressions failed; no engine admission.");
    await db.update(permits).set({state: "REGRESSION_VERIFIED"}).where(eq(permits.id, id));
    return;
  }
  if (!["samples", "engine"].includes(command ?? "")) throw new Error("Use samples or engine");
  const proof = command === "samples";
  const proofId = proof ? undefined : argument("proof-id");
  const criteria = makeResearchCriteria(day, proofId);
  const lease = await pool.connect();
  if (!(await lease.query("SELECT pg_try_advisory_lock(74651283) AS acquired")).rows[0]?.acquired) {
    lease.release();
    throw new Error("Managed worker active; no source request");
  }
  let permitId: string | undefined;
  let jobId: string | undefined;
  try {
    const job = await db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id, "UJS")).for("update");
      if (!source || !calendarPreviewSourceAllowed(source)) throw new Error("Source stop/cooldown/barrier mismatch");
      if (proof) {
        const previous = await tx.select().from(permits).where(eq(permits.stage, "RESEARCH_PROOF"));
        if (previous.some(row => row.criteria.startDate === day))
          throw new Error("This one-use regression scope was already created/consumed; no replay.");
      }
      const [active] = await tx.select().from(jobs).where(inArray(jobs.status, ["RUNNING", "QUEUED"])).limit(1);
      if (active) throw new Error("Another discovery job is active");
      if (!proof) {
        const [previous] = await tx.select().from(permits).where(eq(permits.id, String(proofId))).for("update");
        if (!previous || previous.stage !== "RESEARCH_PROOF" || previous.expectedMethod !== proofMethod
            || previous.state !== "REGRESSION_VERIFIED" || previous.criteria.startDate !== day
            || !previous.expiresAt || previous.expiresAt <= new Date())
          throw new Error("Real-PDF regression verification required before engine");
        const existing = await tx.select().from(permits).where(eq(permits.stage, "RESEARCH_RUN"));
        if (existing.some(row => (row.criteria as unknown as Record<string, unknown>).proofPermitId === proofId))
          throw new Error("One engine permit per real-PDF proof; no replay");
      }
      permitId = randomUUID(); jobId = randomUUID();
      await tx.insert(permits).values({ id: permitId, stage: proof ? "RESEARCH_PROOF" : "RESEARCH_RUN",
        expectedMethod: proof ? proofMethod : researchMethod, criteria, state: "ATTEMPTED",
        approvedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600000) });
      const [created] = await tx.insert(jobs).values({ id: jobId, ownerId: WORKSPACE_OWNER_ID,
        criteria, assessmentId: permitId, status: proof ? "RUNNING" : "QUEUED" }).returning();
      await tx.update(permits).set({jobId}).where(eq(permits.id, permitId));
      return created!;
    });
    console.log(JSON.stringify({permitId, jobId, criteria, notice:
      "Historical operator scope; configured per-operation pacing, shared quotas and source stops apply. Ordinary authenticated research does not use this pilot."}));
    if (proof) {
      for (let i = 0; i < proofUrls.length; i++) {
        const url = proofUrls[i]!;
        const grant = await reserveSourceRequest(job, new URL(url).pathname, "GET", permitId, url, () => false);
        if (!grant.allow || !("requestId" in grant)) throw new Error(`Sample ${proofDockets[i]} not transmitted: ${grant.reason}`);
        const destination = path.resolve(process.cwd(), "../../generated-artifacts/document-regression", `${proofDockets[i]}.pdf`);
        const child = spawnSync("python", [path.join(root, "ujs/document_regression.py"), url, destination],
          { encoding: "utf8", timeout: 60000, maxBuffer: 10000 });
        const response = child.status === 0 ? JSON.parse(child.stdout)
          : {status: null, outcome: "NETWORK_ERROR"};
        const accounting = await accountSourceResponse(job, {requestId: grant.requestId, ...response});
        console.log(JSON.stringify({docket: proofDockets[i], ...response, destination}));
        if (response.outcome !== "OK" || !accounting) throw new Error(`Stopped at ${proofDockets[i]}: ${response.outcome}`);
      }
      await db.update(jobs).set({status: "COMPLETED", updatedAt: new Date(),
        message: "Four explicitly authorized regression PDFs retrieved; no calendar rows asserted."}).where(eq(jobs.id, job.id));
      await db.update(permits).set({state: "SAMPLES_RETRIEVED", completedAt: new Date()}).where(eq(permits.id, permitId!));
    } else {
      await runJob(job, permitId);
      const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      const complete = current?.status === "COMPLETED";
      await db.update(permits).set({state: complete ? "RESEARCH_COMPLETED" : "FAILED",
        completedAt: new Date()}).where(eq(permits.id, permitId!));
      if (current) console.log(JSON.stringify(await jobSummary(current)));
      if (!complete) throw new Error(`Research engine did not complete: ${current?.message ?? current?.status ?? "job missing"}`);
    }
  } catch (error) {
    if (permitId) await db.update(permits).set({state: "FAILED", completedAt: new Date()}).where(eq(permits.id, permitId));
    if (jobId) await db.update(jobs).set({status: "PAUSED", updatedAt: new Date(),
      message: error instanceof Error ? error.message : "Research stopped"}).where(and(eq(jobs.id, jobId), inArray(jobs.status, ["RUNNING", "QUEUED"])));
    throw error;
  } finally {
    await lease.query("SELECT pg_advisory_unlock(74651283)");
    lease.release();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Research failed"); process.exitCode = 1; })
  .finally(() => pool.end());
