const categories = ["JAVASCRIPT_EXCEPTION", "REQUIRED_RESOURCE_FAILURE",
  "BLOCKED_OPTIONAL_RESOURCE_ERROR", "OTHER_CONSOLE_ERROR", "UNKNOWN_OR_UNSAFE"];
const aliases = ["MAIN_DOCUMENT", "MAIN_SCRIPT", "MAIN_STYLESHEET", "BLOCKED_OPTIONAL", "OTHER", "UNKNOWN"];
const signals = ["RESOURCE_ABORT", "RESOURCE_LOAD_ERROR", "CONSOLE_ERROR", "UNCLASSIFIED", "SCRIPT_EXCEPTION", "REQUEST_FAILED"];
const outcomes = ["NOT_RUN", "CANDIDATE_NONEMPTY", "NO_EMPTY_PROOF", "MISSING_TABLE",
  "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED", "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"];
const gates = ["NONE", "SOURCE_STOPPED", "CALENDAR_REQUIRED_RESOURCE_BLOCKED",
  "CALENDAR_REQUIRED_ASSET_MISSING", "CALENDAR_SCRIPT_ERROR", "CALENDAR_CONSOLE_ERROR",
  "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE", "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"];
const stages = ["BEFORE_SEARCH", "SEARCH_ARMED", "POST_ATTEMPT", "RESPONSE_RECEIVED",
  "RESPONSE_BODY_READ", "POST_ACKNOWLEDGED", "DOCUMENT_FULFILLED", "INSPECTION",
  "PARSER_STARTED", "PARSER_ACCEPTED", "PARSER_REJECTED"];
const resources = ["document", "script", "stylesheet", "image", "font", "media",
  "xhr", "fetch", "eventsource", "websocket", "manifest", "texttrack", "other", "UNKNOWN"];
const decisions = ["UNKNOWN", "OPTIONAL_ABORT", "POLICY_ABORT", "READ_ONLY_STOP", "CACHE", "FETCH_ATTEMPT"];
const failures = ["UNKNOWN", "NET_FAILED", "NET_ABORTED", "NET_BLOCKED_CLIENT", "DNS", "CONNECT",
  "TIMEOUT", "HTTP_DENIED", "HTTP_RATE_LIMIT", "HTTP_CLIENT", "HTTP_SERVER", "HTTP_OTHER", "OTHER"];
const transportStatuses = ["RESPONSE_INCOMPLETE", "SOURCE_STOPPED", "REQUIRED_RESOURCE_FAILURE",
  "REQUIRED_ASSET_MISSING", "UNCLASSIFIED_REQUEST_FAILURE", "DIAGNOSTIC_OVERFLOW", "COMPLETE"];
const consoleStatuses = ["CLEAN", "PROVEN_OPTIONAL_ONLY", "UNCLASSIFIED_CONSOLE_ERRORS",
  "RUNTIME_EXCEPTIONS", "MIXED"];
const resultOutcomes = ["NOT_RUN", "VALIDATED_NONEMPTY", "EMPTY_NOT_PROVEN", "MISSING_TABLE",
  "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED", "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"];
const eligibilityStates = ["BLOCKED_INTEGRITY", "BLOCKED_CRITERIA", "BLOCKED_TRANSPORT",
  "BLOCKED_CONSOLE", "BLOCKED_RESULT", "ELIGIBLE"];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === [...expected].sort().join();
const count = (v: unknown, max: number) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
export function validCalendarResponseDiagnostic(m: Record<string, unknown>) {
  if (!keys(m, ["kind", "version", "phase", "submissionObserved", "responseCompleted",
    "inspectionStatus", "structure", "parserAttempted", "parserOutcome", "criteriaValidation",
    "transportIntegrity", "consoleDiagnostics", "resultValidation", "documentEligibility", "stopGate",
    "classifications", "classificationOverflow", "blockedDuringInspection", "eventSequence", "milestones"])
    || m.kind !== "calendar_response_diagnostic" || m.version !== 3 || m.phase !== "RESULT"
    || !["submissionObserved", "responseCompleted", "parserAttempted", "classificationOverflow"]
      .every(k => typeof m[k] === "boolean")
    || !count(m.blockedDuringInspection, 10_000) || !count(m.eventSequence, 10_000)
    || !oneOf(m.inspectionStatus, ["OBSERVED", "NOT_SAFE", "UNAVAILABLE"])
    || !oneOf(m.parserOutcome, outcomes) || !oneOf(m.stopGate, gates)
    || !Array.isArray(m.classifications) || m.classifications.length > 32
    || !Array.isArray(m.milestones) || m.milestones.length > 16) return false;
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
    || marks.has("PARSER_ACCEPTED") && (marks.has("PARSER_REJECTED") || m.parserOutcome !== "CANDIDATE_NONEMPTY")) return false;
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
      || !count(s.headerCellCount, 128) || !count(s.dataRowCount, 1000)
      || !count(s.documentLinkCount, 1000)
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
    || !count(result.observedRows, 1000) || !count(result.validatedRows, 1000)
    || !count(result.validatedDockets, 1000)
    || Number(result.validatedRows) > Number(result.observedRows)
    || !oneOf(result.documentLinks, ["NOT_CHECKED", "NO_ROWS", "ALL_VALID", "REJECTED"])
    || !oneOf(result.scope, ["NOT_CHECKED", "NO_ROWS", "ALL_ROWS_MATCH", "REJECTED"])
    || !oneOf(result.dates, ["NOT_CHECKED", "NO_ROWS", "ALL_WITHIN_REQUEST", "REJECTED"])
    || result.explicitEmptyResult !== "NOT_CAPTURED"
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
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_CONSOLE" && !runtime && !consoleErrors) return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_TRANSPORT" && transport.status === "COMPLETE") return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_CRITERIA"
    && m.criteriaValidation === "INTERCEPTED_POST_BODY_MATCHED") return false;
  if (m.documentEligibility !== "ELIGIBLE"
    && m.documentEligibility === "BLOCKED_RESULT" && result.outcome === "VALIDATED_NONEMPTY") return false;
  if (transport.status === "COMPLETE"
    && (!m.responseCompleted || !transport.requiredAssetsLoaded || transport.requestFailureObserved))
    return false;
  const seen = new Set<string>();
  for (const row of m.classifications) {
    if (!object(row) || !keys(row, ["category", "phase", "alias", "signal", "count",
      "location", "match", "ordinal", "resource", "decision", "requestPhase", "requestStage",
      "stage", "readOnly", "failure", "firstSequence", "lastSequence"])
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
    const { count: _count, firstSequence: _first, lastSequence: _last, ...group } = row;
    const key = JSON.stringify(Object.keys(group).sort().map(k => [k, group[k]]));
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
