import { and, eq } from "drizzle-orm";
import { db, discoveryAssessmentsTable as permits, discoveryEventsTable as events,
  discoveryItemsTable as items, discoveryJobsTable as jobs, discoveryRequestsTable as requests,
  discoverySourceTable as sources } from "@workspace/db";
import { discoveryPolicy } from "./discovery";
import { calendarPreviewSourceAllowed } from "./discovery-safety";
import { boundedEngineMethod, boundedObservationCanContinue, validBoundedEngineCriteria } from "./bounded-engine";
import { validCourtroomObservationMetadata } from "./courtroom-observation";

/** Report an attempted delegated run without creating global access proof. */
export async function finishBoundedRun(jobId: string, permitId: string, store = db) {
  const [job] = await store.select().from(jobs).where(eq(jobs.id, jobId));
  const [permit] = await store.select().from(permits).where(eq(permits.id, permitId));
  if (!job || !permit || permit.jobId !== jobId || job.assessmentId !== permitId
    || permit.stage !== "BOUNDED_ENGINE" || permit.expectedMethod !== boundedEngineMethod
    || permit.state !== "ATTEMPTED") throw new Error("Bounded report scope mismatch");
  const [ledger, found, history, sourceRows] = await Promise.all([
    store.select().from(requests).where(eq(requests.jobId, jobId)),
    store.select().from(items).where(eq(items.jobId, jobId)),
    store.select().from(events).where(eq(events.jobId, jobId)),
    store.select().from(sources).where(eq(sources.id, "UJS")),
  ]);
  const ordered = ledger.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const timing = ordered.every((row, i) => !!row.completedAt && row.outcome === "OK"
    && row.durationMs !== null && row.durationMs < 20_000
    && (!i || row.startedAt.getTime() >= ordered[i - 1]!.completedAt!.getTime() + discoveryPolicy.spacingMs));
  const observations = history.filter(e => e.kind === "COURTROOM_METADATA");
  const metadata = observations.length === 1 ? JSON.parse(observations[0]!.message) as Record<string, unknown> : null;
  const observedRequests = observations.length === 1
    ? ordered.filter(r => r.startedAt <= observations[0]!.createdAt).length : 0;
  const validDocuments = found.filter(item => ["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length;
  const passed = validBoundedEngineCriteria(permit.criteria) && job.status === "COMPLETED" && job.calendarComplete
    && !!metadata && validCourtroomObservationMetadata(metadata)
    && boundedObservationCanContinue(metadata.outcome, observedRequests)
    && timing && ordered.length > 0 && ordered.length <= permit.criteria.requestCap
    && ordered.filter(r => r.method === "POST" && r.path === "/CaseSearch").length === 1
    && ordered.filter(r => r.path === "/Report/CpDocketSheet").length <= 5
    && validDocuments > 0 && !!sourceRows[0] && calendarPreviewSourceAllowed(sourceRows[0]);
  const diagnostic = history.find(e => e.kind === "CALENDAR_RESPONSE_DIAGNOSTIC");
  const summary = diagnostic ? JSON.parse(diagnostic.message) as Record<string, unknown> : null;
  const report = {
    requests: ordered.length, validDocuments,
    failures: ordered.filter(r => r.outcome !== "OK").length,
    reason: passed
      ? `Scoped run completed with ${validDocuments} identity-checked documents. Evidence is unreviewed; no custody or operative-order claim. Global source barrier unchanged.`
      : `Scoped workflow not demonstrated. Parser: ${String(summary?.parserOutcome ?? "NOT_RUN")}; document eligibility: ${String(summary?.documentEligibility ?? "NOT_ESTABLISHED")}; stop gate: ${String(summary?.stopGate ?? "NOT_RECORDED")}. ${validDocuments} valid documents. No automatic retry or collection enablement.`,
  };
  await store.update(permits).set({ state: passed ? "BOUNDED_COMPLETED" : "FAILED", completedAt: new Date(), report })
    .where(and(eq(permits.id, permitId), eq(permits.state, "ATTEMPTED")));
  return report;
}
