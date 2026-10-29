import { Router, raw, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { bailRecordsTable, db, discoveryAssessmentsTable, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable } from "@workspace/db";
import {
  ControlDiscoveryJobBody, ControlDiscoveryJobParams, ControlDiscoveryJobResponse,
  GetDiscoveryJobParams,
  GetDiscoveryJobResponse, GetDiscoveryPolicyResponse, ListDiscoveryJobsResponse,
  SaveDiscoveryObservationBody, SaveDiscoveryObservationParams, SaveDiscoveryObservationResponse,
  SaveDiscoveryCandidatesBody, SaveDiscoveryCandidatesParams, SaveDiscoveryCandidatesResponse,
  ListDiscoveryAssessmentsResponse,
  CreateDiscoveryJobBody,
  StartSingleDocumentProofBody, StartSingleDocumentProofParams, StartSingleDocumentProofResponse,
  GetResearchOperationsResponse,
} from "@workspace/api-zod";
import { discoveryEvent, discoveryPolicy, easternToday, jobSummary } from "../lib/discovery";
import { serializeBailRecord } from "../lib/bail-records";
import { getWorkspaceIdentity, requireResearchAuth, requireSameOrigin } from "../middlewares/researchAuth";
import {
  collectionBlock, resultsDeadline, rollingUsage,
  singleDocumentProofMethod, validSingleDocumentProofCriteria, validSingleDocumentProofRow,
  singleDocumentProofItemId, calendarPreviewRequestAllowed,
} from "../lib/discovery-safety";
import { discoverySourceStatus } from "../lib/discovery-source-status";
import { clearExpiredDiscoveryResults } from "../lib/discovery-retention";
import { candidateEligible, observationKey, observationValues } from "../lib/discovery-candidates";
import { researchPacing } from "../lib/research-pacing";
import { launchDiscovery, newResearchCriteria } from "../lib/discovery-launch";
import { calendarAdmission } from "../lib/research-operations";
import { makeCalendarPreviewCriteria } from "../lib/calendar-criteria";
import { sourceAdmissionBlock } from "../lib/discovery-source-status";
import { launchBoundedPermit } from "../lib/bounded-launch";
import { inspectLocalPdf } from "../lib/local-document";
import { cancelOneTimeSessionRefresh, queueOneTimeSessionRefresh } from "../lib/discovery-worker";
import { isExactAuthorizedSessionRefreshCriteria } from "../lib/session-refresh-safety";

const router: IRouter = Router();
router.use(requireResearchAuth, requireSameOrigin);

router.get("/discovery/policy", async (_req, res): Promise<void> => {
  const sourceStatus = await discoverySourceStatus();
  const payload = {
    adapter: "Paced Calendar Event → associated PDF → provisional monetary observations",
    minimumDate: easternToday(), spacingMs: discoveryPolicy.spacingMs,
    concurrency: 1, automaticRetries: 0,
    defaultRecordCap: Math.min(5, discoveryPolicy.maxRecordCap), maxRecordCap: discoveryPolicy.maxRecordCap,
    defaultRequestCap: Math.min(12, discoveryPolicy.maxRequestCap), maxRequestCap: discoveryPolicy.maxRequestCap,
    ...sourceStatus,
    calendarRequestAllowance: Math.max(0, Math.min(discoveryPolicy.maxRequestCap, sourceStatus.hourlyRequestCap - sourceStatus.hourlyRequestsUsed, sourceStatus.dailyRequestCap - sourceStatus.dailyRequestsUsed)),
    coverageNote: "Common Pleas percentage-bearing and MDJ posted-bail supplied PDFs verified offline. Live calendar and PDF access are separate capabilities; source policy and incomplete coverage are reported per job.",
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
  const { ownerId } = getWorkspaceIdentity(res);
  const rows = await db.select().from(discoveryAssessmentsTable)
    .where(eq(discoveryAssessmentsTable.executionOwnerId, ownerId))
    .orderBy(desc(discoveryAssessmentsTable.createdAt)).limit(30);
  const payload = rows.map((row) => ({
    id: row.id, jobId: row.jobId, stage: row.stage, state: row.state, criteria: row.criteria, expectedMethod: row.expectedMethod,
    approvedAt: row.approvedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null, report: row.report,
  }));
  ListDiscoveryAssessmentsResponse.parse(payload);
  res.json(payload);
});

router.post("/discovery/assessments/:assessmentId/start", async (req, res): Promise<void> => {
  if (!/^[a-f0-9-]{36}$/i.test(String(req.params.assessmentId))) {
    res.status(404).json({error: "Approved scope not found."}); return;
  }
  const result = await launchBoundedPermit(getWorkspaceIdentity(res).ownerId, String(req.params.assessmentId));
  res.status(result.status).json(result.job ? await jobSummary(result.job) : {error: result.error});
});

router.post("/discovery/jobs", async (req, res): Promise<void> => {
  if (!CreateDiscoveryJobBody.safeParse(req.body).success) {
    res.status(400).json({error: "Provide valid calendar criteria, monetary filters, and bounded request and record limits."}); return;
  }
  let criteria;
  try { criteria = newResearchCriteria(req.body ?? {}); }
  catch (error) { res.status(400).json({error: error instanceof Error ? error.message : "Invalid research criteria."}); return; }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  const result = await launchDiscovery(criteria, ownerId, ownerIds);
  res.status(result.status ?? 409).json(result.payload ?? {error: result.error});
});

router.get("/discovery/operations", async (_req, res): Promise<void> => {
  const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  const calendarBlock = await calendarAdmission(db, source);
  const documentBlock = (await discoverySourceStatus()).blockedReason;
  const payload = {
    calendarEnabled: !calendarBlock,
    calendarBlockedReason: calendarBlock,
    documentEnabled: !documentBlock,
    documentBlockedReason: documentBlock,
    pacing: researchPacing,
    notice: "Calendar discovery and document retrieval have separate source-access readiness. Offline PDF verification remains available.",
  };
  GetResearchOperationsResponse.parse(payload);
  res.json(payload);
});

router.post(["/discovery/calendar-previews", "/discovery/searches"], async (req, res): Promise<void> => {
  let criteria;
  try { criteria = makeCalendarPreviewCriteria(req.body ?? {}); }
  catch (error) { res.status(400).json({error: error instanceof Error ? error.message : "Invalid calendar criteria."}); return; }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  const result = await launchDiscovery(criteria, ownerId, ownerIds);
  res.status(result.status ?? 409).json(result.payload ?? {error: result.error});
});

router.post("/discovery/local-documents", raw({type: "application/pdf", limit: 4_000_000}), async (req, res): Promise<void> => {
  if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    res.status(400).json({error: "Upload a readable PDF using application/pdf."}); return;
  }
  const expected = typeof req.query.docketNumber === "string" ? req.query.docketNumber : "";
  if (expected && !/^(?:MJ-\d{5}-(?:CR|NT)|CP-02-CR)-\d{7}-\d{4}$/.test(expected)) {
    res.status(400).json({error: "Expected docket must be a supported exact docket number."}); return;
  }
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";
  if (!!jobId !== !!itemId || [jobId, itemId].some(id => id && !/^[a-f0-9-]{36}$/i.test(id))) {
    res.status(400).json({error: "Select a valid calendar row or upload independently."}); return;
  }
  const {ownerId, ownerIds} = getWorkspaceIdentity(res);
  let expectedDocket = expected;
  if (itemId) {
    const [item] = await db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.id, itemId), eq(discoveryItemsTable.jobId, jobId), inArray(discoveryItemsTable.ownerId, ownerIds)));
    if (!item || expected && expected !== item.docketNumber) { res.status(404).json({error:"Selected docket not found."}); return; }
    expectedDocket = item.docketNumber;
  }
  let parsed;
  try { parsed = await inspectLocalPdf(req.body, expectedDocket); }
  catch (error) { res.status(422).json({error: error instanceof Error ? error.message : "Local verification failed."}); return; }
  const now = new Date();
  const result = await db.transaction(async tx => {
    let job;
    if (jobId) {
      [job] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, jobId), inArray(discoveryJobsTable.ownerId, ownerIds))).for("update");
      if (!job || job.resultsExpiredAt || resultsDeadline(job) && resultsDeadline(job)! <= now) throw new Error("Selected results have expired.");
    } else {
      [job] = await tx.insert(discoveryJobsTable).values({ownerId, status:"COMPLETED",
        criteria:{courtOffice:"ANY", courtRoom:"ANY", eventType:"ANY", startDate:easternToday(), endDate:easternToday(), recordCap:1, requestCap:8},
        message:"Local PDF verification only. No calendar search or source request was made; keep your original PDF."}).returning();
    }
    const [old] = itemId ? await tx.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id,itemId)).for("update") : [];
    const reference = `urn:sha256:${parsed.documentSha256}`;
    const provenance = { ...(old?.provenance ?? {calendarUrl:reference, calendarRetrievedAt:now.toISOString(),
      courtOffice:"Not established by calendar", courtType:parsed.courtType, eventType:"Not established by calendar", eventDate:null, filingDate:null}),
      extractionOutcome:parsed.extractionOutcome, postedEntryState:parsed.postedEntryState, entries:parsed.entries,
      documentSha256:parsed.documentSha256, documentPageCount:parsed.documentPageCount,
      pdfEvents:parsed.pdfEvents,
      bailSectionPages:parsed.bailSectionPages, documentAcquisition:"MANUAL_UPLOAD" as const };
    const values = {provenance, excerpt:parsed.excerpt, detail:parsed.detail, sourceRetrievedAt:now};
    const [item] = old
      ? await tx.update(discoveryItemsTable).set(values).where(eq(discoveryItemsTable.id, old.id)).returning()
      : await tx.insert(discoveryItemsTable).values({...values, ownerId, jobId:job!.id, docketNumber:parsed.docketNumber, position:0, sourceUrl:reference}).returning();
    await tx.insert(discoveryEventsTable).values({jobId:job!.id,ownerId,kind:"LOCAL_PDF",
      message:"User-supplied PDF identity checked locally; no live retrieval claimed. Original file bytes are not retained. Bail/custody and chronology require review."});
    return {jobId:job!.id,itemId:item!.id,extractionOutcome:parsed.extractionOutcome,detail:parsed.detail};
  });
  res.status(201).json(result);
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
        const key = observationKey(item, entry);
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
    requests: await db.select({method:discoveryRequestsTable.method,path:discoveryRequestsTable.path,statusCode:discoveryRequestsTable.statusCode,outcome:discoveryRequestsTable.outcome,startedAt:discoveryRequestsTable.startedAt,completedAt:discoveryRequestsTable.completedAt,durationMs:discoveryRequestsTable.durationMs})
      .from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId,job.id)).orderBy(asc(discoveryRequestsTable.startedAt)),
  };
  GetDiscoveryJobResponse.parse(payload);
  res.json(payload);
});

