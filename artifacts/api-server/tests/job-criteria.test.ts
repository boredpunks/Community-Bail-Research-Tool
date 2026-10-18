import assert from "node:assert/strict";
import { CreateDiscoveryJobBody, ListDiscoveryJobsResponse } from "@workspace/api-zod";
const scope = { courtOffice: "CP-05-02-Crim", eventType: "Bail Hearing",
  startDate: "2030-01-01", endDate: "2030-01-01", recordCap: 1, requestCap: 3 };
// Public scope only, never a docket record. Historical observation budgets
// must serialize without relaxing new-job admission.
assert(ListDiscoveryJobsResponse.element.shape.criteria.safeParse(scope).success);
assert(!CreateDiscoveryJobBody.safeParse(scope).success);
assert(CreateDiscoveryJobBody.safeParse({ ...scope, requestCap: 8 }).success);
console.log("PASS: historical low-budget scope responses remain readable; new job minimum stays eight requests");
