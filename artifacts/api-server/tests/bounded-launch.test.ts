import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, discoveryAssessmentsTable as permits, discoveryEventsTable as events,
  discoveryItemsTable as items, discoveryJobsTable as jobs, discoveryRequestsTable as requests,
  discoverySourceTable as sources } from "@workspace/db";
import { launchBoundedPermit } from "../src/lib/bounded-launch";
import { boundedEngineMethod, makeBoundedEngineCriteria } from "../src/lib/bounded-engine";
import { discoveryPolicy, easternToday } from "../src/lib/discovery";
import { finishBoundedRun } from "../src/lib/bounded-report";

/** Disposable schema only. No source traffic, docket records, or documents. */
export async function boundedLaunchChecks(
  store: typeof db,
  emptyEvidence: { layout: unknown; diagnostic: unknown },
) {
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

  const finalizeOfflineEmpty = async (stateMessages: string[], expectedState: "BOUNDED_COMPLETED" | "FAILED") => {
    const finalizationJobId = "offline-empty-job";
    const finalizationPermitId = "offline-empty-permit";
    const criteria = makeBoundedEngineCriteria(easternToday(), easternToday());
    const base = Date.parse("2026-10-18T00:00:00Z");
    const intervalMs = discoveryPolicy.spacingMs + 1_000;
    const ledger = [
      ["GET", "/CaseSearch"],
      ["GET", "/resource/css/sitemain.min.css"],
      ["GET", "/resource/js/sitemain.min.js"],
      ["POST", "/CaseSearch"],
    ].map(([method, path], index) => {
      const startedAt = new Date(base + index * intervalMs);
      const completedAt = new Date(startedAt.getTime() + 1_000);
      return { method, path, startedAt, completedAt, durationMs: 1_000, outcome: "OK" };
    });
    const snapshot = {
      labels: 1, controls: 1, enabled: true, sameForm: true, busy: false, options: 104,
      room506Options: 1, room506Enabled: true, room506Selected: true, namedBindings: 1,
      nativeMatches: true,
    };
    const courtroomMetadata = {
      kind: "courtroom_metadata", phase: "OBSERVED", initial: snapshot, afterCriteria: snapshot,
      afterSelection: snapshot, outcome: "BOUND_506", waitMs: 542, stable: true,
    };
    const stateEvents = stateMessages.map((message, index) => ({
      kind: "CALENDAR_STATE",
      message,
      createdAt: new Date(base + 150_000 + index * 1_000),
    }));
    const history = [
      {
        kind: "COURTROOM_METADATA",
        message: JSON.stringify(courtroomMetadata),
        createdAt: new Date(base + intervalMs * 3 - 500),
      },
      { kind: "CALENDAR_LAYOUT", message: JSON.stringify(emptyEvidence.layout), createdAt: new Date(base + 185_000) },
      { kind: "CALENDAR_RESPONSE_DIAGNOSTIC", message: JSON.stringify(emptyEvidence.diagnostic), createdAt: new Date(base + 185_500) },
      ...stateEvents.reverse(),
    ];
    const job = {
      id: finalizationJobId, assessmentId: finalizationPermitId, status: "COMPLETED", calendarComplete: true,
    };
    const permit = {
      id: finalizationPermitId, jobId: finalizationJobId, stage: "BOUNDED_ENGINE",
      expectedMethod: boundedEngineMethod, state: "ATTEMPTED", criteria,
    };
    const source = {
      id: "UJS", blockedReason: "SOURCE_VALIDATION_BARRIER", pausedUntil: null,
      accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null,
      activeRequestId: null, latencyWarning: null,
    };
    const rows = new Map<unknown, unknown[]>([
      [jobs, [job]], [permits, [permit]], [requests, ledger], [items, []],
      [events, history], [sources, [source]],
    ]);
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const offlineStore = {
      select: () => ({
        from: (table: unknown) => ({
          where: async (_condition: unknown) => rows.get(table) ?? [],
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async (_condition: unknown) => { updates.push({ table, values }); },
        }),
      }),
    } as unknown as typeof db;

    const report = await finishBoundedRun(finalizationJobId, finalizationPermitId, offlineStore);
    assert.equal(updates.find(update => update.table === permits)?.values.state, expectedState);
    return report;
  };

  const validEmptyReport = await finalizeOfflineEmpty([
    "FORM_READY; Search button visible=true.",
    "EMPTY_RESULTS_VALIDATED; Search button visible=true.",
  ], "BOUNDED_COMPLETED");
  assert.match(validEmptyReport.reason, /validated explicit no-results status/);
  const missingTerminalReport = await finalizeOfflineEmpty([
    "FORM_READY; Search button visible=true.",
  ], "FAILED");
  assert.doesNotMatch(missingTerminalReport.reason, /validated explicit no-results status/);
  const conflictingTerminalReport = await finalizeOfflineEmpty([
    "FORM_READY; Search button visible=true.",
    "RESULTS_VALIDATED; Search button visible=true.",
    "EMPTY_RESULTS_VALIDATED; Search button visible=true.",
  ], "FAILED");
  assert.doesNotMatch(conflictingTerminalReport.reason, /validated explicit no-results status/);
  console.log("PASS: bounded finalization accepts ordered FORM_READY → EMPTY_RESULTS_VALIDATED evidence and rejects missing/conflicting terminal states");

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
