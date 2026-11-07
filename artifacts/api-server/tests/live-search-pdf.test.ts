import assert from "node:assert/strict";
import { createServer } from "node:http";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  bailRecordsTable, bailSearchResultsTable, bailSearchesTable, db, discoveryEventsTable, discoveryItemsTable,
  discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, pool,
} from "@workspace/db";
import app from "../src/app";
import { discoveryPolicy } from "../src/lib/discovery";
import { integratedSourceMethod } from "../src/lib/discovery-safety";
import { runJob } from "../src/lib/discovery-worker";
import { createWorkspaceSession, WORKSPACE_COOKIE_NAME } from "../src/middlewares/researchAuth";
import { autoContinueQuotaSearches, runBailSearch } from "../src/services/bail-search-worker";
import { resumeToken, searchOwner } from "../src/services/bail-search-store";

const baseUrl = "https://ujsportal.pacourts.us";
const sessionSecret = "task-115-offline-search-test-signing-key";
const isoToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const scenarios = [
  {
    startDate: isoToday,
    endDate: isoToday,
    courtOffice: "CP-05-02-Crim",
    eventType: "Bail Hearing",
    docketNumber: "CP-02-CR-0005845-2026",
    documentPath: "/Report/CpDocketSheet",
    outcome: "EXTRACTED",
  },
  {
    startDate: isoToday,
    endDate: isoToday,
    courtOffice: "ANY",
    eventType: "Formal Arraignment",
    docketNumber: "MJ-05310-NT-0000228-2026",
    documentPath: "/Report/MdjDocketSheet",
    outcome: "MISSING_BAIL_SECTION",
  },
  {
    startDate: isoToday,
    endDate: isoToday,
    courtOffice: "CP-05-02-Crim",
    eventType: "Preliminary Hearing",
    docketNumber: "CP-02-CR-0005845-2026",
    documentPath: "/Report/CpDocketSheet",
    outcome: "EXTRACTED",
    partialCoverage: true,
  },
] as const;

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = sessionSecret;

const [previousSource] = await db.select().from(discoverySourceTable)
  .where(eq(discoverySourceTable.id, "UJS"));
const [activeRequest] = await db.select().from(discoveryRequestsTable)
  .where(eq(discoveryRequestsTable.outcome, "IN_FLIGHT")).limit(1);
assert.equal(activeRequest, undefined, "The offline test requires an idle source request slot.");
assert.equal(previousSource?.activeRequestId ?? null, null, "The offline test requires no active source slot.");

const workerLease = await pool.connect();
const [{ acquired }] = (await workerLease.query(
  "SELECT pg_try_advisory_lock(74651283) AS acquired",
)).rows as [{ acquired: boolean }];
if (!acquired) {
  workerLease.release();
  await pool.end();
  throw new Error("The API discovery worker is active; the offline test will not start.");
}

