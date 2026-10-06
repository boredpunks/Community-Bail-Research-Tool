import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { bailRecordsTable, db, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoverySourceTable } from "@workspace/db";
import {
  ControlDiscoveryJobBody, ControlDiscoveryJobParams, ControlDiscoveryJobResponse,
  CreateDiscoveryJobBody, CreateDiscoveryJobResponse, GetDiscoveryJobParams,
  GetDiscoveryJobResponse, GetDiscoveryPolicyResponse, ListDiscoveryJobsResponse,
  SaveDiscoveryObservationBody, SaveDiscoveryObservationParams, SaveDiscoveryObservationResponse,
} from "@workspace/api-zod";
import { actualDate, discoveryEvent, discoveryPolicy, easternToday, jobSummary } from "../lib/discovery";
import { serializeBailRecord } from "../lib/bail-records";
import { requireResearchAuth, requireSameOrigin } from "../middlewares/researchAuth";

const router: IRouter = Router();
router.use(requireResearchAuth, requireSameOrigin);

router.get("/discovery/policy", async (_req, res): Promise<void> => {
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  const payload = {
    adapter: "UJS public browser calendar + standard public HTTP, identity-checked Common Pleas PDF",
    minimumDate: easternToday(), spacingMs: discoveryPolicy.spacingMs,
    concurrency: 1, automaticRetries: 0,
    defaultRecordCap: Math.min(5, discoveryPolicy.maxRecordCap), maxRecordCap: discoveryPolicy.maxRecordCap,
    defaultRequestCap: Math.min(12, discoveryPolicy.maxRequestCap), maxRequestCap: discoveryPolicy.maxRequestCap,
    pausedUntil: source?.pausedUntil?.toISOString() ?? null,
    blockedReason: source?.blockedReason ?? null,
    collectionEnabled: !source?.blockedReason || !!(source.pausedUntil && source.pausedUntil <= new Date()),
    coverageNote: "Demonstrated: Allegheny Common Pleas criminal court (CP-05-02-Crim), Bail Hearing, today/future calendar windows up to 7 days. MDJ and Preliminary Arraignment coverage and historical dates are not enabled. Extraction is limited to demonstrated bail-table layouts; percentage/deposit-bearing or ambiguous multi-amount rows fail closed as unsupported. No countywide, current-custody, completeness or freshness claim. Remote pagination is not traversed. Browser scripts/styles count toward the budget; nonessential assets are blocked before transmission. Each job uses fixed local match filters and a distinct-docket target; exhaustion or safety caps may leave that target unmet. One request at a time, with a pacing pause after the prior response completes; no promise of avoiding rate limits."
      + (source?.blockedReason && !source.pausedUntil ? " Source access is blocked pending operator assessment." : ""),
  };
  GetDiscoveryPolicyResponse.parse(payload);
  res.json(payload);
});

router.get("/discovery/jobs", async (req, res): Promise<void> => {
  const rows = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.ownerId, getAuth(req).userId!)).orderBy(desc(discoveryJobsTable.createdAt)).limit(100);
  const payload = await Promise.all(rows.map(jobSummary));
  ListDiscoveryJobsResponse.parse(payload);
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
  const ownerId = getAuth(req).userId!;
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  if (source?.blockedReason && (!source.pausedUntil || source.pausedUntil > new Date())) {
    res.status(409).json({ error: "Source-wide pause: no new collection jobs can start until the cooldown ends or an operator assesses the access denial." }); return;
  }
  // Serialize account job creation without depending on frontend button state.
  const result = await db.transaction(async (tx) => {
    await tx.execute(`SELECT pg_advisory_xact_lock(hashtext('ujs-job-creation'))`);
    const [active] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.ownerId, ownerId), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
    if (active) return null;
    const [job] = await tx.insert(discoveryJobsTable).values({
      ownerId, criteria: { ...body.data, startDate, endDate }, message: "Explicit live job queued. Saved-record searches do not collect data.",
    }).returning();
    return job!;
  });
  if (!result) { res.status(409).json({ error: "An active job already exists in your account. Pause or cancel it first." }); return; }
  await discoveryEvent(result, "QUEUED", `Target: ${result.criteria.matchTarget} matching dockets with fixed local filters. Safety budget: ${result.criteria.requestCap} total requests; ${result.criteria.recordCap} processed documents. One request at a time; at least ${discoveryPolicy.spacingMs / 1000}s after the previous response completes; no automatic retries.`);
  const payload = await jobSummary(result);
  CreateDiscoveryJobResponse.parse(payload);
  res.status(201).json(payload);
});

