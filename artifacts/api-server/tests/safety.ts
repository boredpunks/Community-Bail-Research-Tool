import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { db, pool, discoveryAssessmentsTable as pilots, discoveryJobsTable as jobs, discoveryRequestsTable as requests, discoverySourceTable as sources } from "@workspace/db";
import { allowedSourceRequest, collectionBlock, integratedSourceMethod, qualifyingMonetaryTotal, responseHealth, rollingUsage, throttleDeadline, validAccountingMessage, validCalendarDiagnostics, validCalendarFormDiagnostic } from "../src/lib/discovery-safety";
import { reserveSourceRequest, accountSourceResponse, recoverUncertainRequests } from "../src/lib/discovery-scheduler";
import { clearExpiredDiscoveryResults, expiredResumeConflict } from "../src/lib/discovery-retention";

import { formInspectionMethod, inspectionRequestAllowed, validInspectionMetadata } from "../src/lib/form-inspection";
import { coverageInspectionMethod, validCoverageMetadata } from "../src/lib/coverage-inspection";

// HTTP/protocol and job-control tests only: NO docket rows, case records,
// invented case evidence, Python source worker, or external HTTP requests.
globalThis.fetch = async () => { throw new Error("HTTP prohibited in offline safety tests"); };
const namespace = `offline_safety_${randomUUID().replaceAll("-", "")}`;
let checks = 0;
const check = (ok: unknown) => { assert.ok(ok); checks++; };
const now0 = Date.parse("2026-10-06T16:00:00Z");
let time = now0;
const approved = { id: "UJS", accessVerifiedAt: new Date(now0), verifiedMethod: integratedSourceMethod, collectionApprovedAt: new Date(now0) };
const criteria = { courtOffice: "CP-05-02-Crim", eventType: "Bail Hearing", startDate: "2026-10-06", endDate: "2026-10-06", recordCap: 1, requestCap: 12, matchTarget: 1 } as const;
const requestUrl = "https://ujsportal.pacourts.us/CaseSearch";
const PgPool = pool.constructor as new (options: object) => typeof pool;
const isolatedPool = new PgPool({ ...pool.options, options: `-c search_path=${namespace}` });
const store = drizzle(isolatedPool, { schema }) as typeof db;
const context = { store, now: () => new Date(time), sleep: async (ms: number) => { time += ms; } };
const createJob = async (extra = {}) => (await store.insert(jobs).values({ ownerId: "OFFLINE_PROTOCOL", criteria, status: "RUNNING", ...extra }).returning())[0]!;
const reserve = (job: typeof jobs.$inferSelect, extra = {}) => reserveSourceRequest(job, "/CaseSearch", "GET", undefined, requestUrl, () => false, { ...context, ...extra });
const response = (job: typeof jobs.$inferSelect, id: string, outcome = "OK", status: number | null = 200, retryAfter: string | null = null) =>
  accountSourceResponse(job, { requestId: id, outcome, status, retryAfter }, context);
async function reset(verify = true) {
  await isolatedPool.query("TRUNCATE discovery_requests, discovery_assessments, discovery_jobs, discovery_source_control");
  time = now0;
  await store.insert(sources).values(verify ? approved : { id: "UJS" });
}

