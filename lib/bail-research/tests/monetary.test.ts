import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eventConflict, matchesMonetaryResearch, projectQualifyingRows, qualifyingEntries,
  qualifyingRowsCsv, type BailEntry, type BailProvenance } from "../src/index";

const entry: BailEntry = { action: "Set", wording: "Monetary", orderDate: "2026-10-01",
  bailCategory: "MONETARY", financialBasis: "TOTAL_BAIL", amountCents: 10000 };
const provenance = (entries: BailEntry[] = [entry]): BailProvenance => ({
  extractionOutcome: "EXTRACTED", postedEntryState: "SHOWN_POSTED", entries,
  eventDate: "2026-10-20", eventType: "Formal Arraignment",
});
test("inclusive maximum/minimum, legacy strict, posted default, no-bound monetary only", () => {
  const p = provenance();
  assert.equal(matchesMonetaryResearch(p, {monetaryUpperBoundCents: 10000}), true);
  assert.equal(matchesMonetaryResearch(p, {monetaryLowerBoundCents: 10000}), true);
  assert.equal(matchesMonetaryResearch(p, {monetaryUpperBoundCents: 10000, inclusiveMaximum: false}), false);
  assert.equal(matchesMonetaryResearch(p, {excludeShownPosted: true}), false);
  for (const bailCategory of ["NOMINAL", "UNSECURED", "DENIED", "RECOGNIZANCE", "NONMONETARY", "UNKNOWN"])
    assert.equal(matchesMonetaryResearch(provenance([{...entry, bailCategory}]), {}), false);
  assert.equal(matchesMonetaryResearch(provenance([{...entry, amountCents: null}]), {}), false);
  assert.equal(matchesMonetaryResearch({...p, extractionOutcome: "MISSING_BAIL_SECTION", entries: []}), false);
});
test("settings and modifications are distinct; revocations and duplicate representations are not settings", () => {
  const entries = [entry, {...entry}, {...entry, action: "Modified", amountCents: 20000},
    {...entry, action: "Revoked"}, {...entry, action: "Denied"}];
  assert.equal(qualifyingEntries(provenance(entries)).length, 2);
});
test("multiple events pair with observations, while matching target counts one docket", () => {
  const p = provenance([entry, {...entry, action: "Modified", amountCents: 20000}]);
  p.matchingEvents = [{eventDate: "2026-10-20", eventType: "Formal Arraignment", eventTime: "8:00 am"},
    {eventDate: "2026-10-20", eventType: "Formal Arraignment", eventTime: "8:00 am"},
    {eventDate: "2026-10-21", eventType: "Formal Arraignment", eventTime: "9:00 am"}];
  const rows = projectQualifyingRows([{id: "structural", docketNumber: "", sourceUrl: "", provenance: p}]);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(row => row.itemId)).size, 1);
  assert.equal(qualifyingRowsCsv(rows).split("\r\n").length, 6);
});
test("missing PDF event is not contradictory; corresponding conflict and missing event withheld", () => {
  const p = provenance();
  assert.equal(matchesMonetaryResearch(p), true);
  p.pdfEvents = [{eventDate: "2026-10-21", eventType: "Formal Arraignment"}];
  assert.equal(eventConflict({eventDate: "2026-10-20", eventType: "Formal Arraignment"}, p), true);
  assert.equal(matchesMonetaryResearch(p), false);
  assert.equal(matchesMonetaryResearch({...provenance(), eventDate: null}), false);
});
test("genuine fixtures feed the same qualifying projection and exact CSV", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const fixtures = [
    ["CpDocketSheet_1792451669525.pdf", "CP-02-CR-0005845-2026", "2026-10-20", "Formal Arraignment", 10000],
    ["MdjDocketSheet_1792451676271.pdf", "MJ-05317-CR-0000264-2026", "2026-10-19", "Preliminary Hearing", 100000],
    ["MdjDocketSheet_(1)_1792451673387.pdf", "MJ-05310-NT-0000228-2026", "2026-10-20", "Summary Trial", null],
  ] as const;
  for (const [filename, docketNumber, eventDate, eventType, amount] of fixtures) {
    const parsed = spawnSync("python", ["-c",
      "import json,sys; from evidence import extract_bail; print(json.dumps(extract_bail(open(sys.argv[1],'rb').read(),sys.argv[2])))",
      path.join(root, "attached_assets", filename), docketNumber],
    {env: {...process.env, PYTHONPATH: path.join(root, "artifacts/api-server/src/ujs")}, encoding: "utf8"});
    assert.equal(parsed.status, 0, parsed.stderr);
    const p = {...JSON.parse(parsed.stdout), eventDate, eventType};
    const rows = projectQualifyingRows([{id: filename, docketNumber, sourceUrl: "", provenance: p}]);
    assert.equal(rows.length, amount === null ? 0 : 1);
    if (amount !== null) {
      assert.equal(rows[0].amountCents, amount);
      assert.equal(rows[0].hearingDate, eventDate);
      assert.equal(qualifyingRowsCsv(rows), `Hearing date,Docket number,Bail amount\r\n"${eventDate}","${docketNumber}",${(amount / 100).toFixed(2)}\r\n`);
    }
  }
});
