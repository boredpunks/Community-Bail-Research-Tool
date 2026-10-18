import assert from "node:assert/strict";
import { validCalendarLayout } from "../src/lib/calendar-layout";
const observation = {
  kind: "calendar_layout", version: 1, resultTables: 1, headerRows: 1, nonHeaderRows: 1,
  presentationRows: 1, recognizedDocumentLinks: 0, overflow: false, malformed: false,
  complete: true, rowsOmitted: false, rows: [{
    shape: "PRESENTATION_SHAPED", cells: 1, spanTotal: 19, docketShapedCell: false,
    statusLabel: "NO_RECORDS_FOUND", interactive: 0,
    links: { relativeDocket: 0, absoluteSourceDocket: 0, other: 0, identityMatched: 0, strictQuery: 0 },
  }],
};
assert(validCalendarLayout(observation));
for (const value of [
  { ...observation, html: "PRIVATE_SENTINEL" },
  { ...observation, rows: Array(9).fill(observation.rows[0]) },
  { ...observation, rows: [{ ...observation.rows[0], statusLabel: "PRIVATE_SENTINEL" }] },
  { ...observation, rows: [{ ...observation.rows[0], sourceUrl: "https://invalid.test/" }] },
  { ...observation, rows: [{ ...observation.rows[0], links: { ...observation.rows[0]!.links, other: -1 } }] },
]) assert(!validCalendarLayout(value));
console.log("PASS: calendar structural projection is bounded and rejects raw/unknown source data");
