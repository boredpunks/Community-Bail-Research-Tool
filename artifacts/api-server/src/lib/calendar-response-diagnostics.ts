const categories = ["JAVASCRIPT_EXCEPTION", "REQUIRED_RESOURCE_FAILURE",
  "BLOCKED_OPTIONAL_RESOURCE_ERROR", "OTHER_CONSOLE_ERROR", "UNKNOWN_OR_UNSAFE"];
const aliases = ["MAIN_DOCUMENT", "MAIN_SCRIPT", "MAIN_STYLESHEET", "BLOCKED_OPTIONAL", "OTHER", "UNKNOWN"];
const signals = ["RESOURCE_ABORT", "RESOURCE_LOAD_ERROR", "CONSOLE_ERROR", "UNCLASSIFIED", "SCRIPT_EXCEPTION", "REQUEST_FAILED"];
const outcomes = ["NOT_RUN", "CANDIDATE_NONEMPTY", "NO_EMPTY_PROOF", "MISSING_TABLE",
  "EXPLICIT_EMPTY_RESULT", "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED",
  "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"];
const gates = ["NONE", "SOURCE_STOPPED", "CALENDAR_REQUIRED_RESOURCE_BLOCKED",
  "CALENDAR_REQUIRED_ASSET_MISSING", "CALENDAR_SCRIPT_ERROR", "CALENDAR_CONSOLE_ERROR",
  "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE", "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"];
const stages = ["BEFORE_SEARCH", "SEARCH_ARMED", "POST_ATTEMPT", "RESPONSE_RECEIVED",
  "RESPONSE_BODY_READ", "POST_ACKNOWLEDGED", "DOCUMENT_FULFILLED", "INSPECTION",
  "PARSER_STARTED", "PARSER_ACCEPTED", "PARSER_REJECTED"];
const resources = ["document", "script", "stylesheet", "image", "font", "media",
  "xhr", "fetch", "eventsource", "websocket", "manifest", "texttrack", "other", "UNKNOWN"];
const decisions = ["UNKNOWN", "OPTIONAL_ABORT", "LOCAL_IMAGE", "POLICY_ABORT", "READ_ONLY_STOP", "CACHE", "FETCH_ATTEMPT"];
const failures = ["UNKNOWN", "NET_FAILED", "NET_ABORTED", "NET_BLOCKED_CLIENT", "DNS", "CONNECT",
  "TIMEOUT", "HTTP_DENIED", "HTTP_RATE_LIMIT", "HTTP_CLIENT", "HTTP_SERVER", "HTTP_OTHER", "OTHER"];
const transportStatuses = ["RESPONSE_INCOMPLETE", "SOURCE_STOPPED", "REQUIRED_RESOURCE_FAILURE",
  "REQUIRED_ASSET_MISSING", "UNCLASSIFIED_REQUEST_FAILURE", "DIAGNOSTIC_OVERFLOW", "COMPLETE"];
const consoleStatuses = ["CLEAN", "PROVEN_OPTIONAL_ONLY", "UNCLASSIFIED_CONSOLE_ERRORS",
  "RUNTIME_EXCEPTIONS", "MIXED"];
const resultOutcomes = ["NOT_RUN", "VALIDATED_NONEMPTY", "VALIDATED_EMPTY", "EMPTY_NOT_PROVEN", "MISSING_TABLE",
  "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED", "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"];
const eligibilityStates = ["BLOCKED_INTEGRITY", "BLOCKED_CRITERIA", "BLOCKED_TRANSPORT",
  "BLOCKED_CONSOLE", "BLOCKED_RESULT", "ELIGIBLE", "VALIDATED_EMPTY"];
const lifecycleStates = ["BEFORE_POST_ATTEMPT", "POST_ATTEMPT_IN_PROGRESS",
  "RESPONSE_ACKNOWLEDGED", "BROWSER_FULFILLED", "READ_ONLY_INSPECTION"];
const requestStartStates = [...lifecycleStates, "NOT_ASSOCIATED", "UNAVAILABLE"];
const lifecycleKeys = ["browserRequestStarted", "browserRequestStartState", "browserRequestStartOrder",
  "postAttemptStarted", "postAttemptOrder", "responseAcknowledged", "responseAcknowledgedOrder",
  "browserFulfilled", "browserFulfilledOrder", "readOnlyInspection", "readOnlyInspectionOrder",
  "orderOverflow"];
