import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { db, pool, discoveryAssessmentsTable as pilots, discoveryJobsTable as jobs, discoveryRequestsTable as requests, discoverySourceTable as sources } from "@workspace/db";
import { allowedSourceRequest, calendarPreviewCriteria, calendarPreviewMethod, calendarPreviewRequestAllowed, calendarPreviewSourceAllowed, isCalendarPreviewCriteria, collectionBlock, integratedSourceMethod, qualifyingMonetaryTotal, responseHealth, rollingUsage, throttleDeadline, validAccountingMessage, validCalendarDiagnostics, validCalendarFormDiagnostic } from "../src/lib/discovery-safety";
import { reserveSourceRequest, accountSourceResponse, recoverUncertainRequests } from "../src/lib/discovery-scheduler";
import { clearExpiredDiscoveryResults, expiredResumeConflict } from "../src/lib/discovery-retention";

import { formInspectionLiveEnabled, formInspectionMethod, inspectionRequestAllowed, validInspectionMetadata } from "../src/lib/form-inspection";
import { coverageInspectionMethod, validCoverageMetadata } from "../src/lib/coverage-inspection";
import { filingInspectionMethod, filingRoles, validFilingMetadata, validFilingInventoryMetadata } from "../src/lib/filing-inspection";

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
  // Read literal public labels from Python without executing the source client.
  // A new worker label must fail here until the parent accepts the same contract.
  const formProtocol = JSON.parse(execFileSync("python", ["-c", [
    "import ast, json",
    "tree = ast.parse(open('src/ujs/calendar_protocol.py').read())",
    "names = {'PUBLIC_CONTROLS', 'CONTROL_REASONS', 'SUBMITTED_REASONS'}",
    "values = {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in names}",
    "print(json.dumps(values))",
  ].join("\n")], { encoding: "utf8" })) as Record<string, string[]>;
  for (const control of formProtocol.PUBLIC_CONTROLS!) {
    for (const reason of formProtocol.CONTROL_REASONS!) {
      check(validCalendarFormDiagnostic({
        kind: "calendar_form_diagnostic", code: "CALENDAR_CONTROL_STATE_MISMATCH", control, reason,
      }));
    }
    for (const reason of formProtocol.SUBMITTED_REASONS!)
      check(validCalendarFormDiagnostic({
        kind: "calendar_form_diagnostic", code: "CALENDAR_SUBMITTED_VALUES_MISMATCH", control, reason,
      }));
  }
  check(!validCalendarFormDiagnostic({ ...formDiagnostic, kind: "unknown" }));
  check(!validCalendarFormDiagnostic({ ...formDiagnostic, html: "untrusted" }));
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

  // A worker restart cannot replay a diagnostic GET or refund its request
  // budget. Keep this isolated from the source and preserve all access gates.
  await reset(false);
  await store.update(sources).set({
    blockedReason: "SOURCE_VALIDATION_BARRIER",
    accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null,
  }).where(eq(sources.id, "UJS"));
  const diagnosticCriteria = { ...criteria, requestCap: 3 };
  const [coveragePermit] = await store.insert(pilots).values({
    stage: "COVERAGE", expectedMethod: coverageInspectionMethod, criteria: diagnosticCriteria,
    state: "ATTEMPTED", approvedAt: instant, expiresAt: new Date(now0 + 3_600_000),
  }).returning();
  const diagnosticJob = await createJob({
    criteria: diagnosticCriteria, assessmentId: coveragePermit!.id,
  });
  await store.update(pilots).set({ jobId: diagnosticJob.id }).where(eq(pilots.id, coveragePermit!.id));
  const diagnosticGrant = await reserveSourceRequest(
    diagnosticJob, "/CaseSearch", "GET", coveragePermit!.id, requestUrl, () => false, context,
  );
  assert.ok(diagnosticGrant.allow && diagnosticGrant.requestId);
  const [sourceBeforeRestart] = await store.select().from(sources);
  check(sourceBeforeRestart!.blockedReason === "SOURCE_VALIDATION_BARRIER"
    && !sourceBeforeRestart!.accessVerifiedAt && !sourceBeforeRestart!.verifiedMethod
    && !sourceBeforeRestart!.collectionApprovedAt);
  await store.update(jobs).set({ status: "PAUSED" }).where(eq(jobs.id, diagnosticJob.id));
  await recoverUncertainRequests(context);
  const [uncertainDiagnostic] = await store.select().from(requests)
    .where(eq(requests.id, diagnosticGrant.requestId));
  const [recoveredDiagnosticJob] = await store.select().from(jobs)
    .where(eq(jobs.id, diagnosticJob.id));
  const [sourceAfterRestart] = await store.select().from(sources);
  check(uncertainDiagnostic!.path === "/CaseSearch" && uncertainDiagnostic!.method === "GET"
    && uncertainDiagnostic!.outcome === "UNCERTAIN_AFTER_RESTART");
  check(recoveredDiagnosticJob!.requestsUsed === 1 && recoveredDiagnosticJob!.status === "PAUSED");
  check(sourceAfterRestart!.blockedReason === "RESTART_IN_FLIGHT"
    && !sourceAfterRestart!.accessVerifiedAt && !sourceAfterRestart!.verifiedMethod
    && !sourceAfterRestart!.collectionApprovedAt);
  const replay = await reserveSourceRequest(
    diagnosticJob, "/CaseSearch", "GET", coveragePermit!.id, requestUrl, () => false, context,
  );
  check(!replay.allow);
  check((await store.select().from(requests).where(eq(requests.jobId, diagnosticJob.id))).length === 1);
  const [budgetAfterReplay] = await store.select().from(jobs).where(eq(jobs.id, diagnosticJob.id));
  check(budgetAfterReplay!.requestsUsed === 1);

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
      sameFormNamed: 1, outsideContainerNamed: 0, nativeMatches: 1,
    })) };
  check(validInspectionMetadata(inspectionMetadata));
  check(!validInspectionMetadata({ ...inspectionMetadata, html: "forbidden" }));
  check(!validInspectionMetadata({ ...inspectionMetadata, phase: "LOCAL_POST" }));
  check(!validInspectionMetadata({ ...inspectionMetadata, controls: [...inspectionMetadata.controls, inspectionMetadata.controls[0]] }));
  for (const bad of [
    { ...inspectionMetadata.controls[0], value: "forbidden" },
    { ...inspectionMetadata.controls[0], control: "unexpected" },
    { ...inspectionMetadata.controls[0], nativePostedMatches: 1 },
    { ...inspectionMetadata.controls[0], sameFormNamed: 33 },
    { ...inspectionMetadata.controls[0], types: { ...inspectionMetadata.controls[0]!.types, cookie: 1 } },
  ]) check(!validInspectionMetadata({ ...inspectionMetadata, controls: [bad, ...inspectionMetadata.controls.slice(1)] }));
  check(formInspectionLiveEnabled === false);
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
  const filingMetadata = { kind: "filing_metadata", phase: "FINAL", scopeReady: false,
    modeMatchesFiling: false, officeCodes: [], dates: [], unclassifiedSelects: 0,
    controls: filingRoles.map(role => ({ role, candidates: 0, visible: false, enabled: false,
      optionCount: 0, choicePresent: false, selectedChoiceMatches: false, nativeNamed: 0,
      nativeMatches: 0, association: "NONE" })) };
  check(validFilingMetadata(filingMetadata));
  for (const bad of [
    { ...filingMetadata, html: "forbidden" }, { ...filingMetadata, phase: "SEARCHED" },
    { ...filingMetadata, officeCodes: ["MJ-05-2-01"] },
    { ...filingMetadata, officeCodes: ["CP-05-02-Crim"] },
    { ...filingMetadata, scopeReady: true },
    { ...filingMetadata, controls: [...filingMetadata.controls].reverse() },
    { ...filingMetadata, controls: filingMetadata.controls.map(row => ({ ...row, value: "forbidden" })) },
    { ...filingMetadata, controls: filingMetadata.controls.map(row => ({ ...row, nativeMatches: 1 })) },
    { ...filingMetadata, dates: [{ minimum: "2026-02-30", maximum: null, visible: true, enabled: true, nativeNamed: true, nativeSuccessful: true }] },
    { ...filingMetadata, dates: [{ minimum: null, maximum: null, visible: true, enabled: false, nativeNamed: true, nativeSuccessful: true }] },
  ]) check(!validFilingMetadata(bad));
  const publicChoices = { FILING: 0, MDJ: 1, ALLEGHENY: 0, CRIMINAL: 0, COMMON_PLEAS: 0 };
  const inventoryControl = { ordinal: 0, widget: "RADIO", labels: ["Court Level"], associations: ["GROUP", "LABEL"],
    hasPublicLabel: true, visible: true, enabled: true, ownership: "NONE", optionState: "OBSERVED", optionCount: 0,
    labelWords: ["court", "level"], publicChoices, selectedPublicChoices: { ...publicChoices, MDJ: 0 }, nativeSuccessful: false };
  const inventory = { kind: "filing_metadata", method: filingInspectionMethod, phase: "FILING",
    modeMatchesFiling: true, omittedSensitiveControls: 0, controls: [inventoryControl],
    advancedSearch: { candidates: 0, eligible: false, checked: null },
    county: { candidates: 0, eligible: false, selected: null },
    officeIdentification: { state: "NOT_READY", candidates: 0, controlOrdinal: null, codes: null, unrecognizedOptions: null } };
  check(validFilingInventoryMetadata(inventory));
  check(validFilingMetadata(inventory));
  check(!validFilingInventoryMetadata(filingMetadata));
  const { optionState: _omitted, labelWords: _words, ...legacyControl } = inventoryControl;
  const { COMMON_PLEAS: _cp, ...legacyChoices } = publicChoices;
  for (const method of ["playwright-filing-control-inventory-v2", "playwright-filing-control-inventory-v3"]) {
    const { advancedSearch: _advanced, county: _county, officeIdentification: _office, ...historical } = inventory;
    const legacyInventory = { ...historical, method, controls: [{ ...legacyControl,
      ...(method.endsWith("v3") ? { optionState: "OBSERVED" } : {}),
      publicChoices: legacyChoices, selectedPublicChoices: { ...legacyChoices, MDJ: 0 } }] };
    check(validFilingMetadata(legacyInventory));
    check(!validFilingInventoryMetadata(legacyInventory));
  }
  const { advancedSearch: _advancedV4, county: _countyV4, officeIdentification: _officeV4, ...historicalV4 } = inventory;
  const v4 = { ...historicalV4, method: "playwright-filing-control-inventory-v4", phase: "FINAL" };
  check(validFilingMetadata(v4));
  check(!validFilingInventoryMetadata(v4));
  const advancedControl = { ...inventoryControl, ordinal: 1, widget: "CHECKBOX", ownership: "SEARCH",
    labels: ["Advanced Search"], labelWords: ["search", "advanced"],
    publicChoices: { ...publicChoices, MDJ: 0 }, selectedPublicChoices: { ...publicChoices, MDJ: 0 } };
  const completedAdvanced = { ...inventory, phase: "ADVANCED", controls: [inventoryControl, advancedControl],
    advancedSearch: { candidates: 1, eligible: true, checked: true } };
  check(validFilingInventoryMetadata(completedAdvanced));
  const { county: _countyV5, officeIdentification: _officeV5, ...historicalV5 } = completedAdvanced;
  check(validFilingMetadata({ ...historicalV5, method: "playwright-filing-control-inventory-v5", phase: "FINAL" }));
  check(!validFilingInventoryMetadata({ ...historicalV5, method: "playwright-filing-control-inventory-v5" }));
  check(!validFilingInventoryMetadata({ ...completedAdvanced, phase: "FINAL" }));
  const countyControl = { ...inventoryControl, ordinal: 2, widget: "SELECT", ownership: "SEARCH",
    labels: ["County"], labelWords: ["county"], optionCount: 2,
    publicChoices: { ...publicChoices, MDJ: 0, ALLEGHENY: 1 },
    selectedPublicChoices: { ...publicChoices, MDJ: 0, ALLEGHENY: 1 } };
  const completedCounty = { ...completedAdvanced, phase: "COUNTY",
    controls: [inventoryControl, advancedControl, countyControl],
    county: { candidates: 1, eligible: true, selected: true },
    officeIdentification: { state: "MISSING", candidates: 0, controlOrdinal: null, codes: null, unrecognizedOptions: null } };
  check(validFilingInventoryMetadata(completedCounty));
  check(validFilingInventoryMetadata({ ...completedCounty, phase: "FINAL" }));
  const { officeIdentification: _officeV6, ...historicalV6 } = completedCounty;
  check(validFilingMetadata({ ...historicalV6, method: "playwright-filing-control-inventory-v6" }));
  check(!validFilingInventoryMetadata({ ...historicalV6, method: "playwright-filing-control-inventory-v6" }));
  const officeControl = { ...countyControl, ordinal: 3, labels: ["Court Office"], labelWords: ["court", "office"],
    publicChoices: { ...publicChoices, MDJ: 0 }, selectedPublicChoices: { ...publicChoices, MDJ: 0 } };
  const identified = { ...completedCounty, controls: [...completedCounty.controls, officeControl],
    officeIdentification: { state: "OBSERVED", candidates: 1, controlOrdinal: 3, unrecognizedOptions: 1,
      codes: [{ code: "05-2-99", kind: "DISTRICT_CODE_UNVERIFIED", enabled: true, selected: false }] } };
  check(validFilingInventoryMetadata(identified));
  for (const change of [{ state: "MDJ_VERIFIED" }, { candidates: 2 }, { controlOrdinal: 0 }, { unrecognizedOptions: 0 },
    { codes: null }, { privateValue: "secret" },
    ...[{ code: "06-2-99" }, { kind: "MDJ" }, { selected: "false" }, { value: "private" }, { label: "Person" }]
      .map(change => ({ codes: [{ ...identified.officeIdentification.codes[0], ...change }] }))])
    check(!validFilingInventoryMetadata({ ...identified, officeIdentification: { ...identified.officeIdentification, ...change } }));
  const unknownOffice = { ...officeControl, optionState: "OVER_LIMIT", optionCount: null, publicChoices: null, selectedPublicChoices: null };
  const unknownIdentification = { state: "OVER_LIMIT", candidates: 1, controlOrdinal: 3, codes: null, unrecognizedOptions: null };
  check(validFilingInventoryMetadata({ ...completedCounty, controls: [...completedCounty.controls, unknownOffice],
    officeIdentification: unknownIdentification }));
  check(!validFilingInventoryMetadata({ ...completedCounty, controls: [...completedCounty.controls, unknownOffice],
    officeIdentification: { ...unknownIdentification, codes: [] } }));
  for (const change of [{ candidates: 0 }, { eligible: false }, { selected: false }, { selected: "true" }, { value: "private" }])
    check(!validFilingInventoryMetadata({ ...completedCounty, county: { ...completedCounty.county, ...change } }));
  for (const change of [{ visible: false }, { enabled: false }, { ownership: "OTHER" }, { hasPublicLabel: false },
    { labels: ["MDJ County"] }, { selectedPublicChoices: { ...countyControl.selectedPublicChoices, ALLEGHENY: 0 } },
    { publicChoices: { ...countyControl.publicChoices, ALLEGHENY: 2 } }])
    check(!validFilingInventoryMetadata({ ...completedCounty,
      controls: [inventoryControl, advancedControl, { ...countyControl, ...change }] }));
  for (const change of [
    { candidates: 0 }, { eligible: false }, { checked: false }, { checked: "true" }, { value: "private" },
  ]) check(!validFilingInventoryMetadata({ ...completedAdvanced,
    advancedSearch: { ...completedAdvanced.advancedSearch, ...change } }));
  for (const change of [{ visible: false }, { enabled: false }, { ownership: "OTHER" }, { labels: ["Enable Advanced Search"] }])
    check(!validFilingInventoryMetadata({ ...completedAdvanced, controls: [inventoryControl, { ...advancedControl, ...change }] }));
  check(!validFilingInventoryMetadata({ ...inventory, phase: "FINAL" }));
  const overLimitControl = { ...inventoryControl, widget: "SELECT", optionState: "OVER_LIMIT",
    optionCount: null, publicChoices: null, selectedPublicChoices: null };
  check(validFilingInventoryMetadata({ ...inventory, controls: [overLimitControl] }));
  for (const bad of [
    { ...inventory, html: "forbidden" }, { ...inventory, method: "playwright-filing-form-inspection-v1" },
    { ...inventory, phase: "COURT_TYPE" }, { ...inventory, modeMatchesFiling: false },
    { ...inventory, omittedSensitiveControls: 128 }, { ...inventory, controls: [inventoryControl, inventoryControl] },
    ...[
      { labels: ["raw unknown label"] }, { associations: ["guessed_binding"] }, { widget: "TEXT" },
      { ownership: "GUESSED" }, { ordinal: 128 }, { value: "private" }, { nativeSuccessful: true },
      { publicChoices: { ...publicChoices, MDJ: 2 } },
      { publicChoices: { ...publicChoices, PRIVATE: 1 } },
      { selectedPublicChoices: { ...publicChoices, MDJ: 2 } },
      { optionState: "TRUNCATED" }, { optionCount: 2001 },
      { optionState: "OVER_LIMIT" }, { optionState: "OBSERVED", publicChoices: null },
      { labelWords: ["private"] }, { labelWords: ["court", "court"] }, { labelWords: "court" },
    ].map(change => ({ ...inventory, controls: [{ ...inventoryControl, ...change }] })),
  ]) check(!validFilingInventoryMetadata(bad));
  for (const change of [
    { widget: "RADIO" }, { optionCount: 2001 }, { publicChoices },
    { selectedPublicChoices: publicChoices }, { optionState: "OBSERVED" },
  ]) check(!validFilingInventoryMetadata({ ...inventory, controls: [{ ...overLimitControl, ...change }] }));
  for (const stage of ["INSPECT", "COVERAGE", "FILING_INSPECT"]) for (const [path, method, url] of [
    ["/CaseSearch", "GET", requestUrl],
    ["/CaseSearch", "POST", requestUrl],
    ["/Report/CpDocketSheet", "GET", "https://ujsportal.pacourts.us/Report/CpDocketSheet"],
  ]) {
    await reset(false);
    await store.update(sources).set({ blockedReason: "SOURCE_VALIDATION_BARRIER" }).where(eq(sources.id, "UJS"));
    const inspectCriteria = { ...criteria, requestCap: 3 };
    const [inspectionPermit] = await store.insert(pilots).values({
      stage, expectedMethod: stage === "FILING_INSPECT" ? filingInspectionMethod : stage === "COVERAGE" ? coverageInspectionMethod : formInspectionMethod, criteria: inspectCriteria,
      state: "ATTEMPTED", approvedAt: instant, expiresAt: new Date(now0 + 3_600_000),
    }).returning();
    const inspectionJob = await createJob({ criteria: inspectCriteria, assessmentId: inspectionPermit!.id });
    await store.update(pilots).set({ jobId: inspectionJob.id }).where(eq(pilots.id, inspectionPermit!.id));
    const result = await reserveSourceRequest(inspectionJob, path, method, inspectionPermit!.id, url, () => false, context);
    check(result.allow === (stage !== "INSPECT" && method === "GET" && path === "/CaseSearch"));
    check((await store.select().from(requests)).length === (result.allow ? 1 : 0));
    if (result.allow) {
      const [request] = await store.select().from(requests);
      check(await response(inspectionJob, request!.id));
      const duplicate = await reserveSourceRequest(
        inspectionJob, path, method, inspectionPermit!.id, url, () => false, context,
      );
      check(!duplicate.allow);
      check((await store.select().from(requests)).length === 1);
    }
    const [sourceState] = await store.select().from(sources);
    check(sourceState!.blockedReason === "SOURCE_VALIDATION_BARRIER" && !sourceState!.accessVerifiedAt && !sourceState!.collectionApprovedAt);
  }
  // One-use operator gate: protocol metadata only, never source or case fixtures.
  check(isCalendarPreviewCriteria({ ...calendarPreviewCriteria }));
  check(calendarPreviewCriteria.startDate === "2026-10-15");
  check(!calendarPreviewRequestAllowed("/Report/CpDocketSheet", "GET"));
  check(!calendarPreviewRequestAllowed("/resource/js/sitemain.min.js", "POST"));
  const previewSource = {
    blockedReason: "SOURCE_VALIDATION_BARRIER", pausedUntil: null, activeRequestId: null,
    accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null,
  };
  check(calendarPreviewSourceAllowed(previewSource, instant));
  check(!calendarPreviewSourceAllowed({ ...previewSource, activeRequestId: randomUUID() }, instant));
  check(!calendarPreviewSourceAllowed({ ...previewSource, blockedReason: null }, instant));
  check(!isCalendarPreviewCriteria({ ...calendarPreviewCriteria, extra: true }));

  const preparePreview = async (
    changedCriteria: Partial<(typeof jobs.$inferSelect)["criteria"]> = {},
    changedSource: Partial<typeof sources.$inferInsert> = {},
    changedPermit: Partial<typeof pilots.$inferInsert> = {},
  ) => {
    await reset(false);
    await store.update(sources).set({ ...previewSource, ...changedSource }).where(eq(sources.id, "UJS"));
    const previewCriteria = { ...calendarPreviewCriteria, ...changedCriteria };
    const [permit] = await store.insert(pilots).values({
      stage: "CALENDAR_ONLY", expectedMethod: calendarPreviewMethod, criteria: previewCriteria,
      state: "ATTEMPTED", approvedAt: instant, expiresAt: new Date(time + 7 * 86_400_000),
      ...changedPermit,
    }).returning();
    const job = await createJob({ criteria: previewCriteria, assessmentId: permit!.id });
    await store.update(pilots).set({ jobId: job.id }).where(eq(pilots.id, permit!.id));
    return { job, permit: permit! };
  };
  const previewReserve = (job: typeof jobs.$inferSelect, permitId: string, method = "GET") =>
    reserveSourceRequest(job, "/CaseSearch", method, permitId, requestUrl, () => false, context);

  let preview = await preparePreview();
  const pageGrant = await previewReserve(preview.job, preview.permit.id);
  assert.ok(pageGrant.allow);
  check(await response(preview.job, pageGrant.requestId));
  const postGrant = await previewReserve(preview.job, preview.permit.id, "POST");
  assert.ok(postGrant.allow);
  check(await response(preview.job, postGrant.requestId));
  check(!(await previewReserve(preview.job, preview.permit.id, "POST")).allow);
  check((await store.select().from(requests)).length === 2);
  const [preservedSource] = await store.select().from(sources);
  check(preservedSource!.blockedReason === "SOURCE_VALIDATION_BARRIER"
    && !preservedSource!.accessVerifiedAt && !preservedSource!.verifiedMethod
    && !preservedSource!.collectionApprovedAt);

  for (const changed of [
    { startDate: "2026-10-14" }, { endDate: "2026-10-16" }, { courtRoom: "Courtroom 507" },
    { courtRoom: undefined }, { eventType: "Bail Hearing" as const }, { calendarPreviewOnly: false },
    { requestCap: 9 }, { recordCap: 2 }, { matchTarget: 1 },
  ]) {
    preview = await preparePreview(changed);
    check(!(await previewReserve(preview.job, preview.permit.id)).allow);
    check((await store.select().from(requests)).length === 0);
  }
  for (const changed of [
    { blockedReason: null }, { blockedReason: "ACCESS_DENIED" }, { blockedReason: "UNCERTAIN_SOURCE_STATE" },
    { pausedUntil: new Date(now0 + 60_000) }, { accessVerifiedAt: instant },
    { verifiedMethod: integratedSourceMethod }, { collectionApprovedAt: instant },
  ]) {
    preview = await preparePreview({}, changed);
    check(!(await previewReserve(preview.job, preview.permit.id)).allow);
    check((await store.select().from(requests)).length === 0);
  }
  for (const changed of [
    ...["PREPARED", "APPROVED", "FAILED", "CALENDAR_VALIDATED"].map(state => ({ state })),
    { expectedMethod: integratedSourceMethod }, { approvedAt: null },
    { expiresAt: new Date(now0 - 1) }, { stage: "SINGLE" },
  ]) {
    preview = await preparePreview({}, {}, changed);
    check(!(await previewReserve(preview.job, preview.permit.id)).allow);
    check((await store.select().from(requests)).length === 0);
  }
  preview = await preparePreview();
  await store.update(pilots).set({ expiresAt: new Date("2026-10-20T16:00:00Z") }).where(eq(pilots.id, preview.permit.id));
  time = Date.parse("2026-10-16T16:00:00Z");
  const stalePreview = await previewReserve(preview.job, preview.permit.id);
  check(!stalePreview.allow && "reason" in stalePreview && stalePreview.reason === "CALENDAR_PREVIEW_SCOPE_INVALID");
  check((await store.select().from(requests)).length === 0);
  preview = await preparePreview();
  await store.update(jobs).set({ requestsUsed: 8 }).where(eq(jobs.id, preview.job.id));
  check(!(await previewReserve(preview.job, preview.permit.id)).allow);
  check((await store.select().from(requests)).length === 0);
  preview = await preparePreview();
  await store.update(jobs).set({ calendarComplete: true }).where(eq(jobs.id, preview.job.id));
  check(!(await previewReserve(preview.job, preview.permit.id)).allow);
  check((await store.select().from(requests)).length === 0);
  preview = await preparePreview();
  const activeGrant = await previewReserve(preview.job, preview.permit.id);
  assert.ok(activeGrant.allow);
  let accounted = false;
  const waitingGrant = await reserveSourceRequest(preview.job, "/CaseSearch", "POST",
    preview.permit.id, requestUrl, () => false, {
      ...context,
      sleep: async (ms) => {
        if (!accounted) {
          check(await response(preview.job, activeGrant.requestId));
          accounted = true;
        }
        time += ms;
      },
    });
  check(waitingGrant.allow && accounted);
  if (waitingGrant.allow) check(await response(preview.job, waitingGrant.requestId));
  await reset(false);
  await store.update(sources).set(previewSource).where(eq(sources.id, "UJS"));
  check(!(await reserve(await createJob())).allow);
  check((await store.select().from(requests)).length === 0);
  console.log(`PASS: ${checks} offline checks; actual concurrent PostgreSQL grants; no court traffic or case fixtures.`);
} finally {
  await isolatedPool.end();
  await pool.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
  await pool.end();
}