const server = createServer(app);
const searchIds: string[] = [];
const jobIds: string[] = [];
let otherSearchId: string | undefined;
let sharedCandidateId: string | undefined;
try {
  await db.insert(discoverySourceTable).values({ id: "UJS" }).onConflictDoNothing();
  await db.update(discoverySourceTable).set({
    lastRequestAt: null,
    lastCompletedAt: null,
    pausedUntil: null,
    blockedReason: null,
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
    activeRequestId: null,
    adaptiveSpacingMs: 30_000,
    slowResponseStreak: 0,
    throttleCount: 0,
    lastLatencyMs: null,
    latencyWarning: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const cookie = `${WORKSPACE_COOKIE_NAME}=${createWorkspaceSession()}`;
  const headers = { cookie, origin, "content-type": "application/json" };

  for (const scenario of scenarios) {
    if (searchIds.length) {
      const [activeRequest] = await db.select().from(discoveryRequestsTable)
        .where(eq(discoveryRequestsTable.outcome, "IN_FLIGHT")).limit(1);
      assert.equal(activeRequest, undefined, "The next local fixture scenario requires no active source request.");
      await db.update(discoverySourceTable).set({
        lastRequestAt: null,
        lastCompletedAt: null,
        activeRequestId: null,
        adaptiveSpacingMs: 30_000,
        slowResponseStreak: 0,
        throttleCount: 0,
        latencyWarning: null,
      }).where(eq(discoverySourceTable.id, "UJS"));
    }
    const launch = await fetch(`${origin}/api/bail-search/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        startDate: scenario.startDate,
        endDate: scenario.endDate,
        maxBail: 2_000,
        source: "live",
        courtOffice: scenario.courtOffice,
        eventType: scenario.eventType,
      }),
    });
    const launchBody = await launch.json() as { searchId?: string; status?: string; error?: string };
    assert.equal(launch.status, 201, launchBody.error);
    const started = launchBody as { searchId: string; status: string };
    assert.equal(started.status, "running");
    searchIds.push(started.searchId);

    const [search] = await db.select().from(bailSearchesTable)
      .where(eq(bailSearchesTable.id, started.searchId));
    assert.ok(search?.discoveryJobId);
    jobIds.push(search.discoveryJobId);
    const [job] = await db.select().from(discoveryJobsTable)
      .where(eq(discoveryJobsTable.id, search.discoveryJobId));
    assert.ok(job);

    // The test-only worker uses local calendar HTML and supplied PDFs. It has
    // no browser, HTTP client, or public-network path.
    const workerRun = runJob(job, undefined, { offlineMockSource: true });
    if (searchIds.length === 1) {
      let activeProgress: { pagesTotal: number; pagesAttempted: number; pagesCompleted: number } | null = null;
      let requestDuringOcr: unknown;
      const deadline = Date.now() + 5_000;
      while (!activeProgress && Date.now() < deadline) {
        const progressResponse = await fetch(
          `${origin}/api/bail-search/search/${started.searchId}/status`, { headers: { cookie } },
        );
        assert.equal(progressResponse.status, 200);
        const body = await progressResponse.json() as {
          progress: {
            localOcr: { pagesTotal: number; pagesAttempted: number; pagesCompleted: number } | null;
            currentRequest?: unknown;
          };
        };
        activeProgress = body.progress.localOcr;
        requestDuringOcr = body.progress.currentRequest;
        if (!activeProgress) await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.deepEqual(activeProgress, { pagesTotal: 2, pagesAttempted: 1, pagesCompleted: 0 });
      assert.equal(requestDuringOcr, undefined, "Local OCR must not appear as a court request in flight.");
    }
    await workerRun;
    const [afterDiscovery] = await db.select().from(bailSearchesTable)
      .where(eq(bailSearchesTable.id, started.searchId));
    assert.ok(afterDiscovery);
    await runBailSearch(afterDiscovery);

    const status = await fetch(`${origin}/api/bail-search/search/${started.searchId}/status`, { headers: { cookie } });
    assert.equal(status.status, 200);
    const response = await status.json() as {
      searchId: string;
      status: string;
      stage: string;
      reason?: string | null;
      progress: {
        calendarValidated: boolean; documentsRetrieved: number; documentsProcessed: number;
        localOcr: { pagesTotal: number; pagesAttempted: number; pagesCompleted: number } | null;
        calendarCoverage: {
          segmentsChecked: number; segmentsTotal: number | null;
          rowsObserved: number; rowsRetained: number; rowsExcluded: number; partial: boolean;
        };
      };
      results: Array<{
        id: string; docket_number: string; hearing_date: string; bail_amount: number | null;
        evidence_page: number | null; evidence_quote: string; document_status: string;
        evidence_acquisition: string; source_pdf_sha256: string | null;
      }>;
    };
    assert.equal(response.searchId, started.searchId);
    assert.equal(response.status, scenario.partialCoverage ? "paused" : "complete", response.reason ?? response.stage);
    assert.equal(response.progress.calendarValidated, true);
    assert.equal(response.progress.documentsRetrieved, 1);
    assert.equal(response.progress.documentsProcessed, 1);
    assert.equal(response.progress.localOcr, null, "Completed extraction must clear active OCR status.");
    if (scenario.partialCoverage) {
      assert.deepEqual(response.progress.calendarCoverage, {
        segmentsChecked: 1,
        segmentsTotal: null,
        rowsObserved: 2,
        rowsRetained: 1,
        rowsExcluded: 1,
        partial: true,
      });
    }
    assert.equal(response.results.length, 1);
    const [result] = response.results;
    assert.equal(result?.docket_number, scenario.docketNumber);
    assert.equal(result?.hearing_date, scenario.startDate);
    assert.match(result?.source_pdf_sha256 ?? "", /^[a-f0-9]{64}$/);
    if (searchIds.length === 1 && result) {
      const otherCookie = `${WORKSPACE_COOKIE_NAME}=${createWorkspaceSession()}`;
      const otherHeaders = { cookie: otherCookie, origin, "content-type": "application/json" };
      const otherStatusResponse = await fetch(`${origin}/api/bail-search/search/${started.searchId}/status`, {
        headers: { cookie: otherCookie },
      });
      assert.equal(otherStatusResponse.status, 200);
      const otherStatus = await otherStatusResponse.json() as { canManage: boolean; resumeToken: string | null };
      assert.equal(otherStatus.canManage, false, "The second session must not gain creator-only search controls.");
      assert.equal(otherStatus.resumeToken, null);

      const saveResponse = await fetch(
        `${origin}/api/bail-search/search/${started.searchId}/results/${result.id}/save`,
        { method: "POST", headers: otherHeaders, body: JSON.stringify({ shareWithWorkspace: true }) },
      );
      assert.equal(saveResponse.status, 200, await saveResponse.clone().text());
      const savedResult = await saveResponse.json() as { saved_record_id: string | null };
      assert.ok(savedResult.saved_record_id);
      sharedCandidateId = savedResult.saved_record_id;

      const sharedCandidatesResponse = await fetch(`${origin}/api/bail-search/candidates`, {
        headers: { cookie: otherCookie },
      });
      assert.equal(sharedCandidatesResponse.status, 200);
      const sharedCandidates = await sharedCandidatesResponse.json() as { id: string; docket_number: string }[];
      assert.ok(sharedCandidates.some(candidate => candidate.id === sharedCandidateId
        && candidate.docket_number === scenario.docketNumber),
      "A different workspace session can save an eligible result and see it in shared Candidates.");
    }

    const requests = await db.select().from(discoveryRequestsTable)
      .where(eq(discoveryRequestsTable.jobId, search.discoveryJobId));
    assert.deepEqual(requests.map(request => [request.method, request.path, request.outcome]).sort(),
      [["GET", scenario.documentPath, "OK"], ["POST", "/CaseSearch", "OK"]]);
    if (searchIds.length === 1) {
      const ocrEvents = await db.select({
        kind: discoveryEventsTable.kind,
        message: discoveryEventsTable.message,
      }).from(discoveryEventsTable).where(and(
        eq(discoveryEventsTable.jobId, search.discoveryJobId),
        inArray(discoveryEventsTable.kind, ["LOCAL_OCR_PROGRESS", "LOCAL_OCR_FINISHED"]),
      )).orderBy(asc(discoveryEventsTable.createdAt));
      const progressEvents = ocrEvents.filter(event => event.kind === "LOCAL_OCR_PROGRESS");
      assert.deepEqual(progressEvents.map(event => JSON.parse(event.message)), [
        { pagesTotal: 2, pagesAttempted: 1, pagesCompleted: 0 },
        { pagesTotal: 2, pagesAttempted: 1, pagesCompleted: 1 },
        { pagesTotal: 2, pagesAttempted: 2, pagesCompleted: 1 },
        { pagesTotal: 2, pagesAttempted: 2, pagesCompleted: 2 },
      ]);
      assert.ok(ocrEvents.some(event => event.kind === "LOCAL_OCR_FINISHED"));
    }
    const [item] = await db.select().from(discoveryItemsTable)
      .where(and(eq(discoveryItemsTable.jobId, search.discoveryJobId),
        eq(discoveryItemsTable.docketNumber, scenario.docketNumber)));
    assert.equal(item?.provenance.extractionOutcome, scenario.outcome);
    assert.equal(item?.provenance.documentSha256, result?.source_pdf_sha256);
    assert.ok(item?.sourceUrl?.startsWith(`${baseUrl}${scenario.documentPath}?docketNumber=`));

    if (scenario.outcome === "MISSING_BAIL_SECTION") {
      assert.equal(result?.document_status, "NO_BAIL_SECTION");
      assert.equal(result?.bail_amount, null);
      assert.equal(result?.evidence_page, null);
      assert.equal(result?.evidence_quote, "");
      assert.equal(result?.evidence_acquisition, "STORED_EXTRACTION");
    } else {
      assert.equal(result?.bail_amount, 100);
      assert.equal(result?.evidence_page, 1);
      assert.match(result?.evidence_quote ?? "", /10\.00%.*\$100\.00/);
      assert.equal(result?.document_status, "EXTRACTED");
      assert.equal(result?.evidence_acquisition, "STORED_EXTRACTION");
    }
  }

  const templateSearch = (await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, searchIds[0]!)))[0]!;
  const templateJob = (await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, templateSearch.discoveryJobId!)))[0]!;
  await db.update(discoverySourceTable).set({
    lastRequestAt: null,
    lastCompletedAt: null,
    pausedUntil: null,
    blockedReason: null,
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
    activeRequestId: null,
    adaptiveSpacingMs: 30_000,
    slowResponseStreak: 0,
    throttleCount: 0,
    lastLatencyMs: null,
    latencyWarning: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  const rateLimitCriteria = { ...templateJob.criteria };
  const rateLimitStartedAt = new Date();
  const [rateLimitJob] = await db.insert(discoveryJobsTable).values({
    ownerId: templateJob.ownerId,
    criteria: rateLimitCriteria,
    status: "QUEUED",
    calendarComplete: false,
    requestsUsed: 0,
  }).returning();
  jobIds.push(rateLimitJob!.id);
  const [rateLimitSearch] = await db.insert(bailSearchesTable).values({
    ownerId: searchOwner(cookie),
    discoveryJobId: rateLimitJob!.id,
    criteria: templateSearch.criteria,
    queue: [],
    total: 0,
    status: "running",
  }).returning();
  searchIds.push(rateLimitSearch!.id);
  await runJob(rateLimitJob!, undefined, { offlineMockSource: true, mockRateLimitOnce: true });
  await runBailSearch(rateLimitSearch!);

  const [rateLimitedRequest] = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, rateLimitJob!.id));
  assert.equal(rateLimitedRequest?.statusCode, 429);
  assert.equal(rateLimitedRequest?.outcome, "RATE_LIMIT");
  assert.ok(rateLimitedRequest?.completedAt);
  const [rateLimitedSource] = await db.select().from(discoverySourceTable)
    .where(eq(discoverySourceTable.id, "UJS"));
  const [rateLimitedPausedSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  const [rateLimitedPausedJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, rateLimitJob!.id));
  assert.ok(rateLimitedSource?.pausedUntil);
  assert.ok(rateLimitedRequest?.completedAt);
  const minimumRateLimitWait = Math.max(30 * 60_000, discoveryPolicy.cooldownMs);
  assert.ok(rateLimitedSource!.pausedUntil!.getTime()
    >= rateLimitedRequest!.completedAt!.getTime() + minimumRateLimitWait,
  "The recorded pause must honor the later of Retry-After and configured cooldown.");
  assert.ok(rateLimitedPausedSearch?.resumeAvailableAt);
  assert.ok(rateLimitedPausedSearch!.resumeAvailableAt!.getTime() >= rateLimitedSource!.pausedUntil!.getTime(),
    "The same search must remain paused through the later of Retry-After and configured cooldown.");
  assert.match(rateLimitedPausedSearch?.reason ?? "", /\[AUTO_RESUME_SOURCE:RATE_LIMIT\]$/);
  assert.equal(rateLimitedPausedSearch?.status, "paused");
  assert.equal(rateLimitedPausedJob?.status, "PAUSED");

  await autoContinueQuotaSearches();
  const [stillCoolingSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  assert.equal(stillCoolingSearch?.status, "paused",
    "An automatic scheduler pass before the recorded deadline must not resume the search.");

  // Fast-forward only persisted deadlines after asserting the real recorded
  // Retry-After. A changed challenge then proves that automatic resume rechecks
  // current admission rather than treating expiry as permission to request.
  const passedCooldown = new Date(Date.now() - 1_000);
  await db.update(bailSearchesTable).set({ resumeAvailableAt: passedCooldown })
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  await db.update(discoverySourceTable).set({
    blockedReason: "CHALLENGE",
    pausedUntil: null,
    accessVerifiedAt: null,
    verifiedMethod: null,
    collectionApprovedAt: null,
    activeRequestId: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  await autoContinueQuotaSearches();
  const [admissionBlockedSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  const [admissionBlockedJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, rateLimitJob!.id));
  const blockedRetryRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, rateLimitJob!.id));
  assert.equal(admissionBlockedSearch?.status, "paused");
  assert.equal(admissionBlockedJob?.status, "PAUSED");
  assert.equal(blockedRetryRequests.length, 1,
    "A current challenge must block continuation without reserving another source request.");

  const passedAt = new Date(Date.now() - 60 * 60_000);
  await db.update(discoverySourceTable).set({
    blockedReason: "RATE_LIMIT",
    pausedUntil: passedCooldown,
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
    lastRequestAt: passedAt,
    lastCompletedAt: passedAt,
    adaptiveSpacingMs: 30_000,
    activeRequestId: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  await autoContinueQuotaSearches();
  const [resumedRateLimitSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  const [resumedRateLimitJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, rateLimitJob!.id));
  assert.equal(resumedRateLimitSearch?.status, "running");
  assert.equal(resumedRateLimitJob?.status, "QUEUED");
  assert.deepEqual(resumedRateLimitSearch?.criteria, templateSearch.criteria);
  assert.deepEqual(resumedRateLimitJob?.criteria, rateLimitCriteria,
    "Automatic continuation must preserve the original source scope.");
  assert.equal(resumedRateLimitJob?.requestsUsed, 1,
    "The 429 remains charged to the original request budget.");
  assert.equal(resumedRateLimitJob?.criteria.requestCap, rateLimitCriteria.requestCap);
  const requestsAtResume = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, rateLimitJob!.id));
  assert.equal(requestsAtResume.length, 1, "Resuming queues the original job without bypassing source request admission.");

  await runJob(resumedRateLimitJob!, undefined, { offlineMockSource: true });
  const [resumedSearchForProcessing] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, rateLimitSearch!.id));
  await runBailSearch(resumedSearchForProcessing!);
  const [completedRateLimitJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, rateLimitJob!.id));
  assert.equal(completedRateLimitJob?.status, "COMPLETED");
  assert.deepEqual(completedRateLimitJob?.criteria, rateLimitCriteria);
  assert.equal(completedRateLimitJob?.requestsUsed, 3,
    "The retry uses the same remaining budget, including calendar and document requests.");
  const recoveredRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, rateLimitJob!.id));
  assert.deepEqual(recoveredRequests.map(request => [request.method, request.path, request.outcome]).sort(),
    [["GET", "/Report/CpDocketSheet", "OK"], ["POST", "/CaseSearch", "OK"], ["POST", "/CaseSearch", "RATE_LIMIT"]]);
  assert.ok(rateLimitStartedAt.getTime() <= rateLimitedRequest!.startedAt.getTime());

  // A 5xx on the calendar request must wait for its recorded backoff. Once
  // eligible, automatic continuation must preserve the linked calendar scope,
  // remaining budget, and all current source access checks.
  await db.update(discoverySourceTable).set({
    lastRequestAt: null,
    lastCompletedAt: null,
    pausedUntil: null,
    blockedReason: null,
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
    activeRequestId: null,
    adaptiveSpacingMs: 30_000,
    slowResponseStreak: 0,
    throttleCount: 0,
    lastLatencyMs: null,
    latencyWarning: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  const serverErrorCriteria = { ...templateJob.criteria };
  const [serverErrorJob] = await db.insert(discoveryJobsTable).values({
    ownerId: templateJob.ownerId,
    criteria: serverErrorCriteria,
    status: "QUEUED",
    calendarComplete: false,
    requestsUsed: 0,
  }).returning();
  jobIds.push(serverErrorJob!.id);
  const [serverErrorSearch] = await db.insert(bailSearchesTable).values({
    ownerId: searchOwner(cookie),
    discoveryJobId: serverErrorJob!.id,
    criteria: templateSearch.criteria,
    queue: [],
    total: 0,
    status: "running",
  }).returning();
  searchIds.push(serverErrorSearch!.id);

  await runJob(serverErrorJob!, undefined, {
    offlineMockSource: true,
    mockServerErrorOnCalendarOnce: true,
  });
  await runBailSearch(serverErrorSearch!);

  const [failedServerErrorRequest] = await db.select().from(discoveryRequestsTable)
    .where(and(eq(discoveryRequestsTable.jobId, serverErrorJob!.id),
      eq(discoveryRequestsTable.path, "/CaseSearch")));
  const [serverErrorSource] = await db.select().from(discoverySourceTable)
    .where(eq(discoverySourceTable.id, "UJS"));
  const [serverErrorPausedSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  const [serverErrorPausedJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, serverErrorJob!.id));
  assert.equal(failedServerErrorRequest?.statusCode, 503);
  assert.equal(failedServerErrorRequest?.outcome, "HTTP_ERROR");
  assert.ok(failedServerErrorRequest?.completedAt);
  assert.ok(serverErrorSource?.pausedUntil);
  assert.ok(serverErrorSource!.pausedUntil!.getTime() >= failedServerErrorRequest!.completedAt!.getTime() + 60_000,
    "A 5xx must retain the configured server-error backoff.");
  assert.equal(serverErrorSource?.blockedReason, "HTTP_ERROR");
  assert.equal(serverErrorPausedSearch?.status, "paused");
  assert.match(serverErrorPausedSearch?.reason ?? "", /\[AUTO_RESUME_SOURCE:HTTP_ERROR_5XX\]$/);
  assert.ok(serverErrorPausedSearch?.resumeAvailableAt);
  assert.ok(serverErrorPausedSearch!.resumeAvailableAt!.getTime() >= serverErrorSource!.pausedUntil!.getTime());
  assert.equal(serverErrorPausedJob?.status, "PAUSED");
  assert.equal(serverErrorPausedJob?.requestsUsed, 1,
    "The failed calendar request is charged to the original request budget.");
  assert.deepEqual(serverErrorPausedJob?.criteria, serverErrorCriteria);
  const earlyServerErrorRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, serverErrorJob!.id));
  assert.equal(earlyServerErrorRequests.length, 1);

  await autoContinueQuotaSearches();
  const [stillCoolingServerErrorSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  const duringServerErrorCooldownRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, serverErrorJob!.id));
  assert.equal(stillCoolingServerErrorSearch?.status, "paused",
    "Automatic continuation must wait until the recorded 5xx backoff expires.");
  assert.equal(duringServerErrorCooldownRequests.length, 1,
    "No source request may be sent before the 5xx cooldown expires.");

  const serverErrorCooldownExpired = new Date(Date.now() - 1_000);
  await db.update(bailSearchesTable).set({ resumeAvailableAt: serverErrorCooldownExpired })
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  await db.update(discoverySourceTable).set({ pausedUntil: serverErrorCooldownExpired })
    .where(eq(discoverySourceTable.id, "UJS"));
  await autoContinueQuotaSearches();
  const [accessBlockedServerErrorSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  const withoutAccessProofRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, serverErrorJob!.id));
  assert.equal(accessBlockedServerErrorSearch?.status, "paused",
    "Cooldown expiry alone must not bypass the source access-proof check.");
  assert.equal(withoutAccessProofRequests.length, 1,
    "No source request may be sent while access proof is missing.");

  // Model a fresh, successful access check; the worker may continue only after
  // that gate is restored, even though the 5xx deadline has already passed.
  await db.update(discoverySourceTable).set({
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
  }).where(eq(discoverySourceTable.id, "UJS"));
  await autoContinueQuotaSearches();
  const [resumedServerErrorSearch] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  const [resumedServerErrorJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, serverErrorJob!.id));
  const afterServerErrorResumeRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, serverErrorJob!.id));
  assert.equal(resumedServerErrorSearch?.status, "running");
  assert.equal(resumedServerErrorJob?.status, "QUEUED");
  assert.deepEqual(resumedServerErrorSearch?.criteria, templateSearch.criteria);
  assert.deepEqual(resumedServerErrorJob?.criteria, serverErrorCriteria,
    "Automatic 5xx continuation must preserve the original search criteria.");
  assert.equal(resumedServerErrorJob?.requestsUsed, 1,
    "Resuming must retain the already-consumed source request.");
  assert.equal(resumedServerErrorJob?.criteria.requestCap, serverErrorCriteria.requestCap);
  assert.equal(afterServerErrorResumeRequests.length, 1,
    "Automatic continuation queues the original job without bypassing request admission.");

  await runJob(resumedServerErrorJob!, undefined, { offlineMockSource: true });
  const [serverErrorSearchForProcessing] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, serverErrorSearch!.id));
  await runBailSearch(serverErrorSearchForProcessing!);
  const [recoveredServerErrorJob] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, serverErrorJob!.id));
  assert.equal(recoveredServerErrorJob?.status, "COMPLETED");
  assert.deepEqual(recoveredServerErrorJob?.criteria, serverErrorCriteria);
  assert.equal(recoveredServerErrorJob?.requestsUsed, 3,
    "Recovery uses the existing budget for the remaining calendar and PDF requests.");
  const recoveredServerErrorRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, serverErrorJob!.id));
  assert.deepEqual(recoveredServerErrorRequests.map(request => [request.method, request.path, request.outcome]).sort(),
    [["GET", "/Report/CpDocketSheet", "OK"], ["POST", "/CaseSearch", "HTTP_ERROR"],
      ["POST", "/CaseSearch", "OK"]]);

  const [blockedJob] = await db.insert(discoveryJobsTable).values({
    ownerId: templateJob.ownerId,
    criteria: templateJob.criteria,
    status: "PAUSED",
    calendarComplete: false,
    requestsUsed: 1,
    message: "ACCESS_DENIED: all source traffic stopped.",
  }).returning();
  jobIds.push(blockedJob!.id);
  const [blockedSearch] = await db.insert(bailSearchesTable).values({
    ownerId: searchOwner(cookie),
    discoveryJobId: blockedJob!.id,
    criteria: templateSearch.criteria,
    queue: [],
    total: 0,
    status: "paused",
    reason: "ACCESS_DENIED: all source traffic stopped.",
  }).returning();
  searchIds.push(blockedSearch!.id);
  await db.insert(discoveryRequestsTable).values({
    jobId: blockedJob!.id,
    ownerId: blockedJob!.ownerId,
    sourceId: "UJS",
    path: "/CaseSearch",
    method: "POST",
    statusCode: 403,
    outcome: "ACCESS_DENIED",
    completedAt: new Date(),
  });
  await db.update(discoverySourceTable).set({
    blockedReason: "ACCESS_DENIED",
    accessVerifiedAt: null,
    verifiedMethod: null,
    collectionApprovedAt: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  const blockedStatus = await fetch(`${origin}/api/bail-search/search/${blockedSearch!.id}/status`, {
    headers: { cookie },
  });
  assert.equal(blockedStatus.status, 200);
  const blockedBody = await blockedStatus.json() as {
    recovery: { action: string; message: string }; resumeToken: string | null;
  };
  assert.equal(blockedBody.recovery.action, "source_blocked");
  assert.match(blockedBody.recovery.message, /latest source request recorded an access denial \(HTTP 403\)/);
  assert.equal(blockedBody.resumeToken, null);
  const deniedResume = await fetch(`${origin}/api/bail-search/search/${blockedSearch!.id}/resume`, {
    method: "POST",
    headers,
    body: JSON.stringify({ resumeToken: resumeToken(blockedSearch!) }),
  });
  assert.equal(deniedResume.status, 409);
  const retainedRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, blockedJob!.id));
  assert.equal(retainedRequests.length, 1, "A blocked resume must not reserve another source request.");
  const [stillPausedJob] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, blockedJob!.id));
  const [stillPausedSearch] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, blockedSearch!.id));
  assert.equal(stillPausedJob?.status, "PAUSED");
  assert.equal(stillPausedSearch?.status, "paused");
  assert.deepEqual(stillPausedJob?.criteria, templateJob.criteria, "Resume must not broaden or rewrite original source criteria.");

  const [timedOutJob] = await db.insert(discoveryJobsTable).values({
    ownerId: templateJob.ownerId,
    criteria: templateJob.criteria,
    status: "PAUSED",
    calendarComplete: false,
    requestsUsed: 1,
    message: "TIMEOUT: source request timed out; no automatic retry.",
  }).returning();
  jobIds.push(timedOutJob!.id);
  const [timedOutSearch] = await db.insert(bailSearchesTable).values({
    ownerId: searchOwner(cookie),
    discoveryJobId: timedOutJob!.id,
    criteria: templateSearch.criteria,
    queue: [],
    total: 1,
    status: "paused",
    reason: "TIMEOUT: source request timed out; no automatic retry.",
  }).returning();
  searchIds.push(timedOutSearch!.id);
  await db.insert(bailSearchResultsTable).values({
    searchId: timedOutSearch!.id,
    docketNumber: "CP-02-CR-0005845-2026",
    hearingDate: templateSearch.criteria.startDate,
    office: "CP-05-02-Crim",
    classification: "monetary",
    amountCents: 10_000,
    evidencePage: 1,
    evidenceQuote: "10.00% unsecured bail, $100.00.",
    evidenceAcquisition: "STORED_EXTRACTION",
    qualifies: true,
  });
  await db.insert(discoveryRequestsTable).values({
    jobId: timedOutJob!.id,
    ownerId: timedOutJob!.ownerId,
    sourceId: "UJS",
    path: "/CaseSearch",
    method: "POST",
    statusCode: null,
    outcome: "TIMEOUT",
    startedAt: new Date(Date.now() - 30_000),
    completedAt: new Date(),
    durationMs: 30_000,
  });
  await db.update(discoverySourceTable).set({
    blockedReason: "TIMEOUT",
    pausedUntil: null,
    accessVerifiedAt: null,
    verifiedMethod: null,
    collectionApprovedAt: null,
  }).where(eq(discoverySourceTable.id, "UJS"));
  const timedOutStatus = await fetch(`${origin}/api/bail-search/search/${timedOutSearch!.id}/status`, {
    headers: { cookie },
  });
  assert.equal(timedOutStatus.status, 200);
  const timedOutBody = await timedOutStatus.json() as {
    incomplete: boolean;
    progress: { calendarValidated: boolean };
    recovery: { action: string; message: string; availableAt: string | null };
    resumeToken: string | null;
    results: Array<{ id: string; evidence_quote: string }>;
  };
  assert.equal(timedOutBody.incomplete, true);
  assert.equal(timedOutBody.progress.calendarValidated, false);
  assert.equal(timedOutBody.recovery.action, "wait");
  assert.ok(timedOutBody.recovery.availableAt);
  assert.ok(Date.parse(timedOutBody.recovery.availableAt!) > Date.now(),
    "A recent timeout must expose its recorded cooldown before an explicit retry.");
  assert.match(timedOutBody.recovery.message, /latest source request timed out/);
  assert.match(timedOutBody.recovery.message, /not a confirmed empty search/);
  assert.match(timedOutBody.recovery.message, /1 docket row is retained/);
  assert.ok(timedOutBody.resumeToken);
  assert.equal(timedOutBody.results.length, 1);
  assert.match(timedOutBody.results[0]!.evidence_quote, /10\.00% unsecured bail/);
  const timedOutResume = await fetch(`${origin}/api/bail-search/search/${timedOutSearch!.id}/resume`, {
    method: "POST",
    headers,
    body: JSON.stringify({ resumeToken: resumeToken(timedOutSearch!) }),
  });
  assert.equal(timedOutResume.status, 409);
  const timedOutRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, timedOutJob!.id));
  assert.equal(timedOutRequests.length, 1, "A timed-out source request must not be retried automatically or by blocked resume.");
  const [stillTimedOutJob] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, timedOutJob!.id));
  assert.equal(stillTimedOutJob?.status, "PAUSED");
  const [stillTimedOutSource] = await db.select().from(discoverySourceTable)
    .where(eq(discoverySourceTable.id, "UJS"));
  assert.equal(stillTimedOutSource?.blockedReason, "TIMEOUT");

  await db.update(discoverySourceTable).set({
    lastRequestAt: null,
    lastCompletedAt: null,
    blockedReason: null,
    pausedUntil: null,
    activeRequestId: null,
    accessVerifiedAt: new Date(),
    verifiedMethod: integratedSourceMethod,
    collectionApprovedAt: new Date(),
  }).where(eq(discoverySourceTable.id, "UJS"));
  const [resumableJob] = await db.insert(discoveryJobsTable).values({
    ownerId: templateJob.ownerId,
    criteria: templateJob.criteria,
    status: "PAUSED",
    calendarComplete: false,
    requestsUsed: 1,
    message: "Local fixture pause; resume must retain the same scope.",
  }).returning();
  jobIds.push(resumableJob!.id);
  const [resumableSearch] = await db.insert(bailSearchesTable).values({
    ownerId: searchOwner(cookie),
    discoveryJobId: resumableJob!.id,
    criteria: templateSearch.criteria,
    queue: [],
    total: 0,
    status: "paused",
    reason: "Local fixture pause.",
  }).returning();
  searchIds.push(resumableSearch!.id);
  await db.insert(discoveryRequestsTable).values({
    jobId: resumableJob!.id,
    ownerId: resumableJob!.ownerId,
    sourceId: "UJS",
    path: "/CaseSearch",
    method: "POST",
    statusCode: 200,
    outcome: "OK",
    completedAt: new Date(),
  });
  const resumableStatus = await fetch(`${origin}/api/bail-search/search/${resumableSearch!.id}/status`, {
    headers: { cookie },
  });
  assert.equal(resumableStatus.status, 200);
  const resumableBody = await resumableStatus.json() as {
    recovery: { action: string }; resumeToken: string | null;
  };
  assert.equal(resumableBody.recovery.action, "resume");
  assert.ok(resumableBody.resumeToken);
  const resumedResponse = await fetch(`${origin}/api/bail-search/search/${resumableSearch!.id}/resume`, {
    method: "POST",
    headers,
    body: JSON.stringify({ resumeToken: resumeToken(resumableSearch!) }),
  });
  assert.equal(resumedResponse.status, 200);
  const [resumedJob] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, resumableJob!.id));
  const [resumedSearch] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, resumableSearch!.id));
  assert.equal(resumedJob?.status, "QUEUED");
  assert.equal(resumedSearch?.status, "running");
  assert.deepEqual(resumedJob?.criteria, templateJob.criteria, "An allowed resume must preserve the original source scope.");
  const resumedRequests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, resumableJob!.id));
  assert.equal(resumedRequests.length, 1, "Resume queues only the existing job; it does not bypass the scheduler's request gate.");
  await db.update(discoveryJobsTable).set({ status: "RUNNING" })
    .where(eq(discoveryJobsTable.id, resumableJob!.id));

  const otherOwnerId = "offline-search-clear-other-session";
  const [otherSearch] = await db.insert(bailSearchesTable).values({
    ownerId: otherOwnerId,
    criteria: templateSearch.criteria,
    queue: [],
    total: 0,
    status: "paused",
  }).returning();
  otherSearchId = otherSearch!.id;
  const allWorkspaceSearches = await db.select({ id: bailSearchesTable.id }).from(bailSearchesTable);
  const fixtureSearchIds = new Set([...searchIds, otherSearch!.id]);
  if (allWorkspaceSearches.every(search => fixtureSearchIds.has(search.id))) {
    const candidateResponseBefore = await fetch(`${origin}/api/bail-search/candidates`, { headers: { cookie } });
    assert.equal(candidateResponseBefore.status, 200);
    const candidatesBefore = await candidateResponseBefore.json() as { id: string; evidence_page: number | null }[];

    const clearResponse = await fetch(`${origin}/api/bail-search/search`, { method: "DELETE", headers });
    assert.equal(clearResponse.status, 200);
    const clearBody = await clearResponse.json() as {
      deletedSearches: number; deletedResults: number; retainedRunning: number; retainedReviewSearches: number;
    };
    assert.equal(clearBody.deletedSearches + clearBody.retainedReviewSearches, allWorkspaceSearches.length);
    assert.ok(clearBody.retainedReviewSearches > 0, "Active Review rows keep their source searches available.");
    assert.equal(clearBody.retainedRunning, 0, "No workspace search remains active after clearing.");
    const clearedSearch = (await db.select().from(bailSearchesTable)
      .where(eq(bailSearchesTable.id, resumableSearch!.id)))[0];
    const stoppedJob = (await db.select().from(discoveryJobsTable)
      .where(eq(discoveryJobsTable.id, resumableJob!.id)))[0];
    const clearedOtherSearch = (await db.select().from(bailSearchesTable)
      .where(eq(bailSearchesTable.id, otherSearch!.id)))[0];
    assert.equal(clearedSearch, undefined, "Clear removes the active search without a Review result.");
    assert.equal(stoppedJob?.status, "PAUSED", "Clear stops queued source work before deleting its search.");
    assert.equal(clearedOtherSearch, undefined, "Workspace clear includes searches created by another session.");
    const candidateResponse = await fetch(`${origin}/api/bail-search/candidates`, { headers: { cookie } });
    assert.equal(candidateResponse.status, 200);
    const candidates = await candidateResponse.json() as { id: string; evidence_page: number | null }[];
    assert.ok(candidatesBefore.every(before => candidates.some(after =>
      after.id === before.id && after.evidence_page === before.evidence_page)),
    "Saved candidates and citations remain available after workspace search cleanup.");
    const remainingSearchResults = await db.select().from(bailSearchResultsTable)
      .where(inArray(bailSearchResultsTable.searchId, searchIds));
    assert.ok(remainingSearchResults.length > 0);
    assert.ok(remainingSearchResults.every(row => row.qualifies && row.amountCents !== null
      && !row.ambiguous && row.reviewDismissedAt === null),
    "Only active Review results remain attached to retained searches.");
    console.log("PASS: isolated workspace cleanup preserves Review rows and saved candidates.");
  } else {
    console.log("SKIP: workspace-wide history cleanup because unrelated shared searches exist.");
  }

  console.log("PASS: mocked API preserves PDF evidence, rate-limited resume scope, and server-error recovery scope.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const searchId of searchIds) {
    await db.delete(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, searchId));
    await db.delete(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
  }
  if (sharedCandidateId) await db.delete(bailRecordsTable).where(eq(bailRecordsTable.id, sharedCandidateId));
  if (otherSearchId) await db.delete(bailSearchesTable).where(eq(bailSearchesTable.id, otherSearchId));
  for (const jobId of jobIds) {
    await db.delete(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, jobId));
    await db.delete(discoveryEventsTable).where(eq(discoveryEventsTable.jobId, jobId));
    await db.delete(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, jobId));
    await db.delete(discoveryJobsTable).where(eq(discoveryJobsTable.id, jobId));
  }
  if (previousSource) {
    const { id: _id, ...values } = previousSource;
    await db.update(discoverySourceTable).set(values)
      .where(eq(discoverySourceTable.id, previousSource.id));
  } else {
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
  }
  await workerLease.query("SELECT pg_advisory_unlock(74651283)");
  workerLease.release();
  await pool.end();
}
