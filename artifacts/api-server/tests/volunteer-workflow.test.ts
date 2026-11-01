import test from "node:test";
import assert from "node:assert/strict";
import { chooseRecovery, recoveryWaitForAdmission } from "../src/services/bail-search-recovery";
import { selectBailDecision, qualifiesMonetary, csvCell } from "../src/lib/bail-decision";
import { validCachedConsultationChronology } from "../src/lib/discovery-candidates";
import { resultDatesForItem } from "../src/services/bail-search-projection";
import { withSearchViewerAccess } from "../src/services/bail-search-access";

const base = { paused: true, saved: true, missingEvidence: false, expired: false,
  noJob: false, sourceBlocked: false, cooldown: null, now: new Date("2026-10-29T12:00:00Z") };
test("unknown totals and running states never invite resume", () => {
  assert.equal(chooseRecovery({ ...base, paused: false }).action, "none");
});
test("missing local evidence needs evidence, not a futile retry", () => {
  const result = chooseRecovery({ ...base, missingEvidence: true, evidence: {
    source: "saved", calendarValidated: false, retainedRows: 2, documentsDiscovered: 0, documentsProcessed: 0,
  } });
  assert.equal(result.action, "evidence_needed");
  assert.match(result.message, /Saved evidence processing stopped/);
  assert.match(result.message, /unavailable or could not be checked locally/);
  assert.doesNotMatch(result.message, /Calendar discovery/);
});
test("interrupted local processing can resume explicitly", () => {
  const result = chooseRecovery({ ...base, saved: false, evidence: {
    calendarValidated: true, retainedRows: 3, documentsDiscovered: 3, documentsProcessed: 1,
  } });
  assert.equal(result.action, "resume");
  assert.match(result.message, /Docket PDF processing stopped/);
  assert.match(result.message, /3 docket rows from the validated calendar/);
  assert.match(result.message, /Resume this same search/);
});
test("quota wait exposes a concrete time then becomes resumable", () => {
  const cooldown = new Date("2026-10-29T13:00:00Z");
  const result = chooseRecovery({ ...base, saved: false, cooldown, evidence: {
    calendarValidated: false, retainedRows: 0, documentsDiscovered: 0, documentsProcessed: 0,
    blockReason: "SOURCE_COOLDOWN",
  } });
  assert.equal(result.action, "wait");
  assert.equal(result.availableAt, cooldown.toISOString());
  assert.match(result.message, /recorded cooldown/);
  assert.match(result.message, /Wait until 2026-10-29T13:00:00.000Z/);
  assert.equal(chooseRecovery({ ...base, saved: false, cooldown, now: new Date("2026-10-29T14:00:00Z") }).action, "resume");
});
test("access failures never invite a retry, even with a future cooldown", () => {
  for (const [blockReason, phrase] of [
    ["ACCESS_DENIED", "access denial"],
    ["CHALLENGE", "verification challenge"],
    ["SOURCE_VALIDATION_BARRIER", "validation barrier"],
    ["ACCESS_UNVERIFIED", "access proof"],
  ]) {
    const result = chooseRecovery({ ...base, saved: false, sourceBlocked: true,
      cooldown: new Date("2026-10-29T13:00:00Z"),
      evidence: { calendarValidated: false, retainedRows: 2, documentsDiscovered: 2, documentsProcessed: 0, blockReason,
        latestOutcome: blockReason === "ACCESS_DENIED" || blockReason === "CHALLENGE" ? blockReason : null } });
    assert.equal(result.action, "source_blocked");
    assert.match(result.message, new RegExp(phrase));
    assert.match(result.message, /not a confirmed empty search/);
    assert.match(result.message, /2 docket rows are retained/);
    assert.match(result.message, /Do not retry or change request methods/);
  }
});
test("a source-wide denial is not attributed to this search without matching request evidence", () => {
  const retainedGlobalBlock = chooseRecovery({ ...base, saved: false, sourceBlocked: true,
    evidence: { calendarValidated: true, retainedRows: 1, documentsDiscovered: 1, documentsProcessed: 0,
      blockReason: "ACCESS_DENIED", latestOutcome: "OK" } });
  assert.match(retainedGlobalBlock.message, /source access denial is blocking new requests/);
  assert.match(retainedGlobalBlock.message, /does not establish that it caused the denial/);
  const currentRequestDenial = chooseRecovery({ ...base, saved: false, sourceBlocked: true,
    evidence: { calendarValidated: false, retainedRows: 0, documentsDiscovered: 0, documentsProcessed: 0,
      blockReason: "ACCESS_DENIED", latestOutcome: "ACCESS_DENIED", latestStatusCode: 403 } });
  assert.match(currentRequestDenial.message, /latest source request recorded an access denial \(HTTP 403\)/);
});
test("missing job, expired scope and exhausted budget require a new search", () => {
  assert.equal(chooseRecovery({ ...base, saved: false, noJob: true }).action, "new_search");
  const expired = chooseRecovery({ ...base, saved: false, expired: true, evidence: {
    calendarValidated: true, retainedRows: 1, documentsDiscovered: 1, documentsProcessed: 0,
    expiryReason: "The original calendar date window has passed.",
  } });
  assert.equal(expired.action, "new_search");
  assert.match(expired.message, /original calendar date window has passed/);
  assert.match(expired.message, /1 docket row from the validated calendar/);
});
test("timeout remains distinct from unknown worker stops and keeps the same scope", () => {
  const result = chooseRecovery({ ...base, saved: false, sourceBlocked: true,
    evidence: { calendarValidated: true, retainedRows: 4, documentsDiscovered: 4, documentsProcessed: 2,
      blockReason: "TIMEOUT", latestOutcome: "TIMEOUT" } });
  assert.equal(result.action, "source_blocked");
  assert.match(result.message, /timed out/);
  assert.match(result.message, /4 docket rows from the validated calendar/);
  assert.match(result.message, /pending docket checks/);
});
test("unknown stops are not assigned a guessed cause and exhausted budgets cannot resume", () => {
  const unknown = chooseRecovery({ ...base, saved: false, sourceBlocked: true, evidence: {
    calendarValidated: true, retainedRows: 1, documentsDiscovered: 1, documentsProcessed: 0,
    jobMessage: "Worker stopped before completion.",
  } });
  assert.match(unknown.message, /cause is unknown from retained job and request records/);
  const exhausted = chooseRecovery({ ...base, saved: false, expired: true, evidence: {
    calendarValidated: true, retainedRows: 1, documentsDiscovered: 1, documentsProcessed: 0,
    expiryReason: "This search used its full source-request budget.",
  } });
  assert.equal(exhausted.action, "new_search");
  assert.match(exhausted.message, /full source-request budget/);
});
test("a future pacing estimate never masks an access denial", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(recoveryWaitForAdmission("ACCESS_UNVERIFIED", [new Date("2026-10-29T13:00:00Z")], now), null);
  assert.equal(recoveryWaitForAdmission("CHALLENGE", [new Date("2026-10-29T13:00:00Z")], now), null);
  assert.equal(recoveryWaitForAdmission("HOURLY_REQUEST_LIMIT", [new Date("2026-10-29T13:00:00Z")], now)?.toISOString(),
    "2026-10-29T13:00:00.000Z");
  assert.equal(recoveryWaitForAdmission("REQUEST_IN_FLIGHT", [new Date("2026-10-29T13:00:00Z")], now), null);
});
const monetary = { date: "2026-10-28", classification: "monetary", amount: 1000, percentage: null, page: 1, quote: "Test fixture — bail set" };
test("same-day conflicts remain ambiguous and do not pass the amount filter", () => {
  const decision = selectBailDecision([monetary, { ...monetary, amount: 2000 }]);
  assert.equal(decision.ambiguous, true);
  assert.equal(decision.amount, null);
  assert.equal(qualifiesMonetary(decision, 2000), false);
});
test("later denied or nonmonetary decision supersedes monetary", () => {
  for (const classification of ["denied", "nonmonetary"]) {
    const decision = selectBailDecision([monetary, { ...monetary, date: "2026-10-29", amount: null, classification }]);
    assert.equal(decision.classification, classification);
    assert.equal(qualifiesMonetary(decision, 2000), false);
  }
});
test("calendar projection preserves the selected event and date range", () => {
  const criteria = { startDate: "2026-10-29", endDate: "2026-10-31", maxBail: 2000,
    source: "live" as const, eventType: "Formal Arraignment", courtOffice: "ANY" };
  const item = { provenance: {
    eventDate: "2026-10-29", eventType: "Formal Arraignment",
    matchingEvents: [
      { eventDate: "2026-10-29", eventType: "Formal Arraignment", eventTime: null },
      { eventDate: "2026-10-30", eventType: "Bail Hearing", eventTime: null },
      { eventDate: "2026-11-01", eventType: "Formal Arraignment", eventTime: null },
    ],
  } } as Parameters<typeof resultDatesForItem>[1];
  assert.deepEqual(resultDatesForItem(criteria, item), ["2026-10-29"]);
});
test("empty evidence is unknown, never zero bail", () => {
  assert.equal(selectBailDecision([]).amount, null);
  assert.equal(selectBailDecision([]).classification, "unknown");
});
test("CSV escapes quotes and spreadsheet formulas", () => {
  assert.equal(csvCell('=SUM(1,2)'), '"\'=SUM(1,2)"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
test("cached consultation chronology cannot precede calendar or known retrieval", () => {
  const calendar = "2026-10-28T10:00:00.000Z";
  const original = new Date("2026-10-28T11:00:00.000Z");
  assert.equal(validCachedConsultationChronology(new Date("2026-10-28T12:00:00.000Z"), calendar, original), true);
  assert.equal(validCachedConsultationChronology(new Date("2026-10-28T10:30:00.000Z"), calendar, original), false);
  assert.equal(validCachedConsultationChronology(new Date("2026-10-28T09:59:00.000Z"), calendar, null), false);
  assert.equal(validCachedConsultationChronology(new Date(Date.now() + 10 * 60_000), calendar, null), false);
});
test("workspace viewers can read earlier searches without creator-only controls", () => {
  const response = { searchId: "search-id", resumeToken: "resume-token" };
  assert.deepEqual(withSearchViewerAccess(response, "owner-a", "owner-a"), {
    ...response,
    canManage: true,
  });
  assert.deepEqual(withSearchViewerAccess(response, "owner-a", "owner-b"), {
    searchId: "search-id",
    resumeToken: null,
    canManage: false,
  });
});
