import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db, bailSearchesTable, discoveryItemsTable, discoveryJobsTable,
  discoveryRequestsTable, discoverySourceTable, type DiscoveryJobRow,
} from "@workspace/db";
import { integratedSourceMethod } from "./discovery-safety";
import { canUseOrdinarySearchFirstPdfAccessCheck, isOrdinarySearchPdfCandidate } from "./ordinary-search-access";
import { sourceTransportCooldownUntil } from "./transport-cooldown";

export async function canAutomaticallyCheckOrdinaryPdfAccess(
  job: DiscoveryJobRow,
  source: typeof discoverySourceTable.$inferSelect | undefined,
  context: { store?: Pick<typeof db, "select">; now?: () => Date } = {},
): Promise<boolean> {
  if (!source || !["PAUSED", "RUNNING", "QUEUED"].includes(job.status)) return false;
  const store = context.store ?? db;
  const now = context.now?.() ?? new Date();
  const [searches, items, requests] = await Promise.all([
    store.select().from(bailSearchesTable).where(and(
      eq(bailSearchesTable.discoveryJobId, job.id),
      inArray(bailSearchesTable.status, ["paused", "running"]),
    )),
    store.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id))
      .orderBy(asc(discoveryItemsTable.position)),
    store.select({ path: discoveryRequestsTable.path, method: discoveryRequestsTable.method })
      .from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id)),
  ]);
  const transportUntil = await sourceTransportCooldownUntil(store, source, now);
  const item = items.find(isOrdinarySearchPdfCandidate);
  if (!item) return false;
  return canUseOrdinarySearchFirstPdfAccessCheck({
    jobId: job.id, expectedJobId: job.id,
    itemId: item.id, expectedItemId: item.id,
    docketNumber: item.docketNumber, expectedDocketNumber: item.docketNumber,
    url: item.sourceUrl, expectedUrl: item.sourceUrl,
    requestPath: new URL(item.sourceUrl).pathname, method: "GET",
    block: "ACCESS_UNVERIFIED", sourceBlockedReason: source.blockedReason,
    accessVerifiedAt: source.accessVerifiedAt, verifiedMethod: source.verifiedMethod,
    pausedUntil: source.pausedUntil, activeRequestId: source.activeRequestId,
    // This is eligibility to resume; the scheduler rechecks actual RUNNING state
    // atomically before it reserves or transmits the first PDF request.
    jobStatus: "RUNNING", calendarComplete: job.calendarComplete,
    assessmentId: job.assessmentId, criteria: job.criteria,
    liveSearchLinked: searches.some(search => search.criteria.source === "live"),
    firstPendingItem: true, supportedCourtType: true,
    priorPdfRequests: requests.filter(request =>
      ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"].includes(request.path)).length,
    priorSearchPosts: requests.filter(request => request.path === "/CaseSearch" && request.method === "POST").length,
    now,
    transportCooldownExpired: !!transportUntil && transportUntil <= now,
  });
}

export async function establishOrdinarySearchAccessProof(
  job: DiscoveryJobRow,
  requestId: string,
  itemId: string,
  context: { store?: typeof db; now?: () => Date } = {},
): Promise<boolean> {
  const now = context.now?.() ?? new Date();
  return (context.store ?? db).transaction(async (tx) => {
    const [source] = await tx.select().from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, "UJS")).for("update");
    const [current] = await tx.select().from(discoveryJobsTable)
      .where(eq(discoveryJobsTable.id, job.id)).for("update");
    // Search ownership is session-specific; job ownership is workspace-wide.
    // The server-created job link, not equality of those identities, binds them.
    const [search] = await tx.select().from(bailSearchesTable).where(and(
      eq(bailSearchesTable.discoveryJobId, job.id),
      eq(bailSearchesTable.status, "running"),
    )).for("update");
    const [request] = await tx.select().from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.id, requestId),
      eq(discoveryRequestsTable.jobId, job.id),
      eq(discoveryRequestsTable.itemId, itemId),
      eq(discoveryRequestsTable.method, "GET"),
      inArray(discoveryRequestsTable.path, ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"]),
      eq(discoveryRequestsTable.outcome, "OK"),
      eq(discoveryRequestsTable.statusCode, 200),
    )).for("update");
    const [item] = await tx.select().from(discoveryItemsTable).where(and(
      eq(discoveryItemsTable.id, itemId), eq(discoveryItemsTable.jobId, job.id),
    ));
    if (!source || !current || current.status !== "RUNNING" || !search || search.criteria.source !== "live"
      || current.assessmentId !== null || current.criteria.resultVersion !== 2
      || current.criteria.calendarPreviewOnly === true || !current.calendarComplete || !request || !item
      || source.blockedReason !== null || (source.pausedUntil && source.pausedUntil > now)
      || source.activeRequestId !== null
      || !item.sourceRetrievedAt || !item.provenance.documentSha256
      || !["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome))
      return false;
    await tx.update(discoverySourceTable).set({
      accessVerifiedAt: now,
      verifiedMethod: integratedSourceMethod,
    }).where(eq(discoverySourceTable.id, "UJS"));
    return true;
  });
}
