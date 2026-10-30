import { and, eq, inArray } from "drizzle-orm";
import { db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable, discoveryJobsTable, type BailSearchRow, type BailSearchQueueItem } from "@workspace/db";
import { selectBailDecision, qualifiesMonetary } from "../lib/bail-decision";
import { extractSavedBail, savedEntries } from "./saved-bail-extraction";
import { discoverySourceStatus } from "../lib/discovery-source-status";
import { logger } from "../lib/logger";
import { resultDatesForItem } from "./bail-search-projection";

const active = new Set<string>();
async function storeItem(search: BailSearchRow, queued: BailSearchQueueItem, cacheAllowed: boolean) {
  const [item] = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id, queued.itemId));
  let error: string | null = null;
  let entries = item ? savedEntries(item.provenance) : null;
  let acquisition = item?.provenance.extractionOutcome === "RETRIEVAL_FAILED" && !item.sourceRetrievedAt
    ? "RETRIEVAL_FAILED"
    : item?.sourceRetrievedAt ? "RETRIEVED_NO_EVIDENCE" : "NOT_RETRIEVED";
  let cacheEvidence: Awaited<ReturnType<typeof extractSavedBail>> | null = null;
  if (entries === null && cacheAllowed && item) {
    try { cacheEvidence = await extractSavedBail(item.docketNumber, item.sourceUrl); entries = cacheEvidence.entries; acquisition = "CACHE"; }
    catch { acquisition = "CACHE_UNAVAILABLE"; error = "Evidence is not locally available or could not be validated. No new request was made."; }
  } else if (entries === null) {
    error = item?.provenance.extractionOutcome === "RETRIEVAL_FAILED"
      ? "PDF retrieval failed; no document evidence was captured."
      : item?.sourceRetrievedAt
        ? "PDF retrieved, but no validated bail evidence was produced."
        : "PDF not retrieved; this row comes from the validated court calendar only.";
  }
  if (entries !== null && !cacheEvidence) acquisition = "STORED_EXTRACTION";
  const decision = selectBailDecision(entries ?? []);
  const values = {
    searchId: search.id, docketNumber: queued.docketNumber, hearingDate: queued.hearingDate,
    sourceItemId: item?.id ?? null,
    sourceUrl: item?.sourceUrl ?? null,
    sourceRetrievedAt: item?.sourceRetrievedAt ?? null,
    sourceConsultedAt: cacheEvidence?.consultedAt ?? item?.sourceRetrievedAt ?? null,
    sourcePdfSha256: cacheEvidence?.sha256 ?? item?.provenance.documentSha256 ?? null,
    sourcePageCount: cacheEvidence?.pageCount ?? item?.provenance.documentPageCount ?? null,
    office: queued.office, decisionDate: decision.decisionDate,
    classification: decision.classification,
    amountCents: decision.amount === null ? null : Math.round(decision.amount * 100),
    percentage: decision.percentage === null ? null : String(decision.percentage),
    evidencePage: decision.page, evidenceQuote: decision.quote, evidenceAcquisition: acquisition,
    qualifies: !error && qualifiesMonetary(decision, search.criteria.maxBail),
    ambiguous: decision.ambiguous, history: decision.history, error,
  };
  await db.insert(bailSearchResultsTable).values(values).onConflictDoUpdate({
    target: [bailSearchResultsTable.searchId, bailSearchResultsTable.docketNumber, bailSearchResultsTable.hearingDate],
    set: values,
  });
}

/**
 * Reflect a single, identity-checked PDF already processed by discovery.
 * This only writes the result projection; it never starts source traffic.
 */