const lifecycleMilestones = [
  ["browserRequestStarted", "browserRequestStartOrder"],
  ["postAttemptStarted", "postAttemptOrder"],
  ["responseAcknowledged", "responseAcknowledgedOrder"],
  ["browserFulfilled", "browserFulfilledOrder"],
  ["readOnlyInspection", "readOnlyInspectionOrder"],
] as const;
const stateMilestone: Record<string, string> = {
  POST_ATTEMPT_IN_PROGRESS: "postAttemptOrder",
  RESPONSE_ACKNOWLEDGED: "responseAcknowledgedOrder",
  BROWSER_FULFILLED: "browserFulfilledOrder",
  READ_ONLY_INSPECTION: "readOnlyInspectionOrder",
};
const stateFlag: Record<string, string> = {
  POST_ATTEMPT_IN_PROGRESS: "postAttemptStarted",
  RESPONSE_ACKNOWLEDGED: "responseAcknowledged",
  BROWSER_FULFILLED: "browserFulfilled",
  READ_ONLY_INSPECTION: "readOnlyInspection",
};
const maxLocalOrder = 10_000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === [...expected].sort().join();
const count = (v: unknown, max: number) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
export function validCalendarResponseDiagnostic(m: Record<string, unknown>) {
  if (!keys(m, ["kind", "version", "phase", "submissionObserved", "responseCompleted",
    "inspectionStatus", "structure", "parserAttempted", "parserOutcome", "criteriaValidation",
    "transportIntegrity", "consoleDiagnostics", "resultValidation", "documentEligibility", "stopGate",
    "classifications", "classificationOverflow", "blockedDuringInspection", "eventSequence", "milestones",
    "lifecycle"])
    || m.kind !== "calendar_response_diagnostic" || m.version !== 4 || m.phase !== "RESULT"
    || !["submissionObserved", "responseCompleted", "parserAttempted", "classificationOverflow"]
      .every(k => typeof m[k] === "boolean")
    || !count(m.blockedDuringInspection, 10_000) || !count(m.eventSequence, 10_000)
    || !oneOf(m.inspectionStatus, ["OBSERVED", "NOT_SAFE", "UNAVAILABLE"])
    || !oneOf(m.parserOutcome, outcomes) || !oneOf(m.stopGate, gates)
    || !Array.isArray(m.classifications) || m.classifications.length > 32
    || !Array.isArray(m.milestones) || m.milestones.length > 16
    || !object(m.lifecycle) || !keys(m.lifecycle, lifecycleKeys)
    || !["browserRequestStarted", "postAttemptStarted", "responseAcknowledged",
      "browserFulfilled", "readOnlyInspection", "orderOverflow"]
      .every(k => typeof (m.lifecycle as Record<string, unknown>)[k] === "boolean")) return false;
  const lifecycle = m.lifecycle as Record<string, unknown>;
  const orderOverflow = lifecycle.orderOverflow as boolean;
  const validOrderPair = (first: unknown, last: unknown, allowOverflow: boolean) =>
    first === null && last === null ? allowOverflow
      : count(first, maxLocalOrder) && Number(first) > 0
        && count(last, maxLocalOrder) && Number(last) >= Number(first);
  const validBrowserStart = lifecycle.browserRequestStarted
    ? oneOf(lifecycle.browserRequestStartState, lifecycleStates)
      && validOrderPair(lifecycle.browserRequestStartOrder,
        lifecycle.browserRequestStartOrder, orderOverflow)
    : lifecycle.browserRequestStartState === null && lifecycle.browserRequestStartOrder === null;
  if (!validBrowserStart
    || lifecycle.postAttemptStarted !== m.submissionObserved
    || lifecycle.postAttemptStarted && !lifecycle.browserRequestStarted
    || lifecycle.responseAcknowledged && !lifecycle.postAttemptStarted
    || lifecycle.browserFulfilled && !lifecycle.responseAcknowledged
    || lifecycle.readOnlyInspection && !lifecycle.postAttemptStarted
    || m.responseCompleted && !lifecycle.responseAcknowledged) return false;
  const validMilestones = lifecycleMilestones.every(([flag, order]) =>
    lifecycle[flag] === true
      ? lifecycle[order] === null ? orderOverflow
        : count(lifecycle[order], maxLocalOrder) && Number(lifecycle[order]) > 0
      : lifecycle[order] === null);
  if (!validMilestones) return false;
  const orderedMilestones = lifecycleMilestones
    .map(([, key]) => lifecycle[key])
    .filter((value): value is number => typeof value === "number");
  if (orderedMilestones.some((value, index) =>
    index > 0 && orderedMilestones[index - 1]! > value)) return false;
  if (lifecycle.browserFulfilled && !m.responseCompleted) return false;
  const marks = new Map<string, number>();
  let previous = 0;
  for (const mark of m.milestones) {
    if (!object(mark) || !keys(mark, ["name", "sequence"])
      || !oneOf(mark.name, [...stages.slice(1), "READ_ONLY"]) || marks.has(String(mark.name))
      || !count(mark.sequence, Number(m.eventSequence)) || Number(mark.sequence) <= previous) return false;
    marks.set(String(mark.name), Number(mark.sequence)); previous = Number(mark.sequence);
  }
  for (const [name, prerequisite] of [
    ["POST_ATTEMPT", "SEARCH_ARMED"], ["RESPONSE_RECEIVED", "POST_ATTEMPT"],
    ["RESPONSE_BODY_READ", "RESPONSE_RECEIVED"], ["POST_ACKNOWLEDGED", "RESPONSE_BODY_READ"],
    ["DOCUMENT_FULFILLED", "POST_ACKNOWLEDGED"], ["INSPECTION", "POST_ACKNOWLEDGED"],
    ["PARSER_STARTED", "INSPECTION"], ["PARSER_ACCEPTED", "PARSER_STARTED"],
    ["PARSER_REJECTED", "PARSER_STARTED"],
  ]) if (marks.has(name) && (!marks.has(prerequisite) || marks.get(prerequisite)! >= marks.get(name)!)) return false;
  if (m.submissionObserved !== marks.has("POST_ATTEMPT")
    || m.responseCompleted !== marks.has("POST_ACKNOWLEDGED")
    || m.parserAttempted !== marks.has("PARSER_STARTED")
    || m.inspectionStatus === "OBSERVED" && !marks.has("INSPECTION")
    || m.inspectionStatus === "OBSERVED" && !lifecycle.readOnlyInspection
    || marks.has("PARSER_ACCEPTED") && (marks.has("PARSER_REJECTED")
      || !["CANDIDATE_NONEMPTY", "EXPLICIT_EMPTY_RESULT"].includes(String(m.parserOutcome)))) return false;
  if (m.responseCompleted && !m.submissionObserved
    || m.parserAttempted !== (m.parserOutcome !== "NOT_RUN")
    || m.parserAttempted && (!m.responseCompleted || m.inspectionStatus !== "OBSERVED")) return false;
  if (m.inspectionStatus === "OBSERVED") {
    const s = m.structure;
    if (!m.responseCompleted || !object(s) || !keys(s, ["bodyPresent", "searchButtonCount",
      "searchFormPresent", "resultTableCount", "headerCellCount", "expectedHeaders",
      "dataRowCount", "documentLinkCount", "countsCapped"])
      || !["bodyPresent", "searchFormPresent", "expectedHeaders", "countsCapped"].every(k => typeof s[k] === "boolean")
      || !count(s.searchButtonCount, 2) || !count(s.resultTableCount, 2)
      || !count(s.headerCellCount, 128) || !count(s.dataRowCount, 5000)
      || !count(s.documentLinkCount, 20000)
      || s.expectedHeaders && s.resultTableCount !== 1) return false;
  } else if (m.structure !== null) return false;
  const transport = m.transportIntegrity;
  const console = m.consoleDiagnostics;
  const result = m.resultValidation;
  if (!object(transport) || !keys(transport, [
    "status", "requiredAssetsLoaded", "requestFailureObserved", "blockedDuringInspection"])
    || !oneOf(transport.status, transportStatuses)
    || typeof transport.requiredAssetsLoaded !== "boolean"
    || typeof transport.requestFailureObserved !== "boolean"
    || !count(transport.blockedDuringInspection, 10_000)
    || transport.blockedDuringInspection !== m.blockedDuringInspection
    || !object(console) || !keys(console, [
      "status", "consoleErrors", "runtimeExceptions", "provenOptionalErrors"])
    || !oneOf(console.status, consoleStatuses)
    || !count(console.consoleErrors, 10_000)
    || !count(console.runtimeExceptions, 10_000)
    || !count(console.provenOptionalErrors, 10_000)
    || !object(result) || !keys(result, [
      "outcome", "observedRows", "validatedRows", "validatedDockets",
      "documentLinks", "scope", "dates", "explicitEmptyResult"])
    || !oneOf(result.outcome, resultOutcomes)
    || !count(result.observedRows, 5000) || !count(result.validatedRows, 5000)
    || !count(result.validatedDockets, 5000)
    || Number(result.validatedRows) > Number(result.observedRows)
    || !oneOf(result.documentLinks, ["NOT_CHECKED", "NO_ROWS", "ALL_VALID", "REJECTED"])
    || !oneOf(result.scope, ["NOT_CHECKED", "NO_ROWS", "ALL_ROWS_MATCH", "REJECTED"])
    || !oneOf(result.dates, ["NOT_CHECKED", "NO_ROWS", "ALL_WITHIN_REQUEST", "REJECTED"])
    || !oneOf(result.explicitEmptyResult, ["NOT_CAPTURED", "SOURCE_STATUS_MARKER"])
    || !oneOf(m.criteriaValidation, [
      "NOT_VERIFIED", "PRE_SUBMISSION_FORMDATA_MATCHED", "INTERCEPTED_POST_BODY_MATCHED"])
    || !oneOf(m.documentEligibility, eligibilityStates)) return false;
  const runtime = Number(console.runtimeExceptions);
  const consoleErrors = Number(console.consoleErrors);
  const optionalErrors = Number(console.provenOptionalErrors);
  const validatedRows = Number(result.validatedRows);
  const validatedDockets = Number(result.validatedDockets);
  const observedRows = Number(result.observedRows);
  const structureRows = object(m.structure) ? Number(m.structure.dataRowCount) : -1;
  if ((console.status === "CLEAN" && (runtime || consoleErrors || optionalErrors))
    || (console.status === "PROVEN_OPTIONAL_ONLY" && (!optionalErrors || runtime || consoleErrors))
    || (console.status === "UNCLASSIFIED_CONSOLE_ERRORS" && (!consoleErrors || runtime))
    || (console.status === "RUNTIME_EXCEPTIONS" && (!runtime || consoleErrors))
    || (console.status === "MIXED" && (!runtime || !consoleErrors))) return false;
  if (m.parserAttempted) {
    if (result.outcome === "NOT_RUN"
      || observedRows !== (m.inspectionStatus === "OBSERVED" ? structureRows : -1))
      return false;
    if (result.outcome === "VALIDATED_NONEMPTY"
      && (m.parserOutcome !== "CANDIDATE_NONEMPTY" || validatedRows < 1
        || validatedDockets < 1 || result.documentLinks !== "ALL_VALID"
        || result.scope !== "ALL_ROWS_MATCH" || result.dates !== "ALL_WITHIN_REQUEST"))
      return false;
    if (result.outcome === "EMPTY_NOT_PROVEN"
      && (m.parserOutcome !== "NO_EMPTY_PROOF" || observedRows !== 0
        || validatedRows !== 0 || validatedDockets !== 0
        || result.documentLinks !== "NO_ROWS" || result.scope !== "NO_ROWS" || result.dates !== "NO_ROWS"))
      return false;
    if (result.outcome === "VALIDATED_EMPTY"
      && (m.parserOutcome !== "EXPLICIT_EMPTY_RESULT" || observedRows !== 1
        || validatedRows !== 1 || validatedDockets !== 0
        || result.documentLinks !== "NO_ROWS" || result.scope !== "NO_ROWS" || result.dates !== "NO_ROWS"
        || result.explicitEmptyResult !== "SOURCE_STATUS_MARKER"
        || !object(m.structure) || m.structure.bodyPresent !== true
        || m.structure.searchFormPresent !== true || m.structure.resultTableCount !== 1
        || m.structure.headerCellCount !== 19 || m.structure.dataRowCount !== 1
        || m.structure.documentLinkCount !== 0 || m.structure.expectedHeaders !== true
        || m.structure.countsCapped !== false)) return false;
    if (result.outcome !== "VALIDATED_EMPTY"
      && result.explicitEmptyResult !== "NOT_CAPTURED") return false;
    if (["MISSING_TABLE", "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED",
      "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"].includes(String(result.outcome))
      && (m.parserOutcome !== result.outcome || validatedRows !== 0
        || validatedDockets !== 0 || result.documentLinks !== "REJECTED"
        || result.scope !== "REJECTED" || result.dates !== "REJECTED")) return false;
  } else if (result.outcome !== "NOT_RUN" || result.observedRows !== 0
    || result.validatedRows !== 0 || result.validatedDockets !== 0
    || result.documentLinks !== "NOT_CHECKED" || result.scope !== "NOT_CHECKED"
    || result.dates !== "NOT_CHECKED") return false;
  if (m.documentEligibility === "ELIGIBLE"
    && (!m.responseCompleted || !m.parserAttempted
      || m.criteriaValidation !== "INTERCEPTED_POST_BODY_MATCHED"
      || transport.status !== "COMPLETE" || !transport.requiredAssetsLoaded
      || transport.requestFailureObserved || m.classificationOverflow
      || !["CLEAN", "PROVEN_OPTIONAL_ONLY"].includes(String(console.status))
      || runtime || consoleErrors || result.outcome !== "VALIDATED_NONEMPTY"
      || validatedRows < 1)) return false;
  if (m.documentEligibility === "VALIDATED_EMPTY"
    && (!m.responseCompleted || !m.parserAttempted
      || m.criteriaValidation !== "INTERCEPTED_POST_BODY_MATCHED"
      || transport.status !== "COMPLETE" || !transport.requiredAssetsLoaded
      || transport.requestFailureObserved || m.classificationOverflow
      || !["CLEAN", "PROVEN_OPTIONAL_ONLY"].includes(String(console.status))
      || runtime || consoleErrors || result.outcome !== "VALIDATED_EMPTY"
      || result.explicitEmptyResult !== "SOURCE_STATUS_MARKER")) return false;
  if (m.documentEligibility === "VALIDATED_EMPTY" && result.outcome !== "VALIDATED_EMPTY") return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_CONSOLE" && !runtime && !consoleErrors) return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_TRANSPORT" && transport.status === "COMPLETE") return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_CRITERIA"
    && m.criteriaValidation === "INTERCEPTED_POST_BODY_MATCHED") return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_RESULT" && result.outcome === "VALIDATED_NONEMPTY") return false;
  if (m.documentEligibility === "BLOCKED_RESULT" && result.outcome === "VALIDATED_EMPTY") return false;
  if (transport.status === "COMPLETE"
    && (!m.responseCompleted || !transport.requiredAssetsLoaded || transport.requestFailureObserved))
    return false;
  const seen = new Set<string>();
  for (const row of m.classifications) {
    if (!object(row) || !keys(row, ["category", "phase", "alias", "signal", "count",
      "location", "match", "ordinal", "resource", "decision", "requestPhase", "requestStage",
      "stage", "readOnly", "failure", "firstSequence", "lastSequence", "eventState",
      "requestStartState", "firstEventOrder", "lastEventOrder",
      "firstRequestStartOrder", "lastRequestStartOrder"])
      || !oneOf(row.category, categories) || !oneOf(row.phase, ["READY", "RESULT"])
      || !oneOf(row.alias, aliases) || !oneOf(row.signal, signals)
      || !count(row.count, 10_000) || row.count === 0
      || !oneOf(row.location, ["MISSING", "INVALID", "NON_HTTP", "SOURCE_ASSET_PATH", "SOURCE_OTHER", "EXTERNAL_HTTP"])
      || !oneOf(row.match, ["UNIQUE", "AMBIGUOUS", "NONE", "OVERFLOW"])
      || !count(row.ordinal, 128) || !oneOf(row.resource, resources) || !oneOf(row.decision, decisions)
      || !oneOf(row.stage, stages) || typeof row.readOnly !== "boolean" || !oneOf(row.failure, failures)
      || !oneOf(row.requestPhase, ["READY", "RESULT", "UNKNOWN"]) || !oneOf(row.requestStage, [...stages, "UNKNOWN"])
      || !count(row.firstSequence, Number(m.eventSequence)) || !count(row.lastSequence, Number(m.eventSequence))
      || Number(row.firstSequence) < 1 || Number(row.lastSequence) < Number(row.firstSequence)
      || Number(row.count) > Number(row.lastSequence) - Number(row.firstSequence) + 1
      || !oneOf(row.eventState, lifecycleStates) || !oneOf(row.requestStartState, requestStartStates)
      || !validOrderPair(row.firstEventOrder, row.lastEventOrder, orderOverflow)
      || row.match === "UNIQUE" && (row.ordinal === 0 || row.requestPhase === "UNKNOWN" || row.requestStage === "UNKNOWN")
      || row.match !== "UNIQUE" && (row.ordinal !== 0
        || row.decision !== "UNKNOWN" && !(row.match === "AMBIGUOUS"
          && row.category === "BLOCKED_OPTIONAL_RESOURCE_ERROR" && row.decision === "OPTIONAL_ABORT")
        || row.requestPhase !== "UNKNOWN" || row.requestStage !== "UNKNOWN")
      || row.category === "BLOCKED_OPTIONAL_RESOURCE_ERROR" && (row.alias !== "BLOCKED_OPTIONAL"
        || !oneOf(row.signal, ["RESOURCE_ABORT", "REQUEST_FAILED"]) || !oneOf(row.match, ["UNIQUE", "AMBIGUOUS"])
        || row.decision !== "OPTIONAL_ABORT" || !(oneOf(row.resource, ["image", "font", "media"])
          || row.match === "AMBIGUOUS" && row.resource === "UNKNOWN"))
      || row.category === "JAVASCRIPT_EXCEPTION" && (row.alias !== "UNKNOWN" || row.signal !== "SCRIPT_EXCEPTION")
      || row.category === "REQUIRED_RESOURCE_FAILURE" && !oneOf(row.alias, ["MAIN_SCRIPT", "MAIN_STYLESHEET"]))
      return false;
    const noAssociatedStart = row.requestStartState === "NOT_ASSOCIATED"
      || row.requestStartState === "UNAVAILABLE";
    if (noAssociatedStart
      ? row.firstRequestStartOrder !== null || row.lastRequestStartOrder !== null
      : !validOrderPair(row.firstRequestStartOrder, row.lastRequestStartOrder, orderOverflow)) return false;
    if (!noAssociatedStart && row.firstRequestStartOrder !== null && row.firstEventOrder !== null
      && (Number(row.firstRequestStartOrder) > Number(row.firstEventOrder)
        || Number(row.lastRequestStartOrder) > Number(row.lastEventOrder))) return false;
    const eventMilestone = stateMilestone[String(row.eventState)];
    const requestMilestone = stateMilestone[String(row.requestStartState)];
    const eventFlag = stateFlag[String(row.eventState)];
    const requestFlag = stateFlag[String(row.requestStartState)];
    if (eventFlag && lifecycle[eventFlag] !== true
      || requestFlag && lifecycle[requestFlag] !== true) return false;
    if (eventMilestone && typeof lifecycle[eventMilestone] === "number"
      && row.firstEventOrder !== null
      && Number(lifecycle[eventMilestone]) > Number(row.firstEventOrder)) return false;
    if (requestMilestone && typeof lifecycle[requestMilestone] === "number"
      && typeof row.firstRequestStartOrder === "number"
      && Number(lifecycle[requestMilestone]) > Number(row.firstRequestStartOrder)) return false;
    const { count: _count, firstSequence: _first, lastSequence: _last,
      firstEventOrder: _eventFirst, lastEventOrder: _eventLast,
      firstRequestStartOrder: _requestFirst, lastRequestStartOrder: _requestLast, ...group } = row;
    const key = JSON.stringify(Object.keys(group).sort().map(k => [k, group[k]]));
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
