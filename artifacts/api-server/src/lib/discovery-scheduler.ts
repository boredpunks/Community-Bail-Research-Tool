import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db, discoveryAssessmentsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, type DiscoveryJobRow } from "@workspace/db";
import { discoveryPolicy } from "./discovery";
import {
  allowedSourceRequest, calendarPreviewMethod, calendarPreviewRequestAllowed,
  calendarPreviewSourceAllowed, collectionBlock, integratedSourceMethod,
  isCalendarPreviewCriteria, paceEligibleAt, responseHealth, rollingUsage,
  throttleDeadline, validAccountingMessage,
} from "./discovery-safety";
import { formInspectionLiveEnabled, formInspectionMethod, inspectionRequestAllowed } from "./form-inspection";
import { coverageInspectionMethod } from "./coverage-inspection";
import { coverageMethod, courtroomObservationMethod, validCourtroomObservationCriteria } from "./courtroom-observation";
import { filingInspectionMethod } from "./filing-inspection";
import { boundedEngineMethod, validBoundedEngineCriteria } from "./bounded-engine";
import { researchMethod, proofMethod, proofUrls, validResearchCriteria, researchSpacingMs } from "./research-scope";

const sourceId = "UJS";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export type SchedulerTestContext = { store?: typeof db; now?: () => Date; sleep?: (ms: number) => Promise<void> };

