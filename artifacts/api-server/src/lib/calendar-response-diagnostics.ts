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
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === [...expected].sort().join();
const count = (v: unknown, max: number) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
export function validCalendarResponseDiagnostic(m: Record<string, unknown>) {
  if (!keys(m, ["kind", "version", "phase", "submissionObserved", "responseCompleted",
    "inspectionStatus", "structure", "parserAttempted", "parserOutcome", "stopGate",
    "classifications", "classificationOverflow", "blockedDuringInspection", "eventSequence", "milestones"])
    || m.kind !== "calendar_response_diagnostic" || m.version !== 2 || m.phase !== "RESULT"
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
