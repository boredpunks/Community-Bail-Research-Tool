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

const docketNumber = "CP-02-CR-0005845-2026";
const baseUrl = "https://ujsportal.pacourts.us";
const pdfUrl = `${baseUrl}/Report/CpDocketSheet?docketNumber=${docketNumber}`;
const sessionSecret = "task-115-offline-search-test-signing-key";
const isoToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

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
let searchId: string | undefined;
let jobId: string | undefined;
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

  const launch = await fetch(`${origin}/api/bail-search/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      startDate: isoToday,
      endDate: isoToday,
      maxBail: 2_000,
      source: "live",
      courtOffice: "CP-05-02-Crim",
      eventType: "Bail Hearing",
    }),
  });
  const launchBody = await launch.json() as { searchId?: string; status?: string; error?: string };
  assert.equal(launch.status, 201, launchBody.error);
  const started = launchBody as { searchId: string; status: string };
  assert.equal(started.status, "running");
  searchId = started.searchId;

  const [search] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, searchId));
  assert.ok(search?.discoveryJobId);
  jobId = search.discoveryJobId;
  const [job] = await db.select().from(discoveryJobsTable)
    .where(eq(discoveryJobsTable.id, jobId));
  assert.ok(job);

  // The test-only worker uses a local calendar HTML fixture and supplied PDF;
  // it cannot open a browser or make an HTTP request to the public court site.
  await runJob(job, undefined, { offlineMockSource: true });
  const [afterDiscovery] = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.id, searchId));
  assert.ok(afterDiscovery);
  await runBailSearch(afterDiscovery);

  const status = await fetch(`${origin}/api/bail-search/search/${searchId}/status`, { headers: { cookie } });
  assert.equal(status.status, 200);
  const response = await status.json() as {
    searchId: string;
    status: string;
    stage: string;
    progress: { calendarValidated: boolean; documentsRetrieved: number; documentsProcessed: number };
    results: Array<{
      docket_number: string; hearing_date: string; bail_amount: number | null;
      evidence_page: number | null; evidence_quote: string; document_status: string;
      evidence_acquisition: string; source_pdf_sha256: string | null;
    }>;
  };
  assert.equal(response.searchId, searchId);
  assert.equal(response.status, "complete", response.reason ?? response.stage);
  assert.equal(response.progress.calendarValidated, true);
  assert.equal(response.progress.documentsRetrieved, 1);
  assert.equal(response.progress.documentsProcessed, 1);
  assert.equal(response.results.length, 1);
  const [result] = response.results;
  assert.equal(result?.docket_number, docketNumber);
  assert.equal(result?.hearing_date, isoToday);
  assert.equal(result?.bail_amount, 100);
  assert.equal(result?.evidence_page, 1);
  assert.match(result?.evidence_quote ?? "", /10\.00%.*\$100\.00/);
  assert.equal(result?.document_status, "EXTRACTED");
  assert.equal(result?.evidence_acquisition, "STORED_EXTRACTION");
  assert.match(result?.source_pdf_sha256 ?? "", /^[a-f0-9]{64}$/);

  const requests = await db.select().from(discoveryRequestsTable)
    .where(eq(discoveryRequestsTable.jobId, jobId));
  assert.deepEqual(requests.map(request => [request.method, request.path, request.outcome]).sort(),
    [["GET", "/Report/CpDocketSheet", "OK"], ["POST", "/CaseSearch", "OK"]]);
  const [item] = await db.select().from(discoveryItemsTable)
    .where(and(eq(discoveryItemsTable.jobId, jobId), eq(discoveryItemsTable.docketNumber, docketNumber)));
  assert.equal(item?.provenance.extractionOutcome, "EXTRACTED");
  assert.equal(item?.provenance.documentSha256, result?.source_pdf_sha256);
  assert.equal(item?.sourceUrl, pdfUrl);

  console.log("PASS: live API launch → mocked calendar/PDF → identity-checked extraction → stored result → BailSearch status contract; no public court requests.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (searchId) {
    await db.delete(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, searchId));
    await db.delete(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
  }
  if (jobId) {
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