// Lock order is always source -> job -> permit. Sleep OUTSIDE transactions and
// recheck under the same source lock before reserving a transmission slot.
export async function reserveSourceRequest(job: DiscoveryJobRow, requestPath: unknown, method: unknown, permitId: unknown, url: unknown, stopping: () => boolean, context: SchedulerTestContext = {}) {
  if (!allowedSourceRequest(url, method) || typeof url !== "string" || new URL(url).pathname !== requestPath
    || typeof permitId === "number") return { allow: false, reason: "REQUEST_NOT_PERMITTED" };
  while (!stopping()) {
    const decision = await (context.store ?? db).transaction(async (tx) => {
      const now = context.now?.() ?? new Date();
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).for("update");
      const [current] = await tx.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id)).for("update");
      const deny = async (reason: string) => {
        if (current?.status === "RUNNING") await tx.update(discoveryJobsTable).set({
          status: "PAUSED", updatedAt: now, message: `${reason}: source request not sent. Explicit approval/resume required; budgets unchanged.`,
        }).where(eq(discoveryJobsTable.id, current.id));
        return { allow: false as const, reason };
      };
      if (!current || current.status !== "RUNNING" || stopping()) return { allow: false as const, reason: "JOB_STOPPED" };
      if (!source) return deny("ACCESS_UNVERIFIED");
      if (current.resultsExpiredAt) return deny("RESULTS_EXPIRED");
      if (current.requestsUsed >= current.criteria.requestCap) return deny("JOB_REQUEST_LIMIT");
      let calendarOnlyPermit = false;
      let diagnosticPermit = false;
      let boundedPermit = false;
      let researchPermit = false;
      let proofPermit = false;
      if (current.assessmentId) {
        const [permit] = await tx.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, current.assessmentId)).for("update");
        const expectedMethod = permit?.stage === "RESEARCH_RUN" ? researchMethod
          : permit?.stage === "RESEARCH_PROOF" ? proofMethod
          : permit?.stage === "BOUNDED_ENGINE" ? boundedEngineMethod
          : permit?.stage === "FILING_INSPECT" ? filingInspectionMethod
          : permit?.stage === "COVERAGE" ? coverageMethod(permit.criteria)
          : permit?.stage === "INSPECT" ? formInspectionMethod
          : permit?.stage === "CALENDAR_ONLY" ? calendarPreviewMethod
          : integratedSourceMethod;
        if (permitId !== current.assessmentId || !permit || permit.state !== "ATTEMPTED"
          || permit.jobId !== current.id || permit.expectedMethod !== expectedMethod
          || !permit.approvedAt || !permit.expiresAt || permit.expiresAt <= now
          || JSON.stringify(permit.criteria) !== JSON.stringify(current.criteria)) return deny("ASSESSMENT_NOT_APPROVED");
        if (permit.stage === "CALENDAR_ONLY"
          && (!isCalendarPreviewCriteria(permit.criteria) || !isCalendarPreviewCriteria(current.criteria)
            || current.criteria.startDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
            // In-flight requests still use the shared wait/uncertainty checks below.
            || !calendarPreviewSourceAllowed(source, now, true)
            || !calendarPreviewRequestAllowed(requestPath, method))) {
          return deny("CALENDAR_PREVIEW_SCOPE_INVALID");
        }
        calendarOnlyPermit = permit.stage === "CALENDAR_ONLY";
        researchPermit = permit.stage === "RESEARCH_RUN";
        proofPermit = permit.stage === "RESEARCH_PROOF";
        if ((researchPermit || proofPermit) && (!validResearchCriteria(current.criteria, proofPermit)
          || current.criteria.startDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
          || !calendarPreviewSourceAllowed(source, now, true)
          || proofPermit && (method !== "GET" || typeof url !== "string" || !proofUrls.includes(url))))
          return deny("RESEARCH_SCOPE_INVALID");
        if (researchPermit) {
          const proofId = (current.criteria as unknown as Record<string, unknown>).proofPermitId;
          const [proof] = await tx.select().from(discoveryAssessmentsTable)
            .where(eq(discoveryAssessmentsTable.id, String(proofId)));
          if (!proof || proof.stage !== "RESEARCH_PROOF" || proof.expectedMethod !== proofMethod
            || proof.state !== "REGRESSION_VERIFIED" || proof.criteria.startDate !== current.criteria.startDate
            || !proof.expiresAt || proof.expiresAt <= now) return deny("REAL_PDF_REGRESSION_REQUIRED");
        }
        boundedPermit = permit.stage === "BOUNDED_ENGINE" || researchPermit;
        if (permit.stage === "BOUNDED_ENGINE" && (!validBoundedEngineCriteria(current.criteria)
          || current.criteria.startDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
          || !calendarPreviewSourceAllowed(source, now, true)))
          return deny("BOUNDED_ENGINE_SCOPE_INVALID");
        if (permit.expectedMethod === courtroomObservationMethod
          && (!validCourtroomObservationCriteria(current.criteria)
            || !calendarPreviewSourceAllowed(source, now, true)))
          return deny("COURTROOM_OBSERVATION_SCOPE_INVALID");
        diagnosticPermit = ["INSPECT", "COVERAGE", "FILING_INSPECT"].includes(permit.stage);
        if (["INSPECT", "COVERAGE", "FILING_INSPECT"].includes(permit.stage) && (current.criteria.requestCap !== 3
          || current.criteria.startDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
          || !inspectionRequestAllowed(requestPath, method))) return deny("INSPECTION_REQUEST_NOT_PERMITTED");
        if (permit.stage === "INSPECT" && !formInspectionLiveEnabled)
          return deny("FORM_INSPECTION_LIVE_DISABLED");
        if (source.pausedUntil && source.pausedUntil > now) return deny("SOURCE_COOLDOWN");
        if (source.blockedReason?.startsWith("UNCERTAIN") || source.blockedReason === "RESTART_IN_FLIGHT") return deny("UNCERTAIN_SOURCE_STATE");
      } else {
        if (permitId) return deny("ASSESSMENT_NOT_APPROVED");
        const block = collectionBlock(source, now);
        if (block) return deny(block);
      }
      if (diagnosticPermit || boundedPermit && method === "GET" && !["/Report/CpDocketSheet", "/Report/MdjDocketSheet"].includes(String(requestPath))) {
        const [priorPath] = await tx.select({ id: discoveryRequestsTable.id })
          .from(discoveryRequestsTable)
          .where(and(
            eq(discoveryRequestsTable.jobId, current.id),
            eq(discoveryRequestsTable.path, String(requestPath)),
          ))
          .limit(1);
        if (priorPath) return deny("INSPECTION_PATH_ALREADY_ATTEMPTED");
      }
      const recent = await tx.select().from(discoveryRequestsTable).where(and(
        eq(discoveryRequestsTable.sourceId, sourceId), gt(discoveryRequestsTable.startedAt, new Date(now.getTime() - 86_400_000)),
      ));
      const [pending] = await tx.select().from(discoveryRequestsTable).where(and(eq(discoveryRequestsTable.sourceId, sourceId), eq(discoveryRequestsTable.outcome, "IN_FLIGHT"))).limit(1);
      if (source.activeRequestId || pending) {
        if (!pending || pending.startedAt.getTime() + 90_000 < now.getTime()) {
          await tx.update(discoverySourceTable).set({ blockedReason: "UNCERTAIN_SOURCE_STATE", collectionApprovedAt: null }).where(eq(discoverySourceTable.id, sourceId));
          return deny("UNCERTAIN_SOURCE_STATE");
        }
        return { waitMs: 1000 };
      }
      const scoped = researchPermit || proofPermit;
      const usage = rollingUsage(recent.map((request) => request.startedAt), now,
        scoped ? Math.max(154, discoveryPolicy.hourlyRequestCap) : discoveryPolicy.hourlyRequestCap,
        scoped ? Math.max(154, discoveryPolicy.dailyRequestCap) : discoveryPolicy.dailyRequestCap);
      if (usage.blockedReason) return deny(`${usage.blockedReason}; next eligible ${usage.nextEligibleAt!.toISOString()}`);
      const eligibleAt = paceEligibleAt(scoped ? {...source, adaptiveSpacingMs: researchSpacingMs} : source,
        scoped ? researchSpacingMs : discoveryPolicy.spacingMs);
      if (eligibleAt && eligibleAt > now) return { waitMs: Math.min(1000, eligibleAt.getTime() - now.getTime()) };
      let itemId: string | null = null;
      const resourceKey = createHash("sha256").update(`${method}|${url}`).digest("hex");
      if (requestPath === "/Report/CpDocketSheet" || requestPath === "/Report/MdjDocketSheet") {
        if (boundedPermit) {
          if (!current.calendarComplete) return deny("CALENDAR_NOT_VALIDATED");
          const attempted = await tx.select({ id: discoveryRequestsTable.id }).from(discoveryRequestsTable)
            .where(and(eq(discoveryRequestsTable.jobId, current.id), inArray(discoveryRequestsTable.path, ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"])));
          if (attempted.length >= current.criteria.recordCap) return deny("DOCUMENT_CAP_REACHED");
          const ordered = await tx.select().from(discoveryItemsTable)
            .where(eq(discoveryItemsTable.jobId, current.id)).orderBy(asc(discoveryItemsTable.position));
          const next = ordered.find(item => item.provenance.extractionOutcome === "UNPROCESSED");
          if (!next || next.sourceUrl !== url) return deny("DOCUMENT_ORDER_MISMATCH");
        }
        const [item] = await tx.select().from(discoveryItemsTable).where(and(
          eq(discoveryItemsTable.jobId, current.id), eq(discoveryItemsTable.sourceUrl, url),
        )).for("update");
        if (!proofPermit && (!item || item.provenance.extractionOutcome !== "UNPROCESSED")) return deny("DOCUMENT_NOT_PENDING");
        const [prior] = await tx.select().from(discoveryRequestsTable).where(and(eq(discoveryRequestsTable.jobId, current.id), eq(discoveryRequestsTable.resourceKey, resourceKey))).limit(1);
        if (prior) return deny("DOCUMENT_ALREADY_ATTEMPTED");
        itemId = item?.id ?? null;
      } else {
        if (current.calendarComplete) return deny("CALENDAR_ALREADY_CHECKPOINTED");
        if ((calendarOnlyPermit || boundedPermit) && requestPath === "/CaseSearch" && method === "POST") {
          const [priorSearch] = await tx.select({ id: discoveryRequestsTable.id })
            .from(discoveryRequestsTable)
            .where(and(
              eq(discoveryRequestsTable.jobId, current.id),
              eq(discoveryRequestsTable.path, "/CaseSearch"),
              eq(discoveryRequestsTable.method, "POST"),
            ))
            .limit(1);
          if (priorSearch) return deny("CALENDAR_SEARCH_ALREADY_SUBMITTED");
        }
      }
      const [request] = await tx.insert(discoveryRequestsTable).values({
        jobId: current.id, ownerId: current.ownerId, sourceId, path: String(requestPath), method: String(method), resourceKey, itemId, startedAt: now,
      }).returning();
      await tx.update(discoverySourceTable).set({
        activeRequestId: request!.id, lastRequestAt: now,
        ...(!current.assessmentId && source.blockedReason === "RATE_LIMIT" ? { blockedReason: null, pausedUntil: null } : {}),
      }).where(eq(discoverySourceTable.id, sourceId));
      await tx.update(discoveryJobsTable).set({
        requestsUsed: current.requestsUsed + 1, updatedAt: now,
        message: `Request ${current.requestsUsed + 1}/${current.criteria.requestCap}: ${method} ${requestPath}. All transmitted assets count.`,
      }).where(eq(discoveryJobsTable.id, current.id));
      return { allow: true as const, requestId: request!.id };
    });
    if ("waitMs" in decision) { await (context.sleep ?? sleep)(decision.waitMs!); continue; }
    return decision;
  }
  return { allow: false, reason: "WORKER_STOPPED" };
}

