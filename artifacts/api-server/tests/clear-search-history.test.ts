import assert from "node:assert/strict";
import { planWorkspaceSearchHistoryClear } from "../src/services/bail-search-review";

const plan = planWorkspaceSearchHistoryClear([
  { id: "creator-a-running", ownerId: "session-a", discoveryJobId: "job-a", status: "running" },
  { id: "creator-b-paused", ownerId: "session-b", discoveryJobId: "job-b", status: "paused" },
  { id: "review-protected", ownerId: "session-b", discoveryJobId: "job-b", status: "running" },
  { id: "saved-complete", ownerId: "session-c", discoveryJobId: null, status: "complete" },
], new Set(["review-protected"]));

assert.deepEqual(plan.clearable.map(search => search.id), [
  "creator-a-running", "creator-b-paused", "saved-complete",
]);
assert.deepEqual(plan.retainedReview.map(search => search.id), ["review-protected"]);
assert.deepEqual(plan.linkedJobIds, ["job-a", "job-b"]);
assert.deepEqual(plan.runningSearchIds, ["creator-a-running", "review-protected"]);
console.log("PASS: workspace search clearing spans creator sessions, stops running jobs, and retains searches with active shared Review rows.");
