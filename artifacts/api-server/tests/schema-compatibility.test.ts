import assert from "node:assert/strict";
import {
  GetBailSearchStatusParams,
  GetResearchOperationsResponse,
  SaveBailSearchResultParams,
  StartBailSearchBody,
  SubmitVolunteerFeedbackBody,
  UploadResearchDocumentQueryParams,
} from "@workspace/api-zod";

// Exercise regenerated schemas at runtime as well as through TypeScript.
// These are validation inputs, not case records or source evidence.
const searchId = "24b280a3-b6c8-4cdb-8db5-4701a49b1ded";
const resultId = "043c1c58-1351-40fe-9904-2bdc6b62cf36";
assert.deepEqual(SaveBailSearchResultParams.parse({ searchId, resultId }), { searchId, resultId });
assert.equal(GetBailSearchStatusParams.safeParse({ searchId: "not-a-uuid" }).success, false);
assert.equal(GetBailSearchStatusParams.safeParse({ searchId: 123 }).success, false);
assert.deepEqual(UploadResearchDocumentQueryParams.parse({}), {});
assert.equal(UploadResearchDocumentQueryParams.safeParse({ jobId: "invalid" }).success, false);

const feedback = { tryingToDo: "Validate inputs", obstacle: "Invalid input", needed: "Clear errors" };
assert.deepEqual(SubmitVolunteerFeedbackBody.parse({ ...feedback, unexpected: true }), feedback);
for (const invalid of [
  { ...feedback, needed: "" },
  { ...feedback, needed: "x".repeat(2001) },
  { ...feedback, needed: 123 },
  { ...feedback, needed: undefined },
]) assert.equal(SubmitVolunteerFeedbackBody.safeParse(invalid).success, false);

const criteria = StartBailSearchBody.parse({
  startDate: "2026-10-20", endDate: "2026-10-21", maxBail: 100, source: "saved",
});
assert.equal(criteria.startDate, "2026-10-20");
assert.equal(criteria.endDate, "2026-10-21");
const operations = {
  calendarEnabled: false, calendarBlockedReason: null,
  documentEnabled: false, documentBlockedReason: null,
  pacing: { interval: 1000 }, notice: "Validation test",
};
assert.deepEqual(GetResearchOperationsResponse.parse(operations), operations);
assert.equal(GetResearchOperationsResponse.safeParse({
  ...operations, pacing: { interval: 1.5 },
}).success, false);
console.log("PASS: Zod 4 UUIDs, optional inputs, feedback limits, date strings and pacing records");
