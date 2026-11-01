import assert from "node:assert/strict";
import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  bailSearchResultsTable, bailSearchesTable, db, discoveryEventsTable, discoveryItemsTable,
  discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, pool,
} from "@workspace/db";
import app from "../src/app";
import { integratedSourceMethod } from "../src/lib/discovery-safety";
import { runJob } from "../src/lib/discovery-worker";
import { createWorkspaceSession, WORKSPACE_COOKIE_NAME } from "../src/middlewares/researchAuth";
import { runBailSearch } from "../src/services/bail-search-worker";

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
    await runJob(job, undefined, { offlineMockSource: true });
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
      progress: { calendarValidated: boolean; documentsRetrieved: number; documentsProcessed: number };
      results: Array<{
        docket_number: string; hearing_date: string; bail_amount: number | null;
        evidence_page: number | null; evidence_quote: string; document_status: string;
        evidence_acquisition: string; source_pdf_sha256: string | null;
      }>;
    };
    assert.equal(response.searchId, started.searchId);
    assert.equal(response.status, "complete", response.reason ?? response.stage);
    assert.equal(response.progress.calendarValidated, true);
    assert.equal(response.progress.documentsRetrieved, 1);
    assert.equal(response.progress.documentsProcessed, 1);
    assert.equal(response.results.length, 1);
    const [result] = response.results;
    assert.equal(result?.docket_number, scenario.docketNumber);
    assert.equal(result?.hearing_date, scenario.startDate);
    assert.match(result?.source_pdf_sha256 ?? "", /^[a-f0-9]{64}$/);

    const requests = await db.select().from(discoveryRequestsTable)
      .where(eq(discoveryRequestsTable.jobId, search.discoveryJobId));
    assert.deepEqual(requests.map(request => [request.method, request.path, request.outcome]).sort(),
      [["GET", scenario.documentPath, "OK"], ["POST", "/CaseSearch", "OK"]]);
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

  console.log("PASS: live API launch/status preserves both extracted bail evidence and a verified no-bail-section calendar result; no public court requests.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const searchId of searchIds) {
    await db.delete(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, searchId));
    await db.delete(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
  }
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