router.post("/discovery/jobs/:jobId/control", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = ControlDiscoveryJobParams.safeParse(req.params);
  const body = ControlDiscoveryJobBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose pause or cancel." }); return; }
  const result = await db.transaction(async (tx) => {
    const { ownerIds } = getWorkspaceIdentity(res);
    const [resumeSource] = body.data.action === "RESUME" ? await tx.select().from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, "UJS")).for("update") : [];
    const [job] = await tx.select().from(discoveryJobsTable).where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds))).for("update");
    if (!job) return { error: "Job not found in the shared workspace.", status: 404 };
    const action = body.data.action;
    if (!["QUEUED", "RUNNING", "PAUSED"].includes(job.status)) {
      return { error: "This job is already stopped.", status: 409 };
    }
    if (action === "RESUME") {
      if (job.status !== "PAUSED" || job.assessmentId || job.resultsExpiredAt
        || resultsDeadline(job) && resultsDeadline(job)! <= new Date()
        || !job.calendarComplete && job.criteria.startDate < easternToday()
        || job.requestsUsed >= job.criteria.requestCap) return { error: "This job cannot resume: check paused state, expiration, permit, or original budget.", status: 409 };
      const block = job.criteria.calendarPreviewOnly || job.criteria.resultVersion === 2 && !job.calendarComplete
        ? await calendarAdmission(tx, resumeSource) : await sourceAdmissionBlock(tx, resumeSource);
      if (block) return { error: `Resume blocked: ${block}. Original criteria and evidence retained.`, status: 409 };
    }
    const status = action === "CANCEL" ? "CANCELLED" : action === "RESUME" ? "QUEUED" : "PAUSED";
    const [updated] = await tx.update(discoveryJobsTable).set({ status, updatedAt: new Date(), message: `${action}: partial results and original budgets preserved. An already-started source request may finish.` }).where(eq(discoveryJobsTable.id, job.id)).returning();
    if (job.assessmentId && job.status === "QUEUED") {
      await tx.update(discoveryAssessmentsTable).set({ state: "FAILED", completedAt: new Date(),
        report: { requests: job.requestsUsed, validDocuments: 0, failures: 0,
          reason: `${action} before execution. Permit consumed; no automatic retry.` },
      }).where(and(eq(discoveryAssessmentsTable.id, job.assessmentId), eq(discoveryAssessmentsTable.state, "ATTEMPTED")));
    }
    await tx.insert(discoveryEventsTable).values({ jobId: job.id, ownerId: job.ownerId, kind: action, message: `${action} explicitly requested; completed evidence retained.` });
    return { job: updated!, status: 200 };
  });
  if (!("job" in result) || !result.job) { res.status(result.status).json({ error: result.error }); return; }
  const payload = await jobSummary(result.job);
  ControlDiscoveryJobResponse.parse(payload); res.json(payload);
});

