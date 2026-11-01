import { and, eq, inArray } from "drizzle-orm";
import { db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable, discoveryJobsTable, type BailSearchRow, type BailSearchQueueItem } from "@workspace/db";
import { discoverySourceStatus } from "../lib/discovery-source-status";
import { logger } from "../lib/logger";
import { resultDatesForItem } from "./bail-search-projection";
import { storeItem } from "./bail-search-document-publisher";
import { completedLiveSearch } from "./bail-search-completion";
export { publishVerifiedDocumentToSearch } from "./bail-search-document-publisher";

const active = new Set<string>();
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
    if (search.criteria.courtOffice && search.criteria.courtOffice !== "ANY"
      && item.provenance.courtOffice !== search.criteria.courtOffice) continue;
    const dates = resultDatesForItem(search.criteria, item);
    for (const date of dates) {
      if (!date || date < search.criteria.startDate || date > search.criteria.endDate) continue;
      total++;
      await storeItem(search, { itemId: item.id, docketNumber: item.docketNumber, hearingDate: date, office: item.provenance.courtOffice }, false);
    }
  }
  await db.update(bailSearchesTable).set({ total, updatedAt: new Date() }).where(eq(bailSearchesTable.id, search.id));
  const results = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, search.id));
  const completion = completedLiveSearch(job, items, results, total);
  if (completion) {
    await db.update(bailSearchesTable).set({
      status: "complete", reason: completion.reason, resumeAvailableAt: null, updatedAt: new Date(),
    }).where(eq(bailSearchesTable.id, search.id)); return;
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
  // Repair old presentation-only pauses using retained evidence. No court
  // worker is launched and no PDF is fetched or retried by this reconciliation.
  const finished = await db.select({ search: bailSearchesTable }).from(bailSearchesTable)
    .innerJoin(discoveryJobsTable, eq(bailSearchesTable.discoveryJobId, discoveryJobsTable.id))
    .where(and(eq(bailSearchesTable.status, "paused"), eq(discoveryJobsTable.status, "COMPLETED"),
      eq(discoveryJobsTable.calendarComplete, true), eq(discoveryJobsTable.paginationComplete, true),
      eq(discoveryJobsTable.resultCapReached, false)));
  for (const { search } of finished) if (search.criteria.source === "live") await runBailSearch(search);
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
