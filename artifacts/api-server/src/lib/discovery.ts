import { and, asc, eq } from "drizzle-orm";
import { db, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, type DiscoveryJobRow, type DiscoveryCriteriaData, type DiscoveryProvenanceData } from "@workspace/db";
import { qualifyingMonetaryTotal, resultsDeadline } from "./discovery-safety";

function policyInteger(key: string, initial: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined) return initial;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid protected operator policy: ${key}`);
  return value;
}
export const discoveryPolicy = {
  spacingMs: Math.max(60_000, policyInteger("UJS_SPACING_MS", 60_000, 30_000, 3_600_000)),
  maxRecordCap: policyInteger("UJS_MAX_RECORDS", 5, 1, 200),
  maxRequestCap: policyInteger("UJS_MAX_REQUESTS", 12, 8, 500),
  cooldownMs: policyInteger("UJS_RATE_LIMIT_COOLDOWN_MS", 900_000, 900_000, 86_400_000),
  hourlyRequestCap: policyInteger("UJS_MAX_HOURLY_REQUESTS", 30, 1, 500),
  dailyRequestCap: policyInteger("UJS_MAX_DAILY_REQUESTS", 120, 1, 2000),
};

export { easternToday, actualDate } from "./calendar-criteria";

export function matchesDiscoveryFilters(provenance: DiscoveryProvenanceData, filters: DiscoveryCriteriaData["matchFilters"]) {
  if (!["EXTRACTED", "MISSING_BAIL_SECTION"].includes(provenance.extractionOutcome)) return false;
  if (filters?.requirePostedNotShown && provenance.postedEntryState !== "NOT_SHOWN") return false;
  if (filters?.excludeShownPosted && provenance.postedEntryState === "SHOWN_POSTED") return false;
  const upper = filters?.monetaryUpperBoundCents;
  return upper == null || provenance.entries.some((entry) => qualifyingMonetaryTotal(
    entry.bailCategory, entry.financialBasis, entry.amountCents, upper, filters?.inclusiveMaximum === true));
}

export async function jobSummary(job: DiscoveryJobRow) {
  const [items, requests] = await Promise.all([
    db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.ownerId, job.ownerId))).orderBy(asc(discoveryItemsTable.position)),
    db.select().from(discoveryRequestsTable).where(and(eq(discoveryRequestsTable.jobId, job.id), eq(discoveryRequestsTable.ownerId, job.ownerId))),
  ]);
  const unprocessed = items.filter((item) => item.provenance.extractionOutcome === "UNPROCESSED").length;
  const failed = items.filter((item) => !["UNPROCESSED", "EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length;
  const matching = items.filter((item) => matchesDiscoveryFilters(item.provenance, job.criteria.matchFilters)).length;
  const counts = job.resultCounts ?? { discovered: items.length, processed: items.length - unprocessed, matching, failed, unprocessed };
  return {
    id: job.id, criteria: job.criteria, status: job.status,
    requestsUsed: job.requestsUsed,
    completedRequests: requests.filter((request) => request.outcome !== "IN_FLIGHT").length,
    failedRequests: requests.filter((request) => !["IN_FLIGHT", "OK"].includes(request.outcome)).length,
    ...counts,
    targetReached: job.criteria.matchTarget != null && counts.matching >= job.criteria.matchTarget,
    calendarComplete: job.calendarComplete, paginationComplete: job.paginationComplete,
    resultCapReached: job.resultCapReached, message: job.message,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
    resultsExpireAt: resultsDeadline(job)?.toISOString() ?? null,
    resultsExpiredAt: job.resultsExpiredAt?.toISOString() ?? null,
    candidateDockets: items.filter((item) => item.movedToCandidatesAt).length,
    isAssessment: !!job.assessmentId,
  };
}

export async function discoveryEvent(job: Pick<DiscoveryJobRow, "id" | "ownerId">, kind: string, message: string) {
  await db.insert(discoveryEventsTable).values({ jobId: job.id, ownerId: job.ownerId, kind, message });
}

