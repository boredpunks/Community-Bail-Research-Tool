/** No arbitrary strings or source identifiers are allowed in this projection. */
export function validCalendarLayout(value: Record<string, unknown>) {
  const keys = (o: Record<string, unknown>, expected: string[]) =>
    Object.keys(o).sort().join() === expected.sort().join();
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const count = (v: unknown, max = 10_000) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
  if (!keys(value, ["kind", "version", "resultTables", "headerRows", "nonHeaderRows", "presentationRows",
    "recognizedDocumentLinks", "overflow", "malformed", "complete", "rows", "rowsOmitted"])
    || value.kind !== "calendar_layout" || value.version !== 1
    || !["resultTables", "headerRows", "nonHeaderRows", "presentationRows", "recognizedDocumentLinks"].every(k => count(value[k]))
    || !["overflow", "malformed", "complete", "rowsOmitted"].every(k => typeof value[k] === "boolean")
    || !Array.isArray(value.rows) || value.rows.length > 8) return false;
  return value.rows.every(row => obj(row)
    && keys(row, ["shape", "cells", "spanTotal", "docketShapedCell", "statusLabel", "interactive", "links"])
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
  const row = rows[0] as Record<string, unknown>;
  const links = row.links as Record<string, unknown>;
  return row.shape === "PRESENTATION_SHAPED" && row.cells === 1 && row.spanTotal === 19
    && !row.docketShapedCell
    && ["NO_RECORDS_FOUND", "NO_RESULTS_FOUND", "NO_DATA_AVAILABLE", "NO_MATCHING_RECORDS"]
      .includes(String(row.statusLabel))
    && row.interactive === 0
    && Object.values(links).every(count => count === 0);
}
