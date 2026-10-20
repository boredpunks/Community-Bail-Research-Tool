import assert from "node:assert/strict";
import { documentLocations } from "../src/lib/document-locations";
import { observationKey } from "../src/lib/discovery-candidates";

// Protocol-only values, not a case, docket, order, or monetary observation.
const entry = { action: "", wording: "", orderDate: null, bailCategory: "UNKNOWN" as const,
  amountCents: null, financialBasis: null };
const message = { extractionOutcome: "EXTRACTED", documentSha256: "a".repeat(64),
  documentPageCount: 4, bailSectionPages: [2, 4], entries: [{ ...entry, sourcePages: [4] }] };
assert.deepEqual(documentLocations(message), {
  documentSha256: "a".repeat(64), documentPageCount: 4, bailSectionPages: [2, 4],
});
for (const invalid of [
  { ...message, documentSha256: "not-a-hash" },
  { ...message, bailSectionPages: [4, 2] },
  { ...message, documentPageCount: 3 },
  { ...message, entries: [{ ...entry, sourcePages: [1] }] },
  { ...message, entries: [{ ...entry, sourcePages: [] }] },
  { extractionOutcome: "EXTRACTED" },
  { ...message, extractionOutcome: "MISSING_BAIL_SECTION" },
]) assert.throws(() => documentLocations(invalid));
assert.deepEqual(documentLocations({ extractionOutcome: "UNREADABLE" }), {});
assert.deepEqual(documentLocations({ ...message, extractionOutcome: "MISSING_BAIL_SECTION",
  entries: [], bailSectionPages: [] }).bailSectionPages, []);
const item = { docketNumber: "NOT_A_CASE", excerpt: null };
assert.equal(observationKey(item, entry), observationKey(item, { ...entry, sourcePages: [4] }));
console.log("PASS: document page provenance and location-independent duplicate identity");