try {
  const formDiagnostic = { code: "CALENDAR_CONTROL_STATE_MISMATCH", control: "COURT_OFFICE", reason: "DISABLED" };
  check(validCalendarFormDiagnostic(formDiagnostic));
  check(!validCalendarFormDiagnostic({ ...formDiagnostic, control: "raw-field-value" }));
  check(!validCalendarFormDiagnostic({ ...formDiagnostic, reason: "raw console message" }));
  check(!validCalendarFormDiagnostic({ ...formDiagnostic, reason: "SUBMITTED_COUNT_MISMATCH" }));
  check(validCalendarFormDiagnostic({ code: "CALENDAR_SUBMITTED_VALUES_MISMATCH", control: "START_DATE", reason: "SUBMITTED_COUNT_MISMATCH" }));
  for (const reason of ["BACKING_CONTROL_MISSING", "BACKING_CONTROL_AMBIGUOUS", "BACKING_VALUE_MISMATCH"])
    check(validCalendarFormDiagnostic({ ...formDiagnostic, reason }));
  // A disposable schema cloned WITHOUT source data. Separate pool connections
  // exercise real PostgreSQL row locking and the one-in-flight unique index.
  await pool.query(`CREATE SCHEMA ${namespace}`);
  for (const name of ["discovery_jobs", "discovery_requests", "discovery_source_control", "discovery_assessments", "discovery_items", "bail_records"]) {
    await pool.query(`CREATE TABLE ${namespace}.${name} (LIKE public.${name} INCLUDING ALL)`);
  }
  check(collectionBlock(undefined) === "ACCESS_UNVERIFIED");
  check(collectionBlock({ ...approved, blockedReason: null, pausedUntil: null }) === null);
  check(collectionBlock({ ...approved, blockedReason: null, pausedUntil: null, verifiedMethod: "DIFFERENT_CLIENT" }) === "ACCESS_UNVERIFIED");
  check(collectionBlock({ ...approved, blockedReason: null, pausedUntil: null, collectionApprovedAt: null }) === "COLLECTION_NOT_APPROVED");
  check(collectionBlock({ ...approved, blockedReason: "ACCESS_DENIED", pausedUntil: new Date(0) }) === "ACCESS_DENIED");
  check(allowedSourceRequest(requestUrl, "GET"));
  check(!allowedSourceRequest("https://example.invalid/CaseSearch", "GET"));
  check(!allowedSourceRequest(`${requestUrl}?unexpected=1`, "GET"));
  check(!allowedSourceRequest("https://ujsportal.pacourts.us/resource/js/sitemain.min.js?unexpected=1", "GET"));
  check(collectionBlock({ ...approved, blockedReason: null, pausedUntil: null,
    verifiedMethod: "playwright-calendar+urllib-pdf-v1" }) === "ACCESS_UNVERIFIED");
  const version = "offlineVersionHash_1234567890";
  for (const asset of ["/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css"]) {
    const url = `https://ujsportal.pacourts.us${asset}`;
    check(allowedSourceRequest(url, "GET"));
    check(allowedSourceRequest(`${url}?v=${version}`, "GET"));
    for (const query of ["v=", "v=short", `v=${"a".repeat(129)}`, `v=${version}&`,
      `v=${version}&unexpected=1`, `v=${version}&v=${version}`, `v=${version}%0A`,
      `other=${version}`, "v=../../unapproved"]) check(!allowedSourceRequest(`${url}?${query}`, "GET"));
    check(!allowedSourceRequest(`${url}?v=${version}`, "POST"));
    check(!allowedSourceRequest(`${url}?v=${version}#fragment`, "GET"));
  }
  check(!allowedSourceRequest(`https://ujsportal.pacourts.us/resource/js/other.js?v=${version}`, "GET"));
  const diagnostic = { phase: "READY", blockedScripts: 0, blockedStylesheets: 0, blockedRequests: 0, pageErrors: 0, consoleErrors: 0, optionalConsoleErrors: 0, scriptLoaded: true, stylesheetLoaded: true };
  check(validCalendarDiagnostics(diagnostic));
  check(!validCalendarDiagnostics({ ...diagnostic, pageErrors: -1 }));
  check(!validCalendarDiagnostics({ ...diagnostic, phase: "unknown" }));
  check(!validCalendarDiagnostics({ ...diagnostic, scriptLoaded: "true" }));
  check(!allowedSourceRequest("https://ujsportal.pacourts.us/Report/CpDocketSheet?docketNumber=not-a-docket", "GET"));
  const instant = new Date(now0);
  check(rollingUsage([new Date(now0 - 3_600_000)], instant, 1, 120).hourlyUsed === 0);
  check(rollingUsage([new Date(now0 - 86_400_000)], instant, 30, 1).dailyUsed === 0);
  check(rollingUsage([new Date(now0 - 1000)], instant, 1, 120).blockedReason === "HOURLY_REQUEST_LIMIT");
  check(throttleDeadline(instant, 900_000, 0, "5").getTime() === now0 + 900_000);
  check(throttleDeadline(instant, 900_000, 0, "1800").getTime() === now0 + 1_800_000);
  check(throttleDeadline(instant, 900_000, 0, new Date(now0 + 3_600_000).toUTCString()).getTime() === now0 + 3_600_000);
  check(throttleDeadline(instant, 900_000, 1, "invalid").getTime() === now0 + 1_800_000);
  check(responseHealth({ adaptiveSpacingMs: 60_000, slowResponseStreak: 2 }, 30_000, [1000], 60_000).adaptiveSpacingMs === 120_000);
  check(responseHealth({ adaptiveSpacingMs: 60_000, slowResponseStreak: 2 }, 30_000, [30_000, 30_000], 60_000).adaptiveSpacingMs === 120_000);
  check(responseHealth({ adaptiveSpacingMs: 120_000, slowResponseStreak: 5 }, 30_000, [1000], 60_000).blockedReason === "RESPONSE_DETERIORATION");
  check(responseHealth({ adaptiveSpacingMs: 120_000, slowResponseStreak: 3 }, 1000, [1000], 60_000).adaptiveSpacingMs === 120_000);
  check(qualifyingMonetaryTotal("MONETARY", "TOTAL_BAIL", 500_000, 500_000, true));
  check(!qualifyingMonetaryTotal("MONETARY", "TOTAL_BAIL", 500_000, 500_000, false));
  check(!qualifyingMonetaryTotal("UNSECURED", "UNSECURED_AMOUNT", 500_000, 500_000, true));
  check(!qualifyingMonetaryTotal("MONETARY", "TOTAL_BAIL", null, 500_000, true));
  check(!validAccountingMessage({ requestId: randomUUID(), status: 403, outcome: "OK" }));
  check(!validAccountingMessage({ requestId: randomUUID(), status: null, outcome: "UNRECOGNIZED" }));

  await reset(false);
  const unverified = await createJob();
  check(!(await reserve(unverified)).allow);
  check((await store.select().from(requests)).length === 0);

  await reset();
  const first = await createJob(), second = await createJob();
  const a = await reserve(first);
  assert.ok(a.allow && a.requestId);
  let release: () => void = () => {}, entered: () => void = () => {};
  const enteredWait = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let waits = 0;
  const bPromise = reserve(second, { sleep: async (ms: number) => { if (!waits++) { entered(); await gate; } time += ms; } });
  await enteredWait;
  check((await store.select().from(requests)).length === 1);
  // Even bypassing the application, PostgreSQL forbids a second live slot.
  await assert.rejects(store.insert(requests).values({ jobId: second.id, ownerId: second.ownerId, path: "/CaseSearch", method: "GET" }));
  checks++;
  time += 2000;
  const completed = time;
  check(await response(first, a.requestId));
  release();
  const b = await bPromise;
  assert.ok(b.allow && b.requestId);
  const [reserved] = await store.select().from(requests).where(eq(requests.id, b.requestId));
  check(reserved!.startedAt.getTime() >= completed + 60_000);
  await response(second, b.requestId);

  // Stop racing with a waiting grant: no post-stop request is reserved.
  await reset();
  const failing = await createJob(), waiting = await createJob();
  const f = await reserve(failing);
  assert.ok(f.allow && f.requestId);
  let unblock: () => void = () => {}, signal: () => void = () => {};
  const seen = new Promise<void>((resolve) => { signal = resolve; });
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const waitingPromise = reserve(waiting, { sleep: async () => { signal(); await blocked; } });
  await seen;
  check(!await response(failing, f.requestId, "RATE_LIMIT", 429, "5"));
  unblock();
  check(!(await waitingPromise).allow);
  const [rateState] = await store.select().from(sources);
  check(rateState!.pausedUntil!.getTime() >= time + 900_000);
  check(rateState!.adaptiveSpacingMs === 120_000);
  check((await store.select().from(requests)).length === 1);

  for (const [outcome, status] of [["ACCESS_DENIED", 403], ["CHALLENGE", 200], ["REDIRECT", 302], ["TIMEOUT", null], ["INVALID_PDF", 200]] as const) {
    await reset();
    const job = await createJob(), next = await createJob();
    const grant = await reserve(job);
    assert.ok(grant.allow && grant.requestId);
    check(!await response(job, grant.requestId, outcome, status));
    check(!(await reserve(next)).allow);
    check((await store.select().from(requests)).length === 1);
  }

  for (const [count, age, reason] of [[30, 1_800_000, "HOURLY_REQUEST_LIMIT"], [120, 7_200_000, "DAILY_REQUEST_LIMIT"]] as const) {
    await reset();
    const job = await createJob();
    await store.insert(requests).values(Array.from({ length: count }, () => ({
      jobId: job.id, ownerId: job.ownerId, path: "/CaseSearch", method: "GET", outcome: "OK",
      startedAt: new Date(time - age), completedAt: new Date(time - age + 100),
    })));
    const denied = await reserve(job);
    check(!denied.allow && "reason" in denied && denied.reason?.startsWith(reason));
    check((await store.select().from(requests)).length === count);
  }
  await reset();
  const capped = await createJob({ requestsUsed: 12 });
  check(!(await reserve(capped)).allow);
  check((await store.select().from(requests)).length === 0);

  await reset();
  const interrupted = await createJob();
  const pending = await reserve(interrupted);
  assert.ok(pending.allow);
  await recoverUncertainRequests(context);
  const [uncertain] = await store.select().from(requests);
  check(uncertain!.outcome === "UNCERTAIN_AFTER_RESTART");
  const [retained] = await store.select().from(jobs).where(eq(jobs.id, interrupted.id));
  check(retained!.requestsUsed === 1);
  check(!(await reserve(await createJob())).allow);

  await reset(false);
  const [permit] = await store.insert(pilots).values({ stage: "SINGLE", expectedMethod: integratedSourceMethod, criteria }).returning();
  const pilot = await createJob({ assessmentId: permit!.id });
  check(!(await reserveSourceRequest(pilot, "/CaseSearch", "GET", permit!.id, requestUrl, () => false, context)).allow);
  check((await store.select().from(requests)).length === 0);
  await store.update(jobs).set({ status: "RUNNING" }).where(eq(jobs.id, pilot.id));
  await store.update(pilots).set({ state: "ATTEMPTED", jobId: pilot.id, approvedAt: instant, expiresAt: new Date(time - 1) }).where(eq(pilots.id, permit!.id));
  check(!(await reserveSourceRequest(pilot, "/CaseSearch", "GET", permit!.id, requestUrl, () => false, context)).allow);

  await reset();
  const expired = await createJob({ status: "PAUSED", updatedAt: new Date(time - 86_400_001) });
  await clearExpiredDiscoveryResults(new Date(time), store);
  const [expiredState] = await store.select().from(jobs).where(eq(jobs.id, expired.id));
  check(!!expiredState!.resultsExpiredAt);
  check(expiredState!.resultCounts?.discovered === 0);
  check((await store.select().from(schema.discoveryItemsTable)).length === 0);
  check((await store.select().from(schema.bailRecordsTable)).length === 0);
  assert.deepEqual(expiredResumeConflict(expiredState!, new Date(time)), {
    status: 409,
    error: "Unsaved results/checkpoints expired after 24 hours. This job cannot replay collection.",
  });
  checks++;
  const inspectionMetadata = { kind: "inspection_metadata", phase: "BEFORE", controls:
    ["SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "START_DATE", "END_DATE", "EVENT_TYPE"].map(control => ({
      control, uiPresent: true, uiNamed: false, uiEnabled: true, uiSameForm: true, uiMatches: true,
      types: { hidden: 0, text: 1, date: 0, number: 0, select: 0, other: 0 },
      sameFormNamed: 1, outsideContainerNamed: 0, nativeMatches: 1, nativePostedMatches: 0, knownKeyPostedMatches: 0,
    })) };
  check(validInspectionMetadata(inspectionMetadata));
  check(!validInspectionMetadata({ ...inspectionMetadata, html: "forbidden" }));
  check(!validInspectionMetadata({ ...inspectionMetadata, controls: [...inspectionMetadata.controls, inspectionMetadata.controls[0]] }));
  for (const bad of [
    { ...inspectionMetadata.controls[0], value: "forbidden" },
    { ...inspectionMetadata.controls[0], control: "unexpected" },
    { ...inspectionMetadata.controls[0], nativePostedMatches: 1 },
    { ...inspectionMetadata.controls[0], sameFormNamed: 33 },
    { ...inspectionMetadata.controls[0], types: { ...inspectionMetadata.controls[0]!.types, cookie: 1 } },
  ]) check(!validInspectionMetadata({ ...inspectionMetadata, controls: [bad, ...inspectionMetadata.controls.slice(1)] }));
  check(inspectionRequestAllowed("/CaseSearch", "GET"));
  check(!inspectionRequestAllowed("/CaseSearch", "POST"));
  check(!inspectionRequestAllowed("/Report/CpDocketSheet", "GET"));
  const coverageMetadata = { kind: "coverage_metadata", phase: "INITIAL",
    modeAvailable: true, calendarChoicePresent: false, filingChoicePresent: false,
    bailHearingPresent: false, preliminarySingularPresent: false, preliminaryPluralPresent: false,
    districtMatchesScope: true, officeCodes: ["CP-05-02-Crim"], dates: [], unretainedModeOptions: 0 };
  check(validCoverageMetadata(coverageMetadata));
  for (const bad of [
    { ...coverageMetadata, html: "forbidden" }, { ...coverageMetadata, phase: "UNVERIFIED" },
    { ...coverageMetadata, officeCodes: ["CP-04-02-Crim"] },
    { ...coverageMetadata, officeCodes: ["CP-05-02-Crim", "CP-05-02-Crim"] },
    { ...coverageMetadata, officeCodes: ["raw-source-value"] },
    { ...coverageMetadata, calendarChoicePresent: 1 },
    { ...coverageMetadata, unretainedModeOptions: 65 },
    { ...coverageMetadata, dates: [{ purpose: "FILING", minimum: "2026-02-30", maximum: null, visible: true, enabled: true }] },
    { ...coverageMetadata, dates: [{ purpose: "FILING", minimum: null, maximum: null, visible: true, enabled: true, value: "forbidden" }] },
  ]) check(!validCoverageMetadata(bad));
  for (const stage of ["INSPECT", "COVERAGE"]) for (const [path, method, url] of [
    ["/CaseSearch", "GET", requestUrl],
    ["/CaseSearch", "POST", requestUrl],
    ["/Report/CpDocketSheet", "GET", "https://ujsportal.pacourts.us/Report/CpDocketSheet"],
  ]) {
    await reset(false);
    await store.update(sources).set({ blockedReason: "SOURCE_VALIDATION_BARRIER" }).where(eq(sources.id, "UJS"));
    const inspectCriteria = { ...criteria, requestCap: 3 };
    const [inspectionPermit] = await store.insert(pilots).values({
      stage, expectedMethod: stage === "COVERAGE" ? coverageInspectionMethod : formInspectionMethod, criteria: inspectCriteria,
      state: "ATTEMPTED", approvedAt: instant, expiresAt: new Date(now0 + 3_600_000),
    }).returning();
    const inspectionJob = await createJob({ criteria: inspectCriteria, assessmentId: inspectionPermit!.id });
    await store.update(pilots).set({ jobId: inspectionJob.id }).where(eq(pilots.id, inspectionPermit!.id));
    const result = await reserveSourceRequest(inspectionJob, path, method, inspectionPermit!.id, url, () => false, context);
    check(result.allow === (method === "GET" && path === "/CaseSearch"));
    const [sourceState] = await store.select().from(sources);
    check(sourceState!.blockedReason === "SOURCE_VALIDATION_BARRIER" && !sourceState!.accessVerifiedAt && !sourceState!.collectionApprovedAt);
  }
  console.log(`PASS: ${checks} offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.`);
} finally {
  await isolatedPool.end();
  await pool.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
  await pool.end();
}
