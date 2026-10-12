import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { bailRecordsTable, db, discoveryAssessmentsTable, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoverySourceTable } from "@workspace/db";
import {
  ControlDiscoveryJobBody, ControlDiscoveryJobParams, ControlDiscoveryJobResponse,
  CreateDiscoveryJobBody, CreateDiscoveryJobResponse, GetDiscoveryJobParams,
  GetDiscoveryJobResponse, GetDiscoveryPolicyResponse, ListDiscoveryJobsResponse,
  SaveDiscoveryObservationBody, SaveDiscoveryObservationParams, SaveDiscoveryObservationResponse,
  SaveDiscoveryCandidatesBody, SaveDiscoveryCandidatesParams, SaveDiscoveryCandidatesResponse,
  ListDiscoveryAssessmentsResponse,
} from "@workspace/api-zod";
import { actualDate, discoveryEvent, discoveryPolicy, easternToday, jobSummary } from "../lib/discovery";
import { serializeBailRecord } from "../lib/bail-records";
import { getWorkspaceIdentity, requireResearchAuth, requireSameOrigin } from "../middlewares/researchAuth";
import { collectionBlock, resultsDeadline } from "../lib/discovery-safety";
import { discoverySourceStatus, sourceAdmissionBlock } from "../lib/discovery-source-status";
import { clearExpiredDiscoveryResults, expiredResumeConflict } from "../lib/discovery-retention";
import { candidateEligible, observationValues } from "../lib/discovery-candidates";

const router: IRouter = Router();
router.use(requireResearchAuth, requireSameOrigin);

router.get("/discovery/policy", async (_req, res): Promise<void> => {
  const payload = {
    adapter: "UJS public browser calendar + standard public HTTP, identity-checked Common Pleas PDF",
    minimumDate: easternToday(), spacingMs: discoveryPolicy.spacingMs,
    concurrency: 1, automaticRetries: 0,
    defaultRecordCap: Math.min(5, discoveryPolicy.maxRecordCap), maxRecordCap: discoveryPolicy.maxRecordCap,
    defaultRequestCap: Math.min(12, discoveryPolicy.maxRequestCap), maxRequestCap: discoveryPolicy.maxRequestCap,
    ...await discoverySourceStatus(),
    calendarRequestAllowance: 8,
    coverageNote: "Supported adapter scope, not fresh access proof: Allegheny Common Pleas (CP-05-02-Crim), Bail Hearing, today/future windows up to 7 days. Integrated calendar and PDF access must be separately verified and collection approved. Historical dates, MDJ and Preliminary Arraignments are unproven. Only demonstrated bail layouts are extracted; ambiguous/deposit-bearing rows fail closed. No custody, operative-order, completeness or freshness claim. Remote pagination is not traversed. Required browser assets count; unnecessary assets are blocked before transmission. Hourly/daily quotas and adaptive pacing are conservative local controls, not published court limits. Targets, dates and budgets do not expand automatically.",
  };
  GetDiscoveryPolicyResponse.parse(payload);
  res.json(payload);
});

router.get("/discovery/jobs", async (_req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const { ownerIds } = getWorkspaceIdentity(res);
  const rows = await db.select().from(discoveryJobsTable).where(inArray(discoveryJobsTable.ownerId, ownerIds)).orderBy(desc(discoveryJobsTable.createdAt)).limit(100);
  const payload = await Promise.all(rows.map(jobSummary));
  ListDiscoveryJobsResponse.parse(payload);
  res.json(payload);
});

router.get("/discovery/assessments", async (_req, res): Promise<void> => {
  // Operator-only diagnostics are not public staged access proofs. Keep the
  // existing API contract and stage list limited to its three PDF stages.
  const rows = await db.select().from(discoveryAssessmentsTable)
    .where(inArray(discoveryAssessmentsTable.stage, ["SINGLE", "SMALL", "MODEST"]))
    .orderBy(desc(discoveryAssessmentsTable.createdAt)).limit(30);
  const payload = rows.map((row) => ({
    id: row.id, stage: row.stage, state: row.state, criteria: row.criteria, expectedMethod: row.expectedMethod,
    approvedAt: row.approvedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null, report: row.report,
  }));
  ListDiscoveryAssessmentsResponse.parse(payload);
  res.json(payload);
});

