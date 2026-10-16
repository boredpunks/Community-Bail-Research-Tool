const categories = ["JAVASCRIPT_EXCEPTION", "REQUIRED_RESOURCE_FAILURE",
  "BLOCKED_OPTIONAL_RESOURCE_ERROR", "OTHER_CONSOLE_ERROR", "UNKNOWN_OR_UNSAFE"];
const aliases = ["MAIN_DOCUMENT", "MAIN_SCRIPT", "MAIN_STYLESHEET", "BLOCKED_OPTIONAL", "OTHER", "UNKNOWN"];
const signals = ["RESOURCE_ABORT", "RESOURCE_LOAD_ERROR", "CONSOLE_ERROR", "UNCLASSIFIED", "SCRIPT_EXCEPTION", "REQUEST_FAILED"];
const outcomes = ["NOT_RUN", "CANDIDATE_NONEMPTY", "NO_EMPTY_PROOF", "MISSING_TABLE",
  "UNSUPPORTED_LAYOUT", "IDENTITY_OR_SCOPE_REJECTED", "LINK_REJECTED", "DATE_REJECTED", "PARSER_ERROR"];
const gates = ["NONE", "SOURCE_STOPPED", "CALENDAR_REQUIRED_RESOURCE_BLOCKED",
  "CALENDAR_REQUIRED_ASSET_MISSING", "CALENDAR_SCRIPT_ERROR", "CALENDAR_CONSOLE_ERROR",
  "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE"];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === [...expected].sort().join();
const count = (v: unknown, max: number) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
export function validCalendarResponseDiagnostic(m: Record<string, unknown>) {
  if (!keys(m, ["kind", "version", "phase", "submissionObserved", "responseCompleted",
    "inspectionStatus", "structure", "parserAttempted", "parserOutcome", "stopGate",
    "classifications", "classificationOverflow", "blockedDuringInspection"])
    || m.kind !== "calendar_response_diagnostic" || m.version !== 1 || m.phase !== "RESULT"
    || !["submissionObserved", "responseCompleted", "parserAttempted", "classificationOverflow"]
      .every(k => typeof m[k] === "boolean")
    || !count(m.blockedDuringInspection, 10_000)
    || !oneOf(m.inspectionStatus, ["OBSERVED", "NOT_SAFE", "UNAVAILABLE"])
    || !oneOf(m.parserOutcome, outcomes) || !oneOf(m.stopGate, gates)
    || !Array.isArray(m.classifications) || m.classifications.length > 32) return false;
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
    if (!object(row) || !keys(row, ["category", "phase", "alias", "signal", "count"])
      || !oneOf(row.category, categories) || !oneOf(row.phase, ["READY", "RESULT"])
      || !oneOf(row.alias, aliases) || !oneOf(row.signal, signals)
      || !count(row.count, 10_000) || row.count === 0
      || row.category === "BLOCKED_OPTIONAL_RESOURCE_ERROR" && (row.alias !== "BLOCKED_OPTIONAL"
        || !oneOf(row.signal, ["RESOURCE_ABORT", "REQUEST_FAILED"]))
      || row.category === "JAVASCRIPT_EXCEPTION" && (row.alias !== "UNKNOWN" || row.signal !== "SCRIPT_EXCEPTION")
      || row.category === "REQUIRED_RESOURCE_FAILURE" && !oneOf(row.alias, ["MAIN_SCRIPT", "MAIN_STYLESHEET"]))
      return false;
    const key = JSON.stringify([row.category, row.phase, row.alias, row.signal]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