export async function publishVerifiedDocumentToSearch(jobId: string, itemId: string) {
  const linkedSearches = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.discoveryJobId, jobId));
  const [item] = await db.select().from(discoveryItemsTable).where(and(
    eq(discoveryItemsTable.id, itemId), eq(discoveryItemsTable.jobId, jobId),
  ));
  if (!item || !item.sourceRetrievedAt || !item.provenance.documentSha256
    || !["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)) return;

  const allItems = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, jobId));
  for (const search of linkedSearches) {
    if (search.criteria.source !== "live") continue;
    const matching = resultDatesForItem(search.criteria, item)
      .filter(date => search.criteria.courtOffice === undefined || search.criteria.courtOffice === "ANY"
        || item.provenance.courtOffice === search.criteria.courtOffice);
    for (const hearingDate of matching) {
      await storeItem(search, {
        itemId: item.id, docketNumber: item.docketNumber, hearingDate, office: item.provenance.courtOffice,
      }, false);
    }
    const total = allItems.reduce((count, row) => count + resultDatesForItem(search.criteria, row)
      .filter(date => search.criteria.courtOffice === undefined || search.criteria.courtOffice === "ANY"
        || row.provenance.courtOffice === search.criteria.courtOffice).length, 0);
    const results = await db.select().from(bailSearchResultsTable)
      .where(eq(bailSearchResultsTable.searchId, search.id));
    await db.update(bailSearchesTable).set({
      total,
      processed: results.filter(row => !row.error).length,
      updatedAt: new Date(),
    }).where(eq(bailSearchesTable.id, search.id));
  }
}
export async function pauseSearch(search: BailSearchRow, reason: string, availableAt = new Date()) {
  await db.transaction(async tx => {
    if (search.discoveryJobId) await tx.update(discoveryJobsTable).set({ status: "PAUSED", updatedAt: new Date(), message: reason })
      .where(and(eq(discoveryJobsTable.id, search.discoveryJobId), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
    await tx.update(bailSearchesTable).set({ status: "paused", reason, resumeAvailableAt: availableAt, updatedAt: new Date() })
      .where(eq(bailSearchesTable.id, search.id));
  });
}
async function processSaved(search: BailSearchRow) {
  const existing = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, search.id));
  const done = new Set(existing.filter(r => !r.error).map(r => `${r.docketNumber}:${r.hearingDate}`));
  for (const item of search.queue) {
    if (done.has(`${item.docketNumber}:${item.hearingDate}`)) continue;
    if (Date.now() >= (search.leaseExpiresAt?.getTime() ?? 0)) {
      await pauseSearch(search, "Processing time limit reached. Resume to continue from saved progress."); return;
    }
    await storeItem(search, item, true);
  }
  const results = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, search.id));
  if (results.some(row => row.error)) {
    await pauseSearch(search, "Some evidence is unavailable locally. Completed results are saved. Resume after evidence becomes available; this mode makes no court requests.");
  } else await db.update(bailSearchesTable).set({ status: "complete", reason: null, updatedAt: new Date() }).where(eq(bailSearchesTable.id, search.id));
}
async function syncLive(search: BailSearchRow) {
  if (!search.discoveryJobId) { await pauseSearch(search, "Calendar search could not start."); return; }
  const [job] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, search.discoveryJobId));
  if (!job) { await pauseSearch(search, "Source search is unavailable."); return; }
  const items = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id));
  let total = 0;
  for (const item of items) {
    const dates = [...new Set(item.provenance.matchingEvents?.map(event => event.eventDate) ?? [item.provenance.eventDate])];
    for (const date of dates) {
      if (!date || date < search.criteria.startDate || date > search.criteria.endDate) continue;
      total++;
      await storeItem(search, { itemId: item.id, docketNumber: item.docketNumber, hearingDate: date, office: item.provenance.courtOffice }, false);
    }
  }
  await db.update(bailSearchesTable).set({ total, updatedAt: new Date() }).where(eq(bailSearchesTable.id, search.id));
  const results = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, search.id));
  if (job.status === "COMPLETED" && job.calendarComplete && job.paginationComplete && !job.resultCapReached && results.length === total && results.every(row => !row.error)) {
    await db.update(bailSearchesTable).set({ status: "complete", reason: null }).where(eq(bailSearchesTable.id, search.id)); return;
  }
  // The live engine owns its request budgets and waits. The local saved-PDF
  // processing slice must not cancel a legitimate paced calendar search.
  if (!["RUNNING", "QUEUED"].includes(job.status)) {
    const source = await discoverySourceStatus();
    await pauseSearch(search, job.message || "Processing paused. Partial results retained.",
      source.nextEligibleAt ? new Date(source.nextEligibleAt) : new Date());
  }
}
export async function runBailSearch(search: BailSearchRow) {
  if (active.has(search.id)) return;
  active.add(search.id);
  try {
    if (search.criteria.source === "saved") await processSaved(search);
    else await syncLive(search);
  } catch {
    await pauseSearch(search, "Processing stopped after a local error. Results are retained; no automatic retry.");
  } finally { active.delete(search.id); }
}
export async function publishCalendarRowsToSearch(jobId: string) {
  const [job] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, jobId));
  if (!job?.calendarComplete || job.resultsExpiredAt) return 0;
  const searches = await db.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.discoveryJobId, jobId));
  const items = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, jobId));
  let projected = 0;
  for (const search of searches) {
    if (search.criteria.source !== "live") continue;
    let total = 0;
    for (const item of items) {
      if (search.criteria.courtOffice && search.criteria.courtOffice !== "ANY"
        && item.provenance.courtOffice !== search.criteria.courtOffice) continue;
      for (const hearingDate of resultDatesForItem(search.criteria, item)) {
        total++;
        projected++;
        await storeItem(search, {
          itemId: item.id, docketNumber: item.docketNumber, hearingDate, office: item.provenance.courtOffice,
        }, false);
      }
    }
    const results = await db.select().from(bailSearchResultsTable)
      .where(eq(bailSearchResultsTable.searchId, search.id));
    await db.update(bailSearchesTable).set({
      total,
      processed: results.filter(row => !row.error).length,
      updatedAt: new Date(),
    }).where(eq(bailSearchesTable.id, search.id));
  }
  return projected;
}
export async function startBailSearchWorker() {
  // Startup cannot assume an interrupted request succeeded.
  const interrupted = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.status, "running"));
  for (const search of interrupted) await pauseSearch(search, "Server restarted. Saved results retained; resume explicitly.");
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.status, "running"));
      await Promise.all(rows.map(runBailSearch));
    } catch { logger.error("Volunteer search worker unavailable"); }
    finally { busy = false; }
  }, 2000);
  timer.unref();
}