router.post("/discovery/jobs/:jobId/items/:itemId/single-document-proof", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = StartSingleDocumentProofParams.safeParse(req.params);
  const body = StartSingleDocumentProofBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Confirm one saved PDF request." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const { ownerIds } = getWorkspaceIdentity(res);
    const [source] = await tx.select().from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, "UJS")).for("update");
    const [job] = await tx.select().from(discoveryJobsTable)
      .where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds)))
      .for("update");
    if (!job) return { error: "Search not found.", status: 404 as const };
    const [item] = await tx.select().from(discoveryItemsTable).where(and(
      eq(discoveryItemsTable.id, params.data.itemId), eq(discoveryItemsTable.jobId, job.id),
      inArray(discoveryItemsTable.ownerId, ownerIds),
    )).for("update");
    if (!item) return { error: "Selected calendar row not found.", status: 404 as const };
    if (!source || job.status !== "PAUSED" || job.assessmentId !== null || !job.calendarComplete
      || job.resultsExpiredAt || resultsDeadline(job) && resultsDeadline(job)! <= new Date()
      || !validSingleDocumentProofCriteria(job.criteria)
      || item.id !== singleDocumentProofItemId
      || !validSingleDocumentProofRow({
        id: item.id,
        docketNumber: item.docketNumber, sourceUrl: item.sourceUrl,
        capturedAt: item.provenance.calendarRetrievedAt, provenance: item.provenance,
      })
      || item.sourceRetrievedAt !== null || job.requestsUsed >= job.criteria.requestCap) {
      return { error: "This saved row is outside the single-document proof scope or its link is no longer eligible.", status: 409 as const };
    }
    if (collectionBlock(source) !== "ACCESS_UNVERIFIED" || source.activeRequestId
      || source.pausedUntil || source.blockedReason !== null || source.accessVerifiedAt
      || source.verifiedMethod || source.collectionApprovedAt || source.latencyWarning) {
      return { error: "Source readiness has a stop other than the missing document-access proof.", status: 409 as const };
    }
    const history = await tx.select().from(discoveryRequestsTable)
      .where(eq(discoveryRequestsTable.jobId, job.id));
    const pdfHistory = history.filter((request) =>
      ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"].includes(request.path));
    const searches = history.filter((request) => request.path === "/CaseSearch" && request.method === "POST");
    if (history.length !== 4 || job.requestsUsed !== 4 || pdfHistory.length !== 0 || searches.length !== 1
      || history.some((request) => request.outcome !== "OK" || request.statusCode !== 200
        || !["/CaseSearch", "/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css"].includes(request.path))) {
      return { error: "The saved request history does not qualify for a one-PDF proof.", status: 409 as const };
    }
    const [active] = await tx.select({ id: discoveryJobsTable.id }).from(discoveryJobsTable)
      .where(inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])).limit(1);
    if (active) return { error: "Another collection job is active.", status: 409 as const };
    const recent = await tx.select({ startedAt: discoveryRequestsTable.startedAt })
      .from(discoveryRequestsTable).where(eq(discoveryRequestsTable.sourceId, "UJS"));
    if (rollingUsage(recent.map((request) => request.startedAt), new Date(),
      discoveryPolicy.hourlyRequestCap, discoveryPolicy.dailyRequestCap).blockedReason) {
      return { error: "The shared source request limit is active.", status: 409 as const };
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const [permit] = await tx.insert(discoveryAssessmentsTable).values({
      stage: "SINGLE_DOCUMENT_PROOF", state: "ATTEMPTED", criteria: job.criteria,
      expectedMethod: singleDocumentProofMethod, executionOwnerId: job.ownerId, jobId: job.id,
      approvedAt: new Date(), startedAt: new Date(), expiresAt,
      report: { requests: 0, validDocuments: 0, failures: 0,
        reason: `single-document-proof:${item.id}` },
    }).returning();
    const [queued] = await tx.update(discoveryJobsTable).set({
      status: "QUEUED", assessmentId: permit!.id, updatedAt: new Date(),
      message: "One saved calendar-linked PDF authorized by the operator; no Search rerun and no second document.",
    }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "PAUSED"))).returning();
    if (!queued) throw new Error("Proof job changed during authorization.");
    await tx.insert(discoveryEventsTable).values({
      jobId: job.id, ownerId: job.ownerId, kind: "SINGLE_DOCUMENT_PROOF_AUTHORIZED",
      message: "One stored CP-05-02-Crim Bail Hearing link authorized once; no Search rerun, URL reconstruction, or second PDF. Existing source ledger and stop conditions remain active.",
    });
    return { job: queued, itemId: item.id, assessmentId: permit!.id, status: 202 as const };
  });
  if (!("job" in result)) { res.status(result.status).json({ error: result.error }); return; }
  const payload = { job: await jobSummary(result.job!), itemId: result.itemId, assessmentId: result.assessmentId };
  StartSingleDocumentProofResponse.parse(payload);
  res.status(result.status).json(payload);
});