router.post("/discovery/jobs", async (req, res): Promise<void> => {
  const body = CreateDiscoveryJobBody.safeParse(req.body);
  const { startDate, endDate } = req.body ?? {};
  if (!body.success || !actualDate(startDate) || !actualDate(endDate)
    || startDate < easternToday() || endDate < startDate
    || (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 > 6) {
    res.status(400).json({ error: "Use supported court/event choices and a real today-or-future calendar window of at most seven days. Historical dates are not substituted." }); return;
  }
  if (body.data.recordCap > discoveryPolicy.maxRecordCap || body.data.requestCap > discoveryPolicy.maxRequestCap) {
    res.status(400).json({ error: "Your explicit budget exceeds protected operator limits." }); return;
  }
  if (!body.data.matchFilters || !body.data.matchTarget || body.data.matchTarget > body.data.recordCap) {
    res.status(400).json({ error: "New jobs require fixed matching filters and a matching-docket target no greater than the document-processing safety cap." }); return;
  }
  if (body.data.matchFilters.inclusiveMaximum === false) {
    res.status(400).json({ error: "New maximum-bail searches use an inclusive maximum. Legacy jobs keep their original comparison." }); return;
  }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  const availability = await discoverySourceStatus();
  if (!availability.collectionEnabled) { res.status(409).json({ error: `Source-wide stop: ${availability.blockedReason}. No collection authorized.` }); return; }
  // Serialize shared-workspace job creation without depending on frontend button state.
  const result = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
    if (await sourceAdmissionBlock(tx, source)) return null;
    await tx.execute(`SELECT pg_advisory_xact_lock(hashtext('ujs-job-creation'))`);
    const [active] = await tx.select().from(discoveryJobsTable).where(and(inArray(discoveryJobsTable.ownerId, ownerIds), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
    if (active) return null;
    const [job] = await tx.insert(discoveryJobsTable).values({
      ownerId, criteria: { ...body.data, startDate, endDate, matchFilters: { ...body.data.matchFilters!, inclusiveMaximum: true } }, message: "Explicit live job queued. Saved-record searches do not collect data.",
    }).returning();
    return job!;
  });
  if (!result) { res.status(409).json({ error: "Collection is unavailable or another job is active. Refresh source status; no source request was sent." }); return; }
  await discoveryEvent(result, "QUEUED", `Target: ${result.criteria.matchTarget} matching dockets with fixed local filters. Safety budget: ${result.criteria.requestCap} total requests; ${result.criteria.recordCap} processed documents. One request at a time; at least ${discoveryPolicy.spacingMs / 1000}s after the previous response completes; no automatic retries.`);
  const payload = await jobSummary(result);
  CreateDiscoveryJobResponse.parse(payload);
  res.status(201).json(payload);
});

router.get("/discovery/jobs/:jobId", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = GetDiscoveryJobParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Job not found." }); return; }
  const { ownerIds } = getWorkspaceIdentity(res);
  const [job] = await db.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds)));
  if (!job) { res.status(404).json({ error: "Job not found in the shared workspace." }); return; }
  const [items, events, saved] = await Promise.all([
    db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), inArray(discoveryItemsTable.ownerId, ownerIds))).orderBy(asc(discoveryItemsTable.position)),
    db.select().from(discoveryEventsTable).where(and(eq(discoveryEventsTable.jobId, job.id), inArray(discoveryEventsTable.ownerId, ownerIds))).orderBy(asc(discoveryEventsTable.createdAt)),
    db.select({ id: bailRecordsTable.id, key: bailRecordsTable.discoveryKey, reviewStatus: bailRecordsTable.reviewStatus, orderInterpretation: bailRecordsTable.orderInterpretation }).from(bailRecordsTable).where(inArray(bailRecordsTable.ownerId, ownerIds)),
  ]);
  const payload = {
    job: await jobSummary(job),
    items: (job.resultsExpiredAt ? [] : items).map((item) => {
      const entries = item.provenance.extractionOutcome === "MISSING_BAIL_SECTION" ? [null] : item.provenance.entries;
      const savedObservations = entries.flatMap((entry, index) => {
        const key = createHash("sha256").update(JSON.stringify({ docket: item.docketNumber, excerpt: item.excerpt, entry })).digest("hex");
        return saved.filter((record) => record.key === key).map((record) => ({
          entryIndex: entry ? index : null, recordId: record.id, reviewStatus: record.reviewStatus, orderInterpretation: record.orderInterpretation,
        }));
      });
      return {
        id: item.id, docketNumber: item.docketNumber, position: item.position, sourceUrl: item.sourceUrl,
        sourceRetrievedAt: item.sourceRetrievedAt?.toISOString() ?? null,
        excerpt: item.excerpt, detail: item.detail, provenance: item.provenance,
        savedRecordIds: savedObservations.map((record) => record.recordId), savedObservations,
      };
    }),
    events: events.map((event) => ({ kind: event.kind, message: event.message, createdAt: event.createdAt.toISOString() })),
  };
  GetDiscoveryJobResponse.parse(payload);
  res.json(payload);
});