export async function accountSourceResponse(job: DiscoveryJobRow, message: Record<string, unknown>, context: SchedulerTestContext = {}) {
  if (!validAccountingMessage(message)) {
    throw new Error("Malformed source response accounting");
  }
  const calendarOnlyPreview = !!job.assessmentId
    && (isCalendarPreviewCriteria(job.criteria) || validBoundedEngineCriteria(job.criteria));
  return (context.store ?? db).transaction(async (tx) => {
    const now = context.now?.() ?? new Date();
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).for("update");
    const [request] = await tx.select().from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.id, String(message.requestId)), eq(discoveryRequestsTable.jobId, job.id),
      eq(discoveryRequestsTable.outcome, "IN_FLIGHT"),
    )).for("update");
    if (!source || !request || source.activeRequestId !== request.id) throw new Error("Source response has no reserved slot");
    const durationMs = Math.min(2_147_483_647, Math.max(0, now.getTime() - request.startedAt.getTime()));
    const recent = await tx.select({ duration: discoveryRequestsTable.durationMs }).from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.sourceId, sourceId), eq(discoveryRequestsTable.outcome, "OK"),
    )).orderBy(desc(discoveryRequestsTable.completedAt)).limit(20);
    const health = responseHealth(source, durationMs, recent.flatMap((row) => row.duration === null ? [] : [row.duration]), discoveryPolicy.spacingMs);
    const outcome = String(message.outcome);
    const slowCalendarPreview = calendarOnlyPreview && outcome === "OK" && durationMs >= 20_000;
    const block = outcome === "OK" ? (slowCalendarPreview ? "LATENCY_WARNING" : health.blockedReason) : outcome;
    const throttle = outcome === "RATE_LIMIT";
    await tx.update(discoveryRequestsTable).set({
      outcome, statusCode: message.status as number | null, completedAt: now, durationMs,
    }).where(eq(discoveryRequestsTable.id, request.id));
    // Complete accounting AND apply the stop in the same source-locked
    // transaction. No competing grant can enter between these operations.
    await tx.update(discoverySourceTable).set({
      activeRequestId: null, lastCompletedAt: now, lastLatencyMs: durationMs,
      ...health, blockedReason: slowCalendarPreview && source.blockedReason === "SOURCE_VALIDATION_BARRIER"
        ? source.blockedReason : block ?? source.blockedReason,
      ...(block ? {
        pausedUntil: throttle ? throttleDeadline(now, discoveryPolicy.cooldownMs, source.throttleCount, message.retryAfter) : null,
        ...(throttle ? {
          throttleCount: source.throttleCount + 1,
          adaptiveSpacingMs: Math.min(3_600_000, Math.max(discoveryPolicy.spacingMs, source.adaptiveSpacingMs) * 2),
          latencyWarning: "Throttling observed. Slower pacing retained; explicit resume required after cooldown.",
        } : { accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null }),
      } : {}),
    }).where(eq(discoverySourceTable.id, sourceId));
    if (block) {
      await tx.update(discoveryJobsTable).set({
        status: "PAUSED", updatedAt: now,
        message: `${block}: all source traffic stopped. No automatic retry or workaround; partial evidence and consumed slots retained.`,
      }).where(inArray(discoveryJobsTable.status, ["RUNNING", "QUEUED"]));
    }
    const [current] = await tx.select({ status: discoveryJobsTable.status }).from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
    return !block && current?.status === "RUNNING";
  });
}

export async function recoverUncertainRequests(context: SchedulerTestContext = {}) {
  await (context.store ?? db).transaction(async (tx) => {
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).for("update");
    if (!source) return;
    const uncertain = await tx.update(discoveryRequestsTable).set({
      outcome: "UNCERTAIN_AFTER_RESTART", completedAt: context.now?.() ?? new Date(),
    }).where(and(eq(discoveryRequestsTable.sourceId, sourceId), eq(discoveryRequestsTable.outcome, "IN_FLIGHT"))).returning();
    if (uncertain.length || source.activeRequestId) await tx.update(discoverySourceTable).set({
      activeRequestId: null, blockedReason: "RESTART_IN_FLIGHT", pausedUntil: null, collectionApprovedAt: null,
    }).where(eq(discoverySourceTable.id, sourceId));
  });
}
