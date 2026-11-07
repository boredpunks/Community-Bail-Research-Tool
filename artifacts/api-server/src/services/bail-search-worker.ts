import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, type BailSearchRow, type BailSearchQueueItem } from "@workspace/db";
import { discoverySourceStatus } from "../lib/discovery-source-status";
import { sourceTransportCooldownUntil } from "../lib/transport-cooldown";
import { logger } from "../lib/logger";
import { resultDatesForItem } from "./bail-search-projection";
import { storeItem } from "./bail-search-document-publisher";
import { completedLiveSearch } from "./bail-search-completion";
import {
  autoResumeBlock, autoResumeQuotaBlock, isLegacyQuotaPause, legacyQuotaResumeBlock,
  quotaResumeReason, temporarySourceAutoResumeReason, transportAutoResumeReason,
} from "./bail-search-auto-resume";
import { resumeBailSearch } from "./bail-search-resume";
export { publishVerifiedDocumentToSearch } from "./bail-search-document-publisher";

const active = new Set<string>();
const automaticResumeRejections = new Map<string, string>();
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
      await storeItem(search, { itemId: item.id, docketNumber: item.docketNumber, hearingDate: date, office: item.provenance.courtOffice }, false, db, item);
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
    const quotaReason = quotaResumeReason(source.blockedReason ?? "", job.message);
    const [sourceState] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
    const [latestRequest] = await db.select({
      outcome: discoveryRequestsTable.outcome,
      statusCode: discoveryRequestsTable.statusCode,
    })
      .from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id))
      .orderBy(desc(discoveryRequestsTable.startedAt)).limit(1);
    const transportUntil = await sourceTransportCooldownUntil(db, sourceState);
    const transportReason = transportAutoResumeReason(
      sourceState?.blockedReason, latestRequest?.outcome, transportUntil,
    );
    const sourceCooldownUntil = sourceState?.pausedUntil ?? transportUntil;
    const sourceRetryReason = temporarySourceAutoResumeReason(
      sourceState?.blockedReason, latestRequest?.outcome, latestRequest?.statusCode, sourceCooldownUntil,
    );
    const availableAt = [
      source.nextEligibleAt ? new Date(source.nextEligibleAt) : null,
      sourceState?.pausedUntil ?? null,
      transportUntil,
    ].flatMap(value => value && Number.isFinite(value.getTime()) ? [value] : [])
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date();
    await pauseSearch(search,
      quotaReason ?? transportReason ?? sourceRetryReason ?? (job.message || "Processing paused. Partial results retained."),
      availableAt);
  }
}

async function autoContinueQuotaSearches() {
  const paused = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.status, "paused"));
  const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const legacy = paused.filter(search => search.criteria.source === "live"
    && isLegacyQuotaPause(search.reason) && search.resumeAvailableAt
    && search.updatedAt > recentCutoff);
  if (legacy.length) {
    const oldestPause = new Date(Math.min(...legacy.map(search => search.updatedAt.getTime())));
    const starts = await db.select({ startedAt: discoveryRequestsTable.startedAt })
      .from(discoveryRequestsTable).where(and(
        eq(discoveryRequestsTable.sourceId, "UJS"),
        gt(discoveryRequestsTable.startedAt, new Date(oldestPause.getTime() - 24 * 60 * 60 * 1000)),
      ));
    for (const search of legacy) {
      const pauseTime = search.updatedAt.getTime();
      const recentStarts = starts.flatMap(request => request.startedAt <= search.updatedAt
        && request.startedAt.getTime() > pauseTime - 24 * 60 * 60 * 1000 ? [request.startedAt] : []);
      const block = legacyQuotaResumeBlock(search.reason, search.resumeAvailableAt, search.updatedAt, recentStarts);
      const reason = block ? quotaResumeReason(block, null) : null;
      if (reason) await db.update(bailSearchesTable).set({
        reason,
        updatedAt: new Date(),
      }).where(and(
        eq(bailSearchesTable.id, search.id),
        eq(bailSearchesTable.status, "paused"),
        eq(bailSearchesTable.reason, search.reason!),
      ));
    }
  }
  const now = new Date();
  const eligible = paused.filter(search => search.criteria.source === "live"
    && autoResumeBlock(search.reason) !== null
    && search.resumeAvailableAt !== null && search.resumeAvailableAt <= now);
  const outcomes = await Promise.all(eligible.map(async search => ({
    search,
    result: await resumeBailSearch(search.id, { automatic: true }),
  })));
  for (const { search, result } of outcomes) {
    if (result.ok) {
      automaticResumeRejections.delete(search.id);
      continue;
    }
    if (automaticResumeRejections.get(search.id) !== result.error) {
      automaticResumeRejections.set(search.id, result.error);
      logger.warn({ error: result.error }, "Automatic search continuation deferred by an eligibility check");
    }
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
        }, false, db, item);
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
      await autoContinueQuotaSearches();
      const rows = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.status, "running"));
      await Promise.all(rows.map(runBailSearch));
    } catch { logger.error("Volunteer search worker unavailable"); }
    finally { busy = false; }
  }, 2000);
  timer.unref();
}
