import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, discoveryAssessmentsTable as permits, discoveryJobsTable as jobs,
  discoverySourceTable as sources } from "@workspace/db";
import { launchBoundedPermit } from "../src/lib/bounded-launch";
import { boundedEngineMethod, makeBoundedEngineCriteria } from "../src/lib/bounded-engine";
import { easternToday } from "../src/lib/discovery";
import { finishBoundedRun } from "../src/lib/bounded-report";

/** Disposable schema only. No source traffic, docket records, or documents. */
export async function boundedLaunchChecks(store: typeof db) {
  const criteria = makeBoundedEngineCriteria(easternToday(), easternToday());
  await store.insert(sources).values({ id: "UJS", blockedReason: "SOURCE_VALIDATION_BARRIER" });
  const [scope] = await store.insert(permits).values({
    stage: "BOUNDED_ENGINE", state: "PREPARED", criteria, expectedMethod: boundedEngineMethod,
    executionOwnerId: "WORKSPACE_PROTOCOL_A",
  }).returning();
  const id = scope!.id;
  assert.equal((await launchBoundedPermit("WORKSPACE_PROTOCOL_B", id, store)).status, 404);
  assert.equal((await launchBoundedPermit("WORKSPACE_PROTOCOL_A", id, store)).status, 409);
  await store.update(permits).set({ state: "APPROVED", approvedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000) }).where(eq(permits.id, id));
  const parallel = await Promise.all([
    launchBoundedPermit("WORKSPACE_PROTOCOL_A", id, store),
    launchBoundedPermit("WORKSPACE_PROTOCOL_A", id, store),
  ]);
  assert.deepEqual(parallel.map(r => r.status).sort(), [201, 409]);
  const persisted = await store.select().from(jobs);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.assessmentId, id);
  assert.deepEqual(persisted[0]!.criteria, criteria);
  assert.equal(persisted[0]!.ownerId, "WORKSPACE_PROTOCOL_A");
  const [consumed] = await store.select().from(permits).where(eq(permits.id, id));
  assert.equal(consumed!.state, "ATTEMPTED");
  assert.equal(consumed!.jobId, persisted[0]!.id);
  assert.equal((await launchBoundedPermit("WORKSPACE_PROTOCOL_A", id, store)).status, 409);
  const [barrier] = await store.select().from(sources).where(eq(sources.id, "UJS"));
  assert.equal(barrier!.blockedReason, "SOURCE_VALIDATION_BARRIER");
  assert.equal(barrier!.collectionApprovedAt, null);
  assert.equal(barrier!.activeRequestId, null);
  const [other] = await store.insert(permits).values({
    stage: "BOUNDED_ENGINE", state: "APPROVED", criteria, expectedMethod: boundedEngineMethod,
    executionOwnerId: "WORKSPACE_PROTOCOL_A", approvedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  }).returning();
  assert.equal((await launchBoundedPermit("WORKSPACE_PROTOCOL_A", other!.id, store)).status, 409);
  await store.update(jobs).set({ status: "COMPLETED", calendarComplete: true }).where(eq(jobs.id, persisted[0]!.id));
  const incomplete = await finishBoundedRun(persisted[0]!.id, id, store);
  assert.equal(incomplete.validDocuments, 0);
  const [notCompleted] = await store.select().from(permits).where(eq(permits.id, id));
  assert.equal(notCompleted!.state, "FAILED", "Launch and a completed job flag are not document-workflow proof");
  await store.delete(jobs);
  for (const change of [
    { expiresAt: new Date(0) }, { expectedMethod: "UNAPPROVED_METHOD" },
    { criteria: { ...criteria, requestCap: 13 } }, { executionOwnerId: null },
  ]) {
    await store.update(permits).set({ ...scope!, id: other!.id, state: "APPROVED",
      approvedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), ...change })
      .where(eq(permits.id, other!.id));
    assert.notEqual((await launchBoundedPermit("WORKSPACE_PROTOCOL_A", other!.id, store)).status, 201);
  }
  console.log("PASS: exact owner-scoped permit launch, concurrent/repeated launch exclusion, expiry/method/budget guards; launch alone never proves document completion");
}