router.post("/discovery/jobs/:jobId/refresh-session", async (req, res): Promise<void> => {
  await clearExpiredDiscoveryResults();
  const params = ControlDiscoveryJobParams.safeParse(req.params);
  if (!params.success || req.body?.confirm !== "repeat-exact-search-and-first-pdf") {
    res.status(400).json({ error: "Explicit exact-search and first-PDF confirmation is required." });
    return;
  }
  let queuedJobId: string | null = null;
  let result: { job?: typeof discoveryJobsTable.$inferSelect; error?: string; status: number };
  try {
    result = await db.transaction(async (tx) => {
      const { ownerIds } = getWorkspaceIdentity(res);
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [job] = await tx.select().from(discoveryJobsTable)
        .where(and(eq(discoveryJobsTable.id, params.data.jobId), inArray(discoveryJobsTable.ownerId, ownerIds)))
        .for("update");
      if (!job) return { error: "Job not found in the shared workspace.", status: 404 };
      if (job.status !== "PAUSED" || job.assessmentId !== null || job.resultsExpiredAt
        || !job.calendarComplete || !isExactAuthorizedSessionRefreshCriteria(job.criteria)
        || resultsDeadline(job) && resultsDeadline(job)! <= new Date())
        return { error: "This job is outside the exact authorized refresh scope.", status: 409 };
      if (!source || source.blockedReason !== null || source.accessVerifiedAt !== null
        || source.verifiedMethod !== null || source.activeRequestId !== null || source.pausedUntil !== null)
        return { error: "Source state is not eligible for this one-time check.", status: 409 };
      const sourceBlock = await calendarAdmission(tx, source);
      if (sourceBlock) return { error: `Calendar access is blocked: ${sourceBlock}.`, status: 409 };
      const [activeJob] = await tx.select({ id: discoveryJobsTable.id }).from(discoveryJobsTable)
        .where(inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])).limit(1);
      if (activeJob) return { error: "Another discovery job is active.", status: 409 };
      const requests = await tx.select().from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id));
      const items = await tx.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id))
        .orderBy(asc(discoveryItemsTable.position));
      const searchPosts = requests.filter((request) => request.path === "/CaseSearch" && request.method === "POST");
      if (requests.length !== job.requestsUsed || requests.some((request) =>
        request.outcome !== "OK" || !calendarPreviewRequestAllowed(request.path, request.method))
        || searchPosts.length !== 2
        || requests.some((request) => request.path === "/Report/CpDocketSheet" || request.path === "/Report/MdjDocketSheet")
        || items.length !== 188 || items.some((item) => item.provenance.extractionOutcome !== "UNPROCESSED")
        || job.criteria.recordCap !== 200 || job.criteria.requestCap !== 500 || job.criteria.matchTarget !== 200)
        return { error: "Saved evidence or request history no longer matches the one-time refresh safeguards.", status: 409 };
      if (!queueOneTimeSessionRefresh(job.id))
        return { error: "A one-time refresh is already queued for this job.", status: 409 };
      queuedJobId = job.id;
      const [updated] = await tx.update(discoveryJobsTable).set({
        status: "QUEUED",
        message: "One exact saved-search refresh and first-PDF access check authorized; criteria and caps unchanged.",
        updatedAt: new Date(),
      }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "PAUSED"))).returning();
      if (!updated) return { error: "Job state changed before the refresh could be queued.", status: 409 };
      await tx.insert(discoveryEventsTable).values({
        jobId: job.id, ownerId: job.ownerId, kind: "SESSION_REFRESH_AUTHORIZED",
        message: "One exact Search resubmission and one first-PDF access check authorized. Original criteria and request caps retained.",
      });
      return { job: updated, status: 200 };
    });
  } catch (error) {
    if (queuedJobId) cancelOneTimeSessionRefresh(queuedJobId);
    throw error;
  }
  if (!result.job) {
    if (queuedJobId) cancelOneTimeSessionRefresh(queuedJobId);
    res.status(result.status).json({ error: result.error ?? "Refresh authorization failed." });
    return;
  }
  res.json({ action: "SESSION_REFRESH_QUEUED", job: await jobSummary(result.job) });
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
