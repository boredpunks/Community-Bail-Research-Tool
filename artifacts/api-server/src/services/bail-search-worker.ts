import { and, eq, inArray } from "drizzle-orm";
import { db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable, discoveryJobsTable, type BailSearchRow, type BailSearchQueueItem } from "@workspace/db";
import { selectBailDecision, qualifiesMonetary } from "../lib/bail-decision";
import { extractSavedBail, savedEntries } from "./saved-bail-extraction";
import { discoverySourceStatus } from "../lib/discovery-source-status";
import { logger } from "../lib/logger";

const active = new Set<string>();
async function storeItem(search: BailSearchRow, queued: BailSearchQueueItem, cacheAllowed: boolean) {
  const [item] = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id, queued.itemId));
  let error: string | null = null;
  let entries = item ? savedEntries(item.provenance) : null;
  let acquisition = "STORED_EXTRACTION";
  if (entries === null && cacheAllowed && item) {
    try { entries = await extractSavedBail(item.docketNumber, item.sourceUrl); acquisition = "CACHE"; }
    catch { error = "Evidence is not locally available or could not be validated. No new request was made."; }
  } else if (entries === null) error = "Document evidence is pending or could not be extracted.";
  const decision = selectBailDecision(entries ?? []);
  const values = {
    searchId: search.id, docketNumber: queued.docketNumber, hearingDate: queued.hearingDate,
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
  if (!["RUNNING", "QUEUED"].includes(job.status) || Date.now() >= (search.leaseExpiresAt?.getTime() ?? 0)) {
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
