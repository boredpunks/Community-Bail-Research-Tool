import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import { db, discoveryItemsTable, discoveryJobsTable } from "@workspace/db";
import { matchesDiscoveryFilters } from "./discovery";
import { resultRetentionMs, resultsDeadline } from "./discovery-safety";

export function expiredResumeConflict(job: {
  status: string;
  updatedAt: Date;
  resultsExpiredAt: Date | null;
}, now = new Date()) {
  const deadline = resultsDeadline(job);
  return job.resultsExpiredAt || (deadline && deadline <= now)
    ? { status: 409 as const, error: "Unsaved results/checkpoints expired after 24 hours. This job cannot replay collection." }
    : null;
}

// Run periodically and before reading or saving results. Both cleanup and
// saving lock the job row, so the transaction cannot erase a concurrent save.
export async function clearExpiredDiscoveryResults(now = new Date(), store = db) {
  const jobs = await store.select({ id: discoveryJobsTable.id }).from(discoveryJobsTable).where(and(
    isNull(discoveryJobsTable.resultsExpiredAt),
    notInArray(discoveryJobsTable.status, ["RUNNING", "QUEUED"]),
    lt(discoveryJobsTable.updatedAt, new Date(now.getTime() - resultRetentionMs)),
  ));
  for (const job of jobs) await store.transaction(async (tx) => {
    const [current] = await tx.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id)).for("update");
    if (!current || current.resultsExpiredAt || !resultsDeadline(current) || resultsDeadline(current)! > now) return;
    const items = await tx.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id));
    const unprocessed = items.filter((item) => item.provenance.extractionOutcome === "UNPROCESSED").length;
    const counts = {
      discovered: items.length, processed: items.length - unprocessed, unprocessed,
      matching: items.filter((item) => matchesDiscoveryFilters(item.provenance, current.criteria.matchFilters)).length,
      failed: items.filter((item) => !["UNPROCESSED", "EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length,
    };
    // Legacy individually saved observations are protected too, regardless of
    // review status. Never delete candidate records or source request history.
    await tx.delete(discoveryItemsTable).where(and(
      eq(discoveryItemsTable.jobId, job.id), isNull(discoveryItemsTable.movedToCandidatesAt),
      sql`NOT EXISTS (SELECT 1 FROM bail_records b WHERE b.discovery_item_id = ${discoveryItemsTable.id})`,
    ));
    await tx.update(discoveryJobsTable).set({ resultsExpiredAt: now, resultCounts: counts }).where(eq(discoveryJobsTable.id, job.id));
  });
}
