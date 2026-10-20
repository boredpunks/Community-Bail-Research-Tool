export const calendarStructureReasons = [
  "NESTED_TABLE", "ROW_OPENED_BEFORE_CLOSE", "CELL_OPENED_BEFORE_CLOSE",
  "INVALID_CELL_SPAN", "CELL_CLOSE_MISMATCH", "ROW_CLOSED_WITH_OPEN_CELL",
  "HEADER_CELL_SPAN", "COMPETING_DOCUMENT_ACTIONS", "DATA_CELL_SPAN",
  "MIXED_CELL_TYPES", "TABLE_CLOSED_WITH_OPEN_CONTENT", "RESULT_TABLE_MISSING",
  "RESULT_TABLE_COUNT", "HEADER_ROW_COUNT", "UNCLOSED_RESULT_CONTENT",
  "UNSUPPORTED_EVENT_HEADERS", "ROW_TOO_SHORT", "DOCUMENT_ACTION_MISSING",
  "CASE_INFORMATION_ROW_WIDTH", "CASE_INFORMATION_EVENT_DATE_MISSING",
  "CELL_OUTSIDE_ROW", "ROW_CLOSE_WITHOUT_OPEN_ROW", "SOURCE_FRAMING_REJECTED",
  "SOURCE_ENCODING_UNSUPPORTED", "SOURCE_DECODING_FAILED", "SOURCE_TOKEN_LIMIT",
  "SOURCE_STRUCTURE_MISMATCH", "EVENT_DATE_LAYOUT_UNSUPPORTED", "DOM_PROJECTION_LIMIT",
] as const;

const candidateKeys = ["rawAnchorOccurrences", "uniqueRepresentations",
  "eligibleRepresentations", "uniqueEligibleActions"];

/** Version 1 remains readable; version 2 adds closed reasons and numeric counts.
 * No arbitrary strings or source identifiers are allowed in either version.
 */
export function validCalendarLayout(value: Record<string, unknown>) {
  const keys = (o: Record<string, unknown>, expected: string[]) =>
    Object.keys(o).sort().join() === expected.sort().join();
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const count = (v: unknown, max = 10_000) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
  const candidates = (v: unknown) => obj(v) && keys(v, candidateKeys)
    && candidateKeys.every(k => count(v[k]))
    && Number(v.rawAnchorOccurrences) >= Number(v.uniqueRepresentations)
    && Number(v.uniqueRepresentations) >= Number(v.eligibleRepresentations)
    && Number(v.eligibleRepresentations) >= Number(v.uniqueEligibleActions);
  const v2 = value.version === 2;
  if (!keys(value, ["kind", "version", "resultTables", "headerRows", "nonHeaderRows", "presentationRows",
    "recognizedDocumentLinks", "overflow", "malformed", "complete", "rows", "rowsOmitted",
    ...(v2 ? ["rejectionReasons", "candidateCounts"] : [])])
    || value.kind !== "calendar_layout" || (value.version !== 1 && !v2)
    || !["resultTables", "headerRows", "nonHeaderRows", "presentationRows", "recognizedDocumentLinks"].every(k => count(value[k]))
    || !["overflow", "malformed", "complete", "rowsOmitted"].every(k => typeof value[k] === "boolean")
    || !Array.isArray(value.rows) || value.rows.length > 8) return false;
  if (v2 && (!Array.isArray(value.rejectionReasons)
    || value.rejectionReasons.length > calendarStructureReasons.length
    || new Set(value.rejectionReasons).size !== value.rejectionReasons.length
    || !value.rejectionReasons.every(r => typeof r === "string"
      && (calendarStructureReasons as readonly string[]).includes(r))
    || !candidates(value.candidateCounts)
    || (value.candidateCounts as Record<string, unknown>).uniqueEligibleActions !== value.recognizedDocumentLinks)) return false;
  return value.rows.every(row => obj(row)
    && keys(row, ["shape", "cells", "spanTotal", "docketShapedCell", "statusLabel", "interactive", "links",
      ...(v2 ? ["candidateCounts"] : [])])
    && (!v2 || candidates(row.candidateCounts))
    && ["PRESENTATION_SHAPED", "DATA_SHAPED", "OTHER"].includes(String(row.shape))
    && ["NO_RECORDS_FOUND", "NO_RESULTS_FOUND", "NO_DATA_AVAILABLE", "NO_MATCHING_RECORDS", "BLANK", "OTHER"].includes(String(row.statusLabel))
    && count(row.cells, 128) && count(row.spanTotal) && count(row.interactive, 128)
    && typeof row.docketShapedCell === "boolean" && obj(row.links)
    && keys(row.links, ["relativeDocket", "absoluteSourceDocket", "other", "identityMatched", "strictQuery"])
    && Object.values(row.links).every(v => count(v, 128)));
}

/** Exact sanitized contract needed before accepting an explicit empty result. */
export function isExplicitEmptyCalendarLayout(value: Record<string, unknown>) {
  const rows = value.rows;
  if (!validCalendarLayout(value) || value.resultTables !== 1 || value.headerRows !== 1
    || value.nonHeaderRows !== 1 || value.presentationRows !== 1
    || value.recognizedDocumentLinks !== 0 || value.overflow || value.malformed
    || !value.complete || value.rowsOmitted || !Array.isArray(rows) || rows.length !== 1) return false;
  if (value.version === 2 && ((value.rejectionReasons as unknown[]).length !== 0
    || Object.values(value.candidateCounts as Record<string, number>).some(count => count !== 0))) return false;
  const row = rows[0] as Record<string, unknown>;
  const links = row.links as Record<string, unknown>;
  return row.shape === "PRESENTATION_SHAPED" && row.cells === 1 && row.spanTotal === 19
    && !row.docketShapedCell
    && ["NO_RECORDS_FOUND", "NO_RESULTS_FOUND", "NO_DATA_AVAILABLE", "NO_MATCHING_RECORDS"]
      .includes(String(row.statusLabel))
    && row.interactive === 0
    && Object.values(links).every(count => count === 0);
}
