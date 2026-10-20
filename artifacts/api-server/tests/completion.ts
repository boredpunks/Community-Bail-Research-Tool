/** Offline contracts and genuine-fixture saving; all database writes roll back. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { db, pool, discoveryJobsTable, discoveryItemsTable, bailRecordsTable } from "@workspace/db";
import { GetDiscoveryJobResponse } from "@workspace/api-zod";
import { projectQualifyingRows } from "@workspace/bail-research";
import { newResearchCriteria, criteriaIdentity } from "../src/lib/discovery-launch";
import { matchesDiscoveryFilters } from "../src/lib/discovery";
import { observationValues } from "../src/lib/discovery-candidates";
import { createWorkspaceSession, hasValidWorkspaceSession } from "../src/middlewares/researchAuth";
import { eq } from "drizzle-orm";

class IntentionalRollback extends Error {}
const root = path.resolve("../..");
const now = new Date();
let savedFixtureId: string | undefined;
const date = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"}).format(now);
const input = {courtOffice: "CP-05-02-Crim", courtRoom: "ANY", eventType: "Formal Arraignment",
  startDate: date, endDate: date, recordCap: 1, requestCap: 8, matchTarget: 1,
  matchFilters: {monetaryUpperBoundCents: 10000, excludeShownPosted: false}};
const criteria = newResearchCriteria(input);
assert.equal(criteria.resultVersion, 2);
assert.equal(criteria.matchFilters?.inclusiveMaximum, true);
assert.equal(criteriaIdentity(criteria), criteriaIdentity(Object.fromEntries(Object.entries(criteria).reverse())));
assert.notEqual(criteriaIdentity(criteria), criteriaIdentity({...criteria, matchFilters: {...criteria.matchFilters, monetaryUpperBoundCents: 9999}}));
for (const bad of [{...input, startDate: "2026-02-30"}, {...input, matchTarget: 2},
  {...input, recordCap: 201}, {...input, eventType: "Not an observed event"},
  {...input, matchFilters: {monetaryUpperBoundCents: -1}}]) assert.throws(() => newResearchCriteria(bad));

const run = spawnSync("python", ["-c",
  "import json,sys; from evidence import extract_bail; print(json.dumps(extract_bail(open(sys.argv[1],'rb').read(),'CP-02-CR-0005845-2026')))",
  path.join(root, "attached_assets/CpDocketSheet_1792451669525.pdf")],
{encoding: "utf8", env: {...process.env, PYTHONPATH: path.join(root, "artifacts/api-server/src/ujs")}});
assert.equal(run.status, 0, "Genuine fixture extraction failed");
const parsed = JSON.parse(run.stdout);
const provenance = {calendarUrl: `urn:sha256:${parsed.documentSha256}`, calendarRetrievedAt: now.toISOString(),
  courtOffice: "CP-05-02-Crim", courtType: "COMMON_PLEAS" as const,
  eventType: "Formal Arraignment", eventDate: "2026-10-20", filingDate: null,
  matchingEvents: [{eventDate: "2026-10-20", eventType: "Formal Arraignment", eventTime: "8:00 am"}],
  documentAcquisition: "MANUAL_UPLOAD" as const, ...parsed};
assert.equal(matchesDiscoveryFilters(provenance, criteria.matchFilters, 2), true);
assert.equal(matchesDiscoveryFilters(provenance, criteria.matchFilters), false);
assert.equal(matchesDiscoveryFilters({...provenance, entries: [], extractionOutcome: "MISSING_BAIL_SECTION"}, undefined, 2), false);
assert.equal(matchesDiscoveryFilters({...provenance, entries: [], extractionOutcome: "MISSING_BAIL_SECTION"}, undefined), true);

try {
  await db.transaction(async tx => {
    const [job] = await tx.insert(discoveryJobsTable).values({ownerId: `offline-acceptance-${randomUUID()}`,
      criteria, status: "COMPLETED", message: "Offline acceptance transaction; always rolled back."}).returning();
    const [item] = await tx.insert(discoveryItemsTable).values({jobId: job!.id, ownerId: job!.ownerId,
      docketNumber: "CP-02-CR-0005845-2026", position: 0, sourceUrl: provenance.calendarUrl,
      sourceRetrievedAt: now, provenance, excerpt: parsed.excerpt, detail: parsed.detail}).returning();
    const rows = projectQualifyingRows([item!], criteria.matchFilters);
    assert.equal(rows.length, 1);
    const report = {job: {id: job!.id, criteria, status: "COMPLETED",
      requestsUsed: 0, completedRequests: 0, failedRequests: 0, discovered: 1, processed: 1,
      matching: 1, targetReached: true, failed: 0, unprocessed: 0,
      calendarComplete: false, paginationComplete: false, resultCapReached: false,
      message: "OFFLINE acceptance, not live calendar proof", createdAt: now.toISOString(), updatedAt: now.toISOString(),
      resultsExpireAt: null, resultsExpiredAt: null, candidateDockets: 0, isAssessment: false},
      items: [{...item, sourceRetrievedAt: now.toISOString(), savedRecordIds: [], savedObservations: []}], events: []};
    GetDiscoveryJobResponse.parse(report);
    assert.equal(typeof report.items[0].provenance.matchingEvents![0].eventDate, "string");
    const [saved] = await tx.insert(bailRecordsTable).values(observationValues(job!.ownerId, item!, parsed.entries[0])).returning();
    savedFixtureId = saved!.id;
    // Separate SELECT exercises the actual destination type and stored JSON,
    // not only INSERT ... RETURNING or an independently recreated enum.
    const [readback] = await tx.select().from(bailRecordsTable).where(eq(bailRecordsTable.id, saved!.id));
    assert.equal(readback!.amountCents, 10000);
    assert.equal(readback!.financialBasis, "RECORDED_BAIL_AMOUNT");
    assert.equal(readback!.discoveryEvidence!.entries[0]!.percentageCondition, "10.00%");
    assert.deepEqual(readback!.discoveryEvidence!.entries[0]!.sourcePages, [1]);
    assert.equal(readback!.discoveryEvidence!.entries[0]!.excerpt, parsed.entries[0].excerpt);
    assert.equal(readback!.evidenceNote, parsed.excerpt);
    assert.equal(saved!.financialBasis, "RECORDED_BAIL_AMOUNT");
    assert.equal(saved!.amountCents, 10000);
    const [reviewed] = await tx.update(bailRecordsTable).set({reviewStatus: "CONFIRMED",
      orderInterpretation: "UNRESOLVED", reviewComment: "Offline fixture verification only", reviewedAt: now})
      .where(eq(bailRecordsTable.id, saved!.id)).returning();
    assert.equal(reviewed!.orderInterpretation, "UNRESOLVED");
    throw new IntentionalRollback();
  });
} catch (error) {
  if (!(error instanceof IntentionalRollback)) throw error;
} finally {
  if (savedFixtureId) {
    const remaining = await db.select().from(bailRecordsTable).where(eq(bailRecordsTable.id, savedFixtureId));
    assert.equal(remaining.length, 0, "Fixture transaction must leave no saved rows");
  }
  await pool.end();
}

// Use an isolated fake signing key for auth format tests, never a real secret.
process.env.SESSION_SECRET = "offline-test-signing-key-not-used-by-any-service";
const token = createWorkspaceSession();
assert.equal(hasValidWorkspaceSession({headers: {cookie: `cbr_workspace=${token}`}} as never), true);
assert.equal(hasValidWorkspaceSession({headers: {cookie: "cbr_workspace=invalid"}} as never), false);
console.log("PASS: criteria normalization/idempotency, new and legacy filters, genuine response contract/date strings, additive financial basis saving/review (rolled back), and session validation.");
