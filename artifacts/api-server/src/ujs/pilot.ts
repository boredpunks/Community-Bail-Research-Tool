/**
 * Operator-only protocol. No source traffic for prepare/approve/report.
 * Run requires a separately approved expiring permit and the worker lease.
 * Collection approval is an additional explicit action after all stages.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, pool, discoveryAssessmentsTable, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable } from "@workspace/db";
import { actualDate, discoveryPolicy, easternToday } from "../lib/discovery";
import {
  calendarPreviewMethod, calendarPreviewRequestAllowed, calendarPreviewSourceAllowed,
  collectionBlock, integratedSourceMethod, isCalendarPreviewCriteria,
} from "../lib/discovery-safety";
import { runJob } from "../lib/discovery-worker";
import { WORKSPACE_OWNER_ID } from "../middlewares/researchAuth";
import { formInspectionMethod } from "../lib/form-inspection";
import { coverageInspectionMethod, validCoverageMetadata } from "../lib/coverage-inspection";
import { filingInspectionMethod, validFilingMetadata } from "../lib/filing-inspection";
import { makeCalendarPreviewCriteria } from "../lib/calendar-criteria";
import { clearSourceValidationBarrier } from "../lib/discovery-barrier";

// INSPECT uses a storage placeholder, not a PDF allowance. Its scheduler and
// child prohibit every document request and every transmitted POST.
const stageCaps = { SINGLE: 1, SMALL: 3, MODEST: 10, INSPECT: 1, COVERAGE: 1, FILING_INSPECT: 1, CALENDAR_ONLY: 1 } as const;
const diagnostic = (stage: string) => ["INSPECT", "COVERAGE", "FILING_INSPECT"].includes(stage);
const currentMethod = (stage: string) => stage === "CALENDAR_ONLY" ? calendarPreviewMethod
  : stage === "FILING_INSPECT" ? filingInspectionMethod : stage === "COVERAGE" ? coverageInspectionMethod
  : stage === "INSPECT" ? formInspectionMethod : integratedSourceMethod;
const args = process.argv.slice(2);
const command = args.shift();
const value = (key: string) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : undefined;
const flag = (key: string) => args.includes(`--${key}`);

async function main() {
  if (command === "prepare-calendar-only") {
    const criteria = makeCalendarPreviewCriteria({
      courtOffice: value("office"), eventType: value("event"), startDate: value("start"), endDate: value("end"),
    });
    const row = await db.transaction(async (tx) => {
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      if (!source || !calendarPreviewSourceAllowed(source)) {
        throw new Error("The one-use calendar gate can only be prepared while SOURCE_VALIDATION_BARRIER remains unchanged and no request is active.");
      }
      const [activeJob] = await tx.select().from(discoveryJobsTable)
        .where(inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])).limit(1);
      if (activeJob) throw new Error("Another discovery job is active; no permit was prepared.");
      const priorPermits = await tx.select().from(discoveryAssessmentsTable)
        .where(eq(discoveryAssessmentsTable.stage, "CALENDAR_ONLY"));
      if (priorPermits.some((permit) => JSON.stringify(permit.criteria) === JSON.stringify(criteria)
        || ["courtOffice", "eventType", "startDate", "endDate"].every(
          key => permit.criteria[key as keyof typeof permit.criteria] === criteria[key as keyof typeof criteria]))) {
        throw new Error("A permit already exists for this exact calendar scope. Reuse and retries are not permitted.");
      }
      const [created] = await tx.insert(discoveryAssessmentsTable).values({
        stage: "CALENDAR_ONLY", expectedMethod: calendarPreviewMethod, criteria,
      }).returning();
      return created!;
    });
    console.log(JSON.stringify({
      id: row!.id, stage: row!.stage, state: row!.state, criteria: row!.criteria,
      documentCap: 0, requestCap: criteria.requestCap,
      notice: "Prepared with no source traffic. A separate --user-approved operator action is required; this permit allows one exact Calendar Event search only, no PDFs, no retries, and does not clear or broaden the source barrier.",
    }));
    return;
  }

  if (command === "prepare") {
    const stage = String(value("stage") ?? "").toUpperCase() as keyof typeof stageCaps;
    const startDate = value("start"), endDate = value("end"), requestCap = Number(value("requests"));
    if (stage === "INSPECT") throw new Error("FORM_INSPECTION_LIVE_DISABLED: offline safeguards require review before any live authorization.");
    if (!stageCaps[stage] || stage === "CALENDAR_ONLY" || !actualDate(startDate) || !actualDate(endDate) || startDate < easternToday()
      || endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 6 * 86_400_000
      || !Number.isInteger(requestCap) || requestCap < (diagnostic(stage) ? 3 : 8)
      || requestCap > (diagnostic(stage) ? 3 : 500)) throw new Error("Specify --stage SINGLE/SMALL/MODEST (8–500 requests) or INSPECT/COVERAGE/FILING_INSPECT (exactly 3 GETs, zero PDFs/remote POSTs), with today/future dates up to 7 days. Use prepare-calendar-only --office <observed-code> --event \"Bail Hearing\" or \"Preliminary Arraignment\" --start YYYY-MM-DD --end YYYY-MM-DD for an exact one-use preview scope.");
    const [row] = await db.insert(discoveryAssessmentsTable).values({
      stage, expectedMethod: currentMethod(stage),
      criteria: { courtOffice: "CP-05-02-Crim", eventType: "Bail Hearing", startDate, endDate,
        recordCap: stageCaps[stage], requestCap, matchTarget: stageCaps[stage],
        matchFilters: { monetaryUpperBoundCents: null, excludeShownPosted: false, inclusiveMaximum: true } },
    }).returning();
    console.log(JSON.stringify({ id: row!.id, stage, state: "PREPARED", criteria: row!.criteria,
      documentCap: diagnostic(stage) ? 0 : row!.criteria.recordCap,
      remotePostCap: diagnostic(stage) ? 0 : null,
       notice: "No source traffic. Preparation is not approval; protected operator caps remain unchanged. Diagnostic criteria recordCap and dates are legacy storage placeholders, never PDF permission or submitted dates. Current FILING_INSPECT observes bounded public widgets after filing mode, Advanced Search and County = Allegheny, with redacted displayed public office codes only; oversized option lists stay uninspected/unknown. No private option values or identities, other county, court/case/office selection, Search or date entry; dependent requests abort locally." }));
    return;
  }
  if (command === "clear-barrier") {
    const reason = value("reason");
    if (!reason || reason.startsWith("--")) {
      throw new Error('Use clear-barrier --reason "<text>" --user-approved; no operation performed.');
    }
    const result = await clearSourceValidationBarrier({
      reason,
      userApproved: flag("user-approved"),
    });
    console.log(JSON.stringify(result));
    return;
  }
  const id = value("id");
  if (!id || !/^[\da-f-]{36}$/i.test(id)) throw new Error("Specify --id with the prepared pilot UUID.");
  if (command === "report") {
    const [row] = await db.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, id));
    if (!row) throw new Error("Pilot not found.");
    const coverageEvidence: Record<string, unknown>[] = [];
    if (["COVERAGE", "FILING_INSPECT"].includes(row.stage) && row.jobId) {
      const events = await db.select().from(discoveryEventsTable).where(and(
        eq(discoveryEventsTable.jobId, row.jobId), eq(discoveryEventsTable.kind, row.stage === "COVERAGE" ? "COVERAGE_METADATA" : "FILING_METADATA"),
      )).orderBy(asc(discoveryEventsTable.createdAt));
      for (const event of events) {
        const metadata = JSON.parse(event.message) as Record<string, unknown>;
        if (!(row.stage === "COVERAGE" ? validCoverageMetadata(metadata) : validFilingMetadata(metadata))) throw new Error("Stored inspection metadata is invalid; no raw content returned.");
        coverageEvidence.push(metadata);
      }
    }
    console.log(JSON.stringify({ ...row, ...(row.stage === "COVERAGE" ? { coverageEvidence } : row.stage === "FILING_INSPECT" ? { filingEvidence: coverageEvidence } : {}),
      ...(row.stage === "CALENDAR_ONLY" ? {
        documentCap: 0, remotePostCap: 1,
        notice: "One exact approved Calendar Event search only. No docket PDFs, no retry, no collection approval, and the source-wide barrier is preserved.",
      } : diagnostic(row.stage) ? {
        documentCap: 0, remotePostCap: 0, notice: "Operator-only diagnostic; criteria recordCap is a storage placeholder. No document or transmitted POST permitted.",
      } : {}) }));
    return;
  }
  if (!flag("user-approved")) throw new Error("Separate explicit user approval is required; no operation performed.");
  if (command === "approve") {
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [row] = await tx.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, id)).for("update");
      if (!row || row.stage === "INSPECT" || row.state !== "PREPARED" || !Object.hasOwn(stageCaps, row.stage) || row.expectedMethod !== currentMethod(row.stage)
        || diagnostic(row.stage) && row.criteria.requestCap !== 3) throw new Error("Only an unused prepared current-method pilot can be approved.");
      if (row.criteria.startDate < easternToday() || row.criteria.recordCap > discoveryPolicy.maxRecordCap || row.criteria.requestCap > discoveryPolicy.maxRequestCap) throw new Error("Scope is stale or exceeds protected limits. Obtain separate operator-budget authorization; limits will not increase automatically.");
      if (row.stage === "CALENDAR_ONLY" && (!isCalendarPreviewCriteria(row.criteria)
        || !source || !calendarPreviewSourceAllowed(source))) {
        throw new Error("Calendar-only approval requires valid saved exact criteria and the unchanged SOURCE_VALIDATION_BARRIER. No source request or barrier override occurred.");
      }
      if (row.stage !== "SINGLE" && !diagnostic(row.stage)) {
        if (row.stage === "CALENDAR_ONLY") {
          const [activeJob] = await tx.select().from(discoveryJobsTable)
            .where(inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])).limit(1);
          if (activeJob) throw new Error("Another discovery job is active; no permit was approved.");
        } else {
          const priorStage = row.stage === "SMALL" ? "SINGLE" : "SMALL";
          const [prior] = await tx.select().from(discoveryAssessmentsTable).where(and(
            eq(discoveryAssessmentsTable.stage, priorStage), eq(discoveryAssessmentsTable.state, "VERIFIED"),
            eq(discoveryAssessmentsTable.expectedMethod, integratedSourceMethod),
          )).orderBy(desc(discoveryAssessmentsTable.completedAt)).limit(1);
          if (!prior || !prior.completedAt || source?.accessVerifiedAt?.getTime() !== prior.completedAt.getTime()
            || source.verifiedMethod !== integratedSourceMethod || source.blockedReason
            || (row.stage === "MODEST" && prior.completedAt.getTime() + 3_600_000 > Date.now())) throw new Error("A fresh prior-stage proof with no intervening source stop is required; MODEST must be at least one hour later.");
        }
      }
      await tx.update(discoveryAssessmentsTable).set({
        state: "APPROVED", approvedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3_600_000),
      }).where(eq(discoveryAssessmentsTable.id, id));
    });
    console.log(JSON.stringify({ id, state: "APPROVED", notice: "Permit expires in 24 hours. No source traffic or collection enablement." }));
    return;
  }
  if (command === "approve-collection") {
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [pilot] = await tx.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, id));
      if (!source || source.activeRequestId || collectionBlock(source) !== "COLLECTION_NOT_APPROVED"
        || !pilot || pilot.stage !== "MODEST" || pilot.state !== "VERIFIED" || pilot.expectedMethod !== integratedSourceMethod
        || !pilot.completedAt || source.accessVerifiedAt?.getTime() !== pilot.completedAt.getTime()) throw new Error("Fresh current-method staged verification is required; unresolved stops cannot be cleared here.");
      await tx.update(discoverySourceTable).set({ collectionApprovedAt: new Date() }).where(eq(discoverySourceTable.id, "UJS"));
    });
    console.log(JSON.stringify({ notice: "Current method explicitly approved. No search started, dates expanded, or budgets raised." }));
    return;
  }
  if (command !== "run") throw new Error("Use prepare, prepare-calendar-only, clear-barrier, approve, run, report, or approve-collection.");
  const lease = await pool.connect();
  let acquired = false;
  let jobId: string | undefined;
  try {
    acquired = (await lease.query("SELECT pg_try_advisory_lock(74651283) AS acquired")).rows[0]?.acquired === true;
    if (!acquired) throw new Error("Managed worker is running. Stop it before an approved pilot; no request was made.");
    const job = await db.transaction(async (tx) => {
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [pilot] = await tx.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, id)).for("update");
      if (!pilot || pilot.state !== "APPROVED" || !pilot.expiresAt || pilot.expiresAt <= new Date()
         || pilot.stage === "INSPECT" || !Object.hasOwn(stageCaps, pilot.stage) || pilot.expectedMethod !== currentMethod(pilot.stage)
         || diagnostic(pilot.stage) && pilot.criteria.requestCap !== 3 || pilot.criteria.startDate < easternToday()
        || pilot.criteria.recordCap > discoveryPolicy.maxRecordCap || pilot.criteria.requestCap > discoveryPolicy.maxRequestCap
        || !source || source.activeRequestId || source.pausedUntil && source.pausedUntil > new Date()
        || source.blockedReason?.startsWith("UNCERTAIN") || source.blockedReason === "RESTART_IN_FLIGHT") throw new Error("Pilot approval/scope expired or source cooldown/uncertainty remains. No request sent.");
      if (pilot.stage === "CALENDAR_ONLY") {
        if (!isCalendarPreviewCriteria(pilot.criteria) || !calendarPreviewSourceAllowed(source)) {
          throw new Error("Calendar-only permit must match its saved exact criteria and unchanged SOURCE_VALIDATION_BARRIER. No request sent.");
        }
        const [activeJob] = await tx.select().from(discoveryJobsTable)
          .where(inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])).limit(1);
        if (activeJob) throw new Error("Another discovery job is active; no source request sent.");
      }
      const [created] = await tx.insert(discoveryJobsTable).values({
        ownerId: WORKSPACE_OWNER_ID, criteria: pilot.criteria, assessmentId: pilot.id,
        message: pilot.stage === "CALENDAR_ONLY"
          ? "One operator-approved Calendar Event preview queued. The global source barrier remains; PDFs and retries are disabled."
          : "Approved single-use pilot; broader collection remains disabled.",
      }).returning();
      await tx.update(discoverySourceTable).set({ collectionApprovedAt: null }).where(eq(discoverySourceTable.id, "UJS"));
      await tx.update(discoveryAssessmentsTable).set({ state: "ATTEMPTED", startedAt: new Date(), jobId: created!.id }).where(eq(discoveryAssessmentsTable.id, id));
      return created!;
    });
    jobId = job.id;
    try { await runJob(job, id); }
    finally {
      const [current] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
      const items = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id));
      const requests = await db.select().from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id));
      const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
      const validDocuments = items.filter((item) => ["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length;
      const failures = requests.filter((request) => request.outcome !== "OK").length;
      const ordered = [...requests].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      const timingValid = ordered.every((request, index) => !index || !!ordered[index - 1]!.completedAt
        && request.startedAt.getTime() >= ordered[index - 1]!.completedAt!.getTime() + discoveryPolicy.spacingMs);
       const [assessment] = await db.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, id));
       const inspection = diagnostic(assessment?.stage ?? "");
       const calendarOnly = assessment?.stage === "CALENDAR_ONLY";
       const inspectRequestCountValid = assessment?.stage === "INSPECT"
         ? requests.length >= 1 && requests.length <= 3 : requests.length === 3;
       const inspected = inspection && current?.status === "COMPLETED" && items.length === 0
         && !current.calendarComplete && inspectRequestCountValid && failures === 0 && timingValid
          && new Set(requests.map(request => request.path)).size === requests.length
         && requests.every(request => request.method === "GET" && request.durationMs !== null && request.durationMs < 20_000)
         && !source?.activeRequestId && !source?.latencyWarning;
       const calendarValidated = calendarOnly && isCalendarPreviewCriteria(assessment.criteria)
         && current?.status === "COMPLETED" && current.calendarComplete
         && requests.length > 0 && requests.length <= assessment.criteria.requestCap
         && requests.filter((request) => request.path === "/CaseSearch" && request.method === "POST").length === 1
         && requests.every((request) => request.outcome === "OK" && request.durationMs !== null
           && request.durationMs < 20_000 && calendarPreviewRequestAllowed(request.path, request.method))
         && items.every((item) => item.provenance.extractionOutcome === "UNPROCESSED")
         && failures === 0 && timingValid && !!source && calendarPreviewSourceAllowed(source)
         && !source.latencyWarning;
       const verified = !inspection && !calendarOnly && current?.status === "COMPLETED" && current.calendarComplete
        && validDocuments === job.criteria.recordCap && failures === 0 && requests.length > 0 && timingValid
        && requests.every((request) => request.durationMs !== null && request.durationMs < 20_000)
        && !source?.activeRequestId && !source?.latencyWarning;
      const completedAt = new Date();
       const state = inspected ? "INSPECTED" : calendarValidated ? "CALENDAR_VALIDATED" : verified ? "VERIFIED" : "FAILED";
       const report = { requests: requests.length, validDocuments, failures,
         reason: calendarValidated
           ? `One approved Calendar Event search completed with ${items.length} validated calendar row(s). No PDFs, bail extraction, or collection approval. SOURCE_VALIDATION_BARRIER remains unchanged.`
           : inspected ? (assessment?.stage === "FILING_INSPECT"
             ? "Bounded public widget inventory after filing mode, Advanced Search and local County = Allegheny, with redacted displayed public office codes only. No private option values or identities, other county, court/case/office selection, Search, dates, dependent transmission, remote POST, PDF or submitted binding proof. Numeric district codes alone do not establish MDJ context. Collection disabled; existing source state preserved."
           : assessment?.stage === "COVERAGE"
           ? "Public method/office/date constraints observed; no Search click, remote POST, PDF or discovery proof. Existing source pause and access proof unchanged."
           : "Read-only public form metadata inspected without invoking submission. No Search click, POST, results, or PDFs. Not access proof. Existing source state unchanged; collection remains disabled.")
           : verified ? "Both integrated clients passed within fixed scope and timing; not approval for broader collection."
           : calendarOnly && source?.latencyWarning
             ? "LATENCY_WARNING: preview stopped after a slow response; no further requests authorized, no automatic retry, and SOURCE_VALIDATION_BARRIER remains unchanged."
             : "Pilot did not pass all document, timing, accounting, completion, and latency checks. No automatic retry or collection enablement." };
      await db.transaction(async (tx) => {
        await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
         await tx.update(discoveryAssessmentsTable).set({ state, completedAt, report }).where(eq(discoveryAssessmentsTable.id, id));
        if (verified) await tx.update(discoverySourceTable).set({
          accessVerifiedAt: completedAt, verifiedMethod: integratedSourceMethod, collectionApprovedAt: null,
          blockedReason: null, pausedUntil: null,
        }).where(eq(discoverySourceTable.id, "UJS"));
      });
       console.log(JSON.stringify({ id, jobId, state, report, collectionApproved: false }));
    }
  } finally {
    if (acquired) await lease.query("SELECT pg_advisory_unlock(74651283)");
    lease.release();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Pilot stopped."); process.exitCode = 1; }).finally(() => pool.end());
