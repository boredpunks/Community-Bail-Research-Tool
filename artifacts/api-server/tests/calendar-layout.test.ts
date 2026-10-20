import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { calendarStructureReasons, isExplicitEmptyCalendarLayout, validCalendarLayout } from "../src/lib/calendar-layout";
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
assert(isExplicitEmptyCalendarLayout(observation));
for (const value of [
  { ...observation, rows: [{ ...observation.rows[0]!, statusLabel: "OTHER" }] },
  { ...observation, recognizedDocumentLinks: 1 },
  { ...observation, malformed: true },
  { ...observation, rows: [{ ...observation.rows[0]!, interactive: 1 }] },
  { ...observation, rows: [{ ...observation.rows[0]!, spanTotal: 18 }] },
  { ...observation, rows: [{ ...observation.rows[0]!, links: { ...observation.rows[0]!.links, other: 1 } }] },
]) assert(!isExplicitEmptyCalendarLayout(value));
for (const value of [
  { ...observation, html: "PRIVATE_SENTINEL" },
  { ...observation, rows: Array(9).fill(observation.rows[0]) },
  { ...observation, rows: [{ ...observation.rows[0], statusLabel: "PRIVATE_SENTINEL" }] },
  { ...observation, rows: [{ ...observation.rows[0], sourceUrl: "https://invalid.test/" }] },
  { ...observation, rows: [{ ...observation.rows[0], links: { ...observation.rows[0]!.links, other: -1 } }] },
]) assert(!validCalendarLayout(value));
const zeroCounts = { rawAnchorOccurrences: 0, uniqueRepresentations: 0,
  eligibleRepresentations: 0, uniqueEligibleActions: 0 };
const v2 = { ...observation, version: 2, rejectionReasons: [],
  candidateCounts: zeroCounts, rows: observation.rows.map(row => ({ ...row, candidateCounts: zeroCounts })) };
assert(validCalendarLayout(v2));
assert(isExplicitEmptyCalendarLayout(v2));
for (const reason of calendarStructureReasons) {
  const rejected = { ...v2, rejectionReasons: [reason] };
  assert(validCalendarLayout(rejected), reason);
  assert(!isExplicitEmptyCalendarLayout(rejected), reason);
}
assert(validCalendarLayout({ ...v2, rejectionReasons: ["NESTED_TABLE", "INVALID_CELL_SPAN"] }));
for (const value of [
  { ...v2, version: 3 },
  { ...v2, rejectionReasons: ["PRIVATE_SENTINEL"] },
  { ...v2, rejectionReasons: ["NESTED_TABLE", "NESTED_TABLE"] },
  { ...v2, rejectionReasons: "NESTED_TABLE" },
  { ...v2, candidateCounts: { ...zeroCounts, sourceUrl: "PRIVATE_SENTINEL" } },
  { ...v2, candidateCounts: { ...zeroCounts, rawAnchorOccurrences: -1 } },
  { ...v2, candidateCounts: { ...zeroCounts, rawAnchorOccurrences: 10_001 } },
  { ...v2, candidateCounts: { ...zeroCounts, uniqueRepresentations: 1 } },
  { ...v2, candidateCounts: { ...zeroCounts, rawAnchorOccurrences: 1.5 } },
  { ...v2, rows: [{ ...v2.rows[0], candidateCounts: { ...zeroCounts, eligibleRepresentations: 1 } }] },
  { ...v2, rows: [{ ...v2.rows[0], candidateCounts: undefined }] },
]) assert(!validCalendarLayout(value));

// Real Python emission → parent validator, plus vocabulary parity. No browser,
// source requests, docket identifiers, or database writes.
const wire = JSON.parse(execFileSync("python", ["-c", `
import json, sys
sys.path.insert(0, "src/ujs")
from evidence import CalendarResults
from calendar_structure import STRUCTURE_REASONS
p = CalendarResults()
p.feed('<table id="caseSearchResultGrid"><tr><th>Column</th></tr><tr><td colspan="invalid"></td></tr></table>')
try:
    p.validated({})
except ValueError:
    pass
print(json.dumps({"layout": p.contract_observation(), "reasons": STRUCTURE_REASONS}))
`], { encoding: "utf8" }));
assert(validCalendarLayout(wire.layout));
assert.deepEqual(wire.reasons, [...calendarStructureReasons]);
assert(wire.layout.rejectionReasons.includes("INVALID_CELL_SPAN"));
console.log("PASS: calendar structural projection is bounded and rejects raw/unknown source data");
