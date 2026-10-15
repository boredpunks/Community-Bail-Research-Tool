import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, discoveryAssessmentsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, type DiscoveryJobRow } from "@workspace/db";
import { discoveryPolicy } from "./discovery";
import {
  allowedSourceRequest, calendarPreviewMethod, calendarPreviewRequestAllowed,
  calendarPreviewSourceAllowed, collectionBlock, integratedSourceMethod,
  isCalendarPreviewCriteria, paceEligibleAt, responseHealth, rollingUsage,
  throttleDeadline, validAccountingMessage,
} from "./discovery-safety";
import { formInspectionMethod, inspectionRequestAllowed } from "./form-inspection";
import { coverageInspectionMethod } from "./coverage-inspection";
import { filingInspectionMethod } from "./filing-inspection";

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
      if (current.assessmentId) {
        const [permit] = await tx.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, current.assessmentId)).for("update");
        const expectedMethod = permit?.stage === "FILING_INSPECT" ? filingInspectionMethod
          : permit?.stage === "COVERAGE" ? coverageInspectionMethod
          : permit?.stage === "INSPECT" ? formInspectionMethod
          : permit?.stage === "CALENDAR_ONLY" ? calendarPreviewMethod
          : integratedSourceMethod;
        if (permitId !== current.assessmentId || !permit || permit.state !== "ATTEMPTED"
          || permit.jobId !== current.id || permit.expectedMethod !== expectedMethod
          || !permit.approvedAt || !permit.expiresAt || permit.expiresAt <= now
          || JSON.stringify(permit.criteria) !== JSON.stringify(current.criteria)) return deny("ASSESSMENT_NOT_APPROVED");
        if (permit.stage === "CALENDAR_ONLY"
          && (!isCalendarPreviewCriteria(permit.criteria) || !isCalendarPreviewCriteria(current.criteria)
            || !calendarPreviewSourceAllowed(source, now)
            || !calendarPreviewRequestAllowed(requestPath, method))) {
          return deny("CALENDAR_PREVIEW_SCOPE_INVALID");
        }
        calendarOnlyPermit = permit.stage === "CALENDAR_ONLY";
        if (["INSPECT", "COVERAGE", "FILING_INSPECT"].includes(permit.stage) && (current.criteria.requestCap !== 3
          || current.criteria.startDate < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
          || !inspectionRequestAllowed(requestPath, method))) return deny("INSPECTION_REQUEST_NOT_PERMITTED");
        if (source.pausedUntil && source.pausedUntil > now) return deny("SOURCE_COOLDOWN");
        if (source.blockedReason?.startsWith("UNCERTAIN") || source.blockedReason === "RESTART_IN_FLIGHT") return deny("UNCERTAIN_SOURCE_STATE");
      } else {
        if (permitId) return deny("ASSESSMENT_NOT_APPROVED");
        const block = collectionBlock(source, now);
        if (block) return deny(block);
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
      const usage = rollingUsage(recent.map((request) => request.startedAt), now, discoveryPolicy.hourlyRequestCap, discoveryPolicy.dailyRequestCap);
      if (usage.blockedReason) return deny(`${usage.blockedReason}; next eligible ${usage.nextEligibleAt!.toISOString()}`);
      const eligibleAt = paceEligibleAt(source, discoveryPolicy.spacingMs);
      if (eligibleAt && eligibleAt > now) return { waitMs: Math.min(1000, eligibleAt.getTime() - now.getTime()) };
      let itemId: string | null = null;
      const resourceKey = createHash("sha256").update(`${method}|${url}`).digest("hex");
      if (requestPath === "/Report/CpDocketSheet") {
        const [item] = await tx.select().from(discoveryItemsTable).where(and(
          eq(discoveryItemsTable.jobId, current.id), eq(discoveryItemsTable.sourceUrl, url),
        )).for("update");
        if (!item || item.provenance.extractionOutcome !== "UNPROCESSED") return deny("DOCUMENT_NOT_PENDING");
        const [prior] = await tx.select().from(discoveryRequestsTable).where(and(eq(discoveryRequestsTable.jobId, current.id), eq(discoveryRequestsTable.resourceKey, resourceKey))).limit(1);
        if (prior) return deny("DOCUMENT_ALREADY_ATTEMPTED");
        itemId = item.id;
      } else {
        if (current.calendarComplete) return deny("CALENDAR_ALREADY_CHECKPOINTED");
        if (calendarOnlyPermit && requestPath === "/CaseSearch" && method === "POST") {
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
    const block = outcome === "OK" ? health.blockedReason : outcome;
    const throttle = outcome === "RATE_LIMIT";
    await tx.update(discoveryRequestsTable).set({
      outcome, statusCode: message.status as number | null, completedAt: now, durationMs,
    }).where(eq(discoveryRequestsTable.id, request.id));
    // Complete accounting AND apply the stop in the same source-locked
    // transaction. No competing grant can enter between these operations.
    await tx.update(discoverySourceTable).set({
      activeRequestId: null, lastCompletedAt: now, lastLatencyMs: durationMs,
      ...health, blockedReason: block ?? source.blockedReason,
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