router.post("/discovery/jobs/:jobId/control", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = ControlDiscoveryJobParams.safeParse(req.params);
  const body = ControlDiscoveryJobBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose pause, cancel or resume." }); return; }
  if (body.data.action === "RESUME") {
    const availability = await discoverySourceStatus();
    if (!availability.collectionEnabled) { res.status(409).json({ error: `Source-wide stop: ${availability.blockedReason}. No collection authorized.` }); return; }
  }
  const result = await db.transaction(async (tx) => {
    const { ownerIds } = getWorkspaceIdentity(res);
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
    const [job] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds))).for("update");
    if (!job) return { error: "Job not found in the shared workspace.", status: 404 };
    const action = body.data.action;
    if (action === "RESUME") {
      if (job.assessmentId) return { error: "Pilot permits are single-use and operator-only. They cannot be resumed from this endpoint.", status: 409 };
      const expired = expiredResumeConflict(job);
      if (expired) return expired;
      if (!["PAUSED", "CANCELLED", "FAILED"].includes(job.status)) return { error: "Only a stopped job can resume.", status: 409 };
      if (job.requestsUsed >= job.criteria.requestCap) return { error: "Original request budget is exhausted. It will not be silently increased.", status: 409 };
      const block = await sourceAdmissionBlock(tx, source);
      if (block || source?.activeRequestId) return { error: `Source-wide stop: ${block ?? "REQUEST_IN_FLIGHT"}. No source requests authorized.`, status: 409 };
      if (!job.calendarComplete && job.criteria.startDate < easternToday()) return { error: "The original calendar date is no longer supported. This job cannot silently switch dates.", status: 409 };
      const [active] = await tx.select().from(discoveryJobsTable).where(and(inArray(discoveryJobsTable.ownerId, ownerIds), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
      if (active) return { error: "Another job is active in the shared workspace.", status: 409 };
    } else if (!["QUEUED", "RUNNING", "PAUSED"].includes(job.status)) {
      return { error: "This job is already stopped.", status: 409 };
    }
    const status = action === "RESUME" ? "QUEUED" : action === "CANCEL" ? "CANCELLED" : "PAUSED";
    const [updated] = await tx.update(discoveryJobsTable).set({ status, updatedAt: new Date(), message: `${action}: partial results and original budgets preserved. An already-started source request may finish.` }).where(eq(discoveryJobsTable.id, job.id)).returning();
    await tx.insert(discoveryEventsTable).values({ jobId: job.id, ownerId: job.ownerId, kind: action, message: `${action} explicitly requested; completed evidence retained.` });
    return { job: updated!, status: 200 };
  });
  if (!("job" in result) || !result.job) { res.status(result.status).json({ error: result.error }); return; }
  const payload = await jobSummary(result.job);
  ControlDiscoveryJobResponse.parse(payload); res.json(payload);
});

