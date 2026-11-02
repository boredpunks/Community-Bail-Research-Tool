import assert from "node:assert/strict";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "offline-clear-search-history-test-signing-key";

const [{ default: app }, dbModule, authModule, storeModule] = await Promise.all([
  import("../src/app"),
  import("@workspace/db"),
  import("../src/middlewares/researchAuth"),
  import("../src/services/bail-search-store"),
]);
const { bailSearchResultsTable, bailSearchesTable, db, discoveryJobsTable, pool } = dbModule;
const { createWorkspaceSession, WORKSPACE_COOKIE_NAME } = authModule;
const { searchOwner } = storeModule;

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const criteria = { startDate: today, endDate: today, maxBail: 2_000, source: "saved" as const };
const ownerCookie = `${WORKSPACE_COOKIE_NAME}=${createWorkspaceSession()}`;
const ownerId = searchOwner(ownerCookie);
const otherCookie = `${WORKSPACE_COOKIE_NAME}=${createWorkspaceSession()}`;
const otherOwnerId = searchOwner(otherCookie);
const createdIds: string[] = [];
let createdJobId: string | undefined;
const server = createServer(app);

try {
  const [runningJob] = await db.insert(discoveryJobsTable).values({
    ownerId,
    criteria: {
      courtOffice: "ANY",
      eventType: "Bail Hearing",
      startDate: today,
      endDate: today,
      recordCap: 5,
      requestCap: 8,
    },
    status: "RUNNING",
  }).returning();
  createdJobId = runningJob!.id;
  const [complete, paused, running, other] = await Promise.all([
    db.insert(bailSearchesTable).values({
      ownerId, criteria, queue: [], total: 0, status: "complete",
    }).returning(),
    db.insert(bailSearchesTable).values({
      ownerId, criteria, queue: [], total: 0, status: "paused",
    }).returning(),
    db.insert(bailSearchesTable).values({
      ownerId, discoveryJobId: runningJob!.id,
      criteria: { ...criteria, source: "live" }, queue: [], total: 0, status: "running",
    }).returning(),
    db.insert(bailSearchesTable).values({
      ownerId: otherOwnerId, criteria, queue: [], total: 0, status: "complete",
    }).returning(),
  ]);
  const ownSearchIds = [complete[0]!.id, paused[0]!.id, running[0]!.id];
  const otherSearchId = other[0]!.id;
  createdIds.push(...ownSearchIds, otherSearchId);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = {
    cookie: ownerCookie,
    origin,
    "content-type": "application/json",
  };
  const candidatesBeforeResponse = await fetch(`${origin}/api/bail-search/candidates`, { headers: { cookie: ownerCookie } });
  assert.equal(candidatesBeforeResponse.status, 200);
  const candidatesBefore = await candidatesBeforeResponse.json() as { id: string; evidence_page: number | null }[];

  const response = await fetch(`${origin}/api/bail-search/search`, { method: "DELETE", headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedSearches: 3,
    deletedResults: 0,
    retainedRunning: 0,
  });
  const [stoppedJob] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, runningJob!.id));
  assert.equal(stoppedJob?.status, "PAUSED", "Clearing a running search pauses its linked source job.");
  const survivors = await db.select({ id: bailSearchesTable.id }).from(bailSearchesTable);
  assert.ok(!survivors.some(row => ownSearchIds.includes(row.id)), "Only this session's past searches are removed.");
  assert.ok(survivors.some(row => row.id === otherSearchId), "Another session's search remains.");
  const candidatesAfterResponse = await fetch(`${origin}/api/bail-search/candidates`, { headers: { cookie: ownerCookie } });
  assert.equal(candidatesAfterResponse.status, 200);
  const candidatesAfter = await candidatesAfterResponse.json() as { id: string; evidence_page: number | null }[];
  assert.ok(candidatesBefore.every(before => candidatesAfter.some(after =>
    after.id === before.id && after.evidence_page === before.evidence_page)),
  "Saved candidates and citations remain after search history is cleared.");
  console.log("PASS: clear-search API removes only the current session's searches and preserves workspace candidates.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const searchId of createdIds) {
    await db.delete(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, searchId));
    await db.delete(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
  }
  if (createdJobId) await db.delete(discoveryJobsTable).where(eq(discoveryJobsTable.id, createdJobId));
  await pool.end();
}
