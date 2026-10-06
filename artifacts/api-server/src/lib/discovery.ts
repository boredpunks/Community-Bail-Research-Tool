import { and, asc, eq } from "drizzle-orm";
import { db, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, type DiscoveryJobRow, type DiscoveryCriteriaData, type DiscoveryProvenanceData } from "@workspace/db";

function policyInteger(key: string, initial: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined) return initial;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid protected operator policy: ${key}`);
  return value;
}
export const discoveryPolicy = {
  spacingMs: policyInteger("UJS_SPACING_MS", 30_000, 30_000, 3_600_000),
  maxRecordCap: policyInteger("UJS_MAX_RECORDS", 5, 1, 200),
  maxRequestCap: policyInteger("UJS_MAX_REQUESTS", 12, 8, 500),
  cooldownMs: policyInteger("UJS_RATE_LIMIT_COOLDOWN_MS", 900_000, 900_000, 86_400_000),
};

export function easternToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function matchesDiscoveryFilters(provenance: DiscoveryProvenanceData, filters: DiscoveryCriteriaData["matchFilters"]) {
  if (!["EXTRACTED", "MISSING_BAIL_SECTION"].includes(provenance.extractionOutcome)) return false;
  if (filters?.excludeShownPosted && provenance.postedEntryState === "SHOWN_POSTED") return false;
  const upper = filters?.monetaryUpperBoundCents;
  return upper == null || provenance.entries.some((entry) => entry.bailCategory === "MONETARY"
    && entry.financialBasis === "TOTAL_BAIL" && entry.amountCents !== null
    && Number.isSafeInteger(entry.amountCents) && entry.amountCents >= 0 && entry.amountCents < upper);
}

export async function jobSummary(job: DiscoveryJobRow) {
  const [items, requests] = await Promise.all([
    db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.ownerId, job.ownerId))).orderBy(asc(discoveryItemsTable.position)),
    db.select().from(discoveryRequestsTable).where(and(eq(discoveryRequestsTable.jobId, job.id), eq(discoveryRequestsTable.ownerId, job.ownerId))),
  ]);
  const unprocessed = items.filter((item) => item.provenance.extractionOutcome === "UNPROCESSED").length;
  const failed = items.filter((item) => !["UNPROCESSED", "EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length;
  const matching = items.filter((item) => matchesDiscoveryFilters(item.provenance, job.criteria.matchFilters)).length;
  return {
    id: job.id, criteria: job.criteria, status: job.status,
    requestsUsed: job.requestsUsed,
    completedRequests: requests.filter((request) => request.outcome !== "IN_FLIGHT").length,
    failedRequests: requests.filter((request) => !["IN_FLIGHT", "OK"].includes(request.outcome)).length,
    discovered: items.length, processed: items.length - unprocessed, matching,
    targetReached: job.criteria.matchTarget != null && matching >= job.criteria.matchTarget, failed, unprocessed,
    calendarComplete: job.calendarComplete, paginationComplete: job.paginationComplete,
    resultCapReached: job.resultCapReached, message: job.message,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  };
}

export async function discoveryEvent(job: Pick<DiscoveryJobRow, "id" | "ownerId">, kind: string, message: string) {
  await db.insert(discoveryEventsTable).values({ jobId: job.id, ownerId: job.ownerId, kind, message });
}

export function actualDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