router.post("/discovery/jobs/:jobId/items/:itemId/save", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = SaveDiscoveryObservationParams.safeParse(req.params);
  const body = SaveDiscoveryObservationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose an extracted bail entry to save." }); return; }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds))).for("update");
    if (!job) return { error: "Job not found.", status: 404 };
    if (job.resultsExpiredAt || (resultsDeadline(job) && resultsDeadline(job)! <= new Date())) return { error: "Unsaved results expired after 24 hours; saved candidates remain available.", status: 409 };
    const [item] = await tx.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.id, params.data.itemId), eq(discoveryItemsTable.jobId, job.id), inArray(discoveryItemsTable.ownerId, ownerIds)));
    if (!item) return { error: "Evidence not found.", status: 404 };
    const entry = body.data.entryIndex === null ? null : item.provenance.entries[body.data.entryIndex];
    if (!candidateEligible(item) || (item.provenance.extractionOutcome === "MISSING_BAIL_SECTION" ? body.data.entryIndex !== null : !entry)) return { error: "Only identity-checked extracted evidence or an explicit missing-bail-section outcome can be saved.", status: 400 };
    const values = observationValues(ownerId, item, entry ?? null);
    const [inserted] = await tx.insert(bailRecordsTable).values(values).onConflictDoNothing({ target: [bailRecordsTable.ownerId, bailRecordsTable.discoveryKey] }).returning();
    const record = inserted ?? (await tx.select().from(bailRecordsTable).where(and(eq(bailRecordsTable.ownerId, ownerId), eq(bailRecordsTable.discoveryKey, values.discoveryKey))))[0]!;
    return { record, status: 200 };
  });
  if (!("record" in result) || !result.record) { res.status(result.status).json({ error: result.error }); return; }
  const payload = serializeBailRecord(result.record);
  SaveDiscoveryObservationResponse.parse(payload); res.json(payload);
});

router.post("/discovery/jobs/:jobId/candidates", async (req, res): Promise<void> => {
  // This endpoint is deliberately source-evidence-only. It never starts or
  // resumes collection; the selected checkpoint is locked against retention.
  const params = SaveDiscoveryCandidatesParams.safeParse(req.params);
  const body = SaveDiscoveryCandidatesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose between 1 and 200 distinct dockets from this search." });
    return;
  }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(discoveryJobsTable)
      .where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds)))
      .for("update");
    if (!job) return { error: "Job not found in the shared workspace.", status: 404 as const };
    const deadline = resultsDeadline(job);
    if (job.resultsExpiredAt || (deadline && deadline <= new Date())) {
      return { error: "Unsaved results expired after 24 hours; saved candidates remain available.", status: 409 as const };
    }
    const items = await tx.select().from(discoveryItemsTable).where(and(
      eq(discoveryItemsTable.jobId, job.id),
      inArray(discoveryItemsTable.id, body.data.itemIds),
      inArray(discoveryItemsTable.ownerId, ownerIds),
    )).orderBy(asc(discoveryItemsTable.position));
    if (items.length !== body.data.itemIds.length) {
      return { error: "One or more selected dockets were not found in this search.", status: 404 as const };
    }
    if (items.some((item) => !candidateEligible(item))) {
      return { error: "Only identity-checked, source-backed dockets with extracted evidence can be saved.", status: 400 as const };
    }

    const observations = items.flatMap((item) => {
      const entries = item.provenance.extractionOutcome === "MISSING_BAIL_SECTION"
        ? [null] : item.provenance.entries;
      return entries.map((entry) => observationValues(ownerId, item, entry));
    });
    const valuesByKey = new Map(observations.map((value) => [value.discoveryKey, value]));
    const uniqueValues = [...valuesByKey.values()];
    await tx.insert(bailRecordsTable).values(uniqueValues)
      .onConflictDoNothing({ target: [bailRecordsTable.ownerId, bailRecordsTable.discoveryKey] });
    const records = await tx.select({ id: bailRecordsTable.id, key: bailRecordsTable.discoveryKey })
      .from(bailRecordsTable)
      .where(and(eq(bailRecordsTable.ownerId, ownerId), inArray(bailRecordsTable.discoveryKey, uniqueValues.map((value) => value.discoveryKey))));
    if (records.length !== uniqueValues.length) throw new Error("Saved candidate observations could not be confirmed.");
    await tx.update(discoveryItemsTable).set({ movedToCandidatesAt: new Date() }).where(and(
      eq(discoveryItemsTable.jobId, job.id),
      inArray(discoveryItemsTable.id, items.map((item) => item.id)),
      isNull(discoveryItemsTable.movedToCandidatesAt),
    ));
    return {
      docketCount: new Set(items.map((item) => item.docketNumber)).size,
      observationCount: uniqueValues.length,
      recordIds: uniqueValues.map((value) => records.find((record) => record.key === value.discoveryKey)!.id),
      status: 200 as const,
    };
  });
  if (!("recordIds" in result)) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const payload = {
    docketCount: result.docketCount,
    observationCount: result.observationCount,
    recordIds: result.recordIds,
  };
  SaveDiscoveryCandidatesResponse.parse(payload);
  res.json(payload);
});

export default router;