router.get("/discovery/jobs/:jobId", async (req, res): Promise<void> => {
  const params = GetDiscoveryJobParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Job not found." }); return; }
  const ownerId = getAuth(req).userId!;
  const [job] = await db.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), eq(discoveryJobsTable.ownerId, ownerId)));
  if (!job) { res.status(404).json({ error: "Job not found in your account." }); return; }
  const [items, events, saved] = await Promise.all([
    db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.ownerId, ownerId))).orderBy(asc(discoveryItemsTable.position)),
    db.select().from(discoveryEventsTable).where(and(eq(discoveryEventsTable.jobId, job.id), eq(discoveryEventsTable.ownerId, ownerId))).orderBy(asc(discoveryEventsTable.createdAt)),
    db.select({ id: bailRecordsTable.id, key: bailRecordsTable.discoveryKey, reviewStatus: bailRecordsTable.reviewStatus, orderInterpretation: bailRecordsTable.orderInterpretation }).from(bailRecordsTable).where(eq(bailRecordsTable.ownerId, ownerId)),
  ]);
  const payload = {
    job: await jobSummary(job),
    items: items.map((item) => {
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
  const params = ControlDiscoveryJobParams.safeParse(req.params);
  const body = ControlDiscoveryJobBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose pause, cancel or resume." }); return; }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), eq(discoveryJobsTable.ownerId, getAuth(req).userId!))).for("update");
    if (!job) return { error: "Job not found in your account.", status: 404 };
    const action = body.data.action;
    if (action === "RESUME") {
      if (!["PAUSED", "CANCELLED", "FAILED"].includes(job.status)) return { error: "Only a stopped job can resume.", status: 409 };
      if (job.requestsUsed >= job.criteria.requestCap) return { error: "Original request budget is exhausted. It will not be silently increased.", status: 409 };
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
      if (source?.blockedReason && (!source.pausedUntil || source.pausedUntil > new Date())) return { error: source.pausedUntil ? `Source-wide pause until ${source.pausedUntil.toISOString()}. No requests will be retried before then.` : "Source access requires operator assessment before resuming.", status: 409 };
      if (!job.calendarComplete && job.criteria.startDate < easternToday()) return { error: "The original calendar date is no longer supported. This job cannot silently switch dates.", status: 409 };
      const [active] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.ownerId, job.ownerId), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
      if (active) return { error: "Another job is active in your account.", status: 409 };
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
  const params = SaveDiscoveryObservationParams.safeParse(req.params);
  const body = SaveDiscoveryObservationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose an extracted bail entry to save." }); return; }
  const ownerId = getAuth(req).userId!;
  const [item] = await db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.id, params.data.itemId), eq(discoveryItemsTable.jobId, params.data.jobId), eq(discoveryItemsTable.ownerId, ownerId)));
  if (!item) { res.status(404).json({ error: "Evidence not found in your account." }); return; }
  const entry = body.data.entryIndex === null ? null : item.provenance.entries[body.data.entryIndex];
  if (!item.sourceRetrievedAt || (item.provenance.extractionOutcome === "MISSING_BAIL_SECTION" ? body.data.entryIndex !== null : item.provenance.extractionOutcome !== "EXTRACTED" || !entry)) {
    res.status(400).json({ error: "Only identity-checked extracted evidence or an explicit missing-bail-section outcome can be saved. Failed or unsupported extraction is not an observation." }); return;
  }
  const discoveryKey = createHash("sha256").update(JSON.stringify({ docket: item.docketNumber, excerpt: item.excerpt, entry })).digest("hex");
  const [inserted] = await db.insert(bailRecordsTable).values({
    ownerId, caseKey: `allegheny|COMMON_PLEAS|${item.docketNumber}`, docketNumber: item.docketNumber,
    county: "Allegheny", courtLevel: "COMMON_PLEAS", chargeGroup: null,
    bailCategory: entry?.bailCategory ?? "UNKNOWN", financialBasis: entry?.financialBasis ?? null,
    amountCents: entry?.amountCents ?? null, orderDate: entry?.orderDate ?? null,
    sourceTitle: "Pennsylvania UJS Common Pleas docket sheet", sourceUrl: item.sourceUrl,
    sourceRetrievedAt: item.sourceRetrievedAt, sourceObservedAt: null,
    evidenceNote: item.excerpt ?? item.detail!, discoveryEvidence: item.provenance,
    discoveryKey, discoveryItemId: item.id,
  }).onConflictDoNothing({ target: [bailRecordsTable.ownerId, bailRecordsTable.discoveryKey] }).returning();
  const record = inserted ?? (await db.select().from(bailRecordsTable).where(and(eq(bailRecordsTable.ownerId, ownerId), eq(bailRecordsTable.discoveryKey, discoveryKey))))[0]!;
  const payload = serializeBailRecord(record);
  SaveDiscoveryObservationResponse.parse(payload); res.json(payload);
});

export default router;
