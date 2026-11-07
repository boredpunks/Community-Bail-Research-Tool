import { and, eq, sql } from "drizzle-orm";
import {
  db, bailSearchesTable, bailSearchResultsTable, discoveryJobsTable, discoverySourceTable,
} from "@workspace/db";
import { easternToday } from "../lib/discovery";
import { resultsDeadline } from "../lib/discovery-safety";
import { calendarAdmission } from "../lib/research-operations";
import { sourceAdmissionBlock } from "../lib/discovery-source-status";
import { canAutomaticallyCheckOrdinaryPdfAccess } from "../lib/ordinary-search-proof";
import { isSharedWorkspaceDiscoveryOwner } from "../lib/workspace-owner";
import { SEARCH_SLICE_MS, searchRecovery, validResumeToken } from "./bail-search-store";
import { autoResumeBlock, autoResumeSourceBlock } from "./bail-search-auto-resume";

type ResumeOptions = { resumeToken?: string; automatic?: boolean };
export type ResumeResult = { ok: true } | { ok: false; error: string; status: number; skipped?: boolean };

function denied(error: string, status = 409, skipped = false): ResumeResult {
  return { ok: false, error, status, ...(skipped ? { skipped: true } : {}) };
}

export async function resumeBailSearch(searchId: string, options: ResumeOptions = {}): Promise<ResumeResult> {
  const automatic = options.automatic === true;
  const [prior] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
  if (!prior) return denied("Search not found.", 404, automatic);
  if (options.resumeToken && !validResumeToken(prior, options.resumeToken))
    return denied("Invalid or expired resume token.", 403);
  if (automatic && (prior.criteria.source !== "live" || !autoResumeBlock(prior.reason)
    || !prior.resumeAvailableAt || prior.resumeAvailableAt > new Date()))
    return denied("This is not an eligible automatic continuation.", 409, true);

  const resultRows = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, prior.id));
  const { recovery } = await searchRecovery(prior, resultRows.some(row => !!row.error));
  if (recovery.action !== "resume") {
    if (automatic && recovery.action === "wait" && recovery.availableAt) {
      await db.update(bailSearchesTable).set({
        resumeAvailableAt: new Date(recovery.availableAt),
        updatedAt: new Date(),
      }).where(and(
        eq(bailSearchesTable.id, prior.id),
        eq(bailSearchesTable.status, "paused"),
      ));
    }
    return denied(recovery.message || "Search is not currently resumable.", 409, automatic);
  }
  const automaticSourceBlock = automatic ? autoResumeSourceBlock(prior.reason) : null;

  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${prior.ownerId}))`);
    const [search] = await tx.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, prior.id)).for("update");
    if (!search || search.status !== "paused" || options.resumeToken && !validResumeToken(search, options.resumeToken))
      return denied("Search is no longer paused or its resume permission expired.", 409, automatic);
    if (automatic && (search.criteria.source !== "live" || !autoResumeBlock(search.reason)
      || !search.resumeAvailableAt || search.resumeAvailableAt > new Date()))
      return denied("This is not an eligible automatic continuation.", 409, true);
    if (search.resumeAvailableAt && search.resumeAvailableAt > new Date())
      return denied("Source cooldown has not expired.", 409, automatic);

    const active = await tx.select().from(bailSearchesTable).where(and(
      eq(bailSearchesTable.ownerId, search.ownerId), eq(bailSearchesTable.status, "running"),
    ));
    if (active.length) return denied("Another search is running.", 409, automatic);

    if (search.criteria.source === "live") {
      if (!search.discoveryJobId) return denied("The source search did not start. Start a new search after the source blocker is resolved.", 409, automatic);
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [job] = await tx.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, search.discoveryJobId)).for("update");
      if (!job || !isSharedWorkspaceDiscoveryOwner(job.ownerId) || job.status !== "PAUSED" || job.assessmentId || job.resultsExpiredAt
        || (resultsDeadline(job) && resultsDeadline(job)! <= new Date())
        || (!job.calendarComplete && job.criteria.startDate < easternToday())
        || job.requestsUsed >= job.criteria.requestCap)
        return denied("Original source scope or budget cannot resume. Start a new eligible search.", 409, automatic);
      let block = !job.calendarComplete ? await calendarAdmission(tx, source) : await sourceAdmissionBlock(tx, source);
      const matchingRetryBlock = automaticSourceBlock === "HTTP_ERROR_5XX"
        ? source?.blockedReason === "HTTP_ERROR"
        : !!automaticSourceBlock && source?.blockedReason === automaticSourceBlock;
      const mayRecheckFirstPdfAccess = !automatic
        || matchingRetryBlock && block === "ACCESS_UNVERIFIED";
      if (mayRecheckFirstPdfAccess && ["ACCESS_UNVERIFIED", "SOURCE_VALIDATION_BARRIER"].includes(block ?? "")
        && await canAutomaticallyCheckOrdinaryPdfAccess(job, source, { store: tx })) block = null;
      if (block) return denied(`Source remains paused: ${block}.`, 409, automatic);
      await tx.update(discoveryJobsTable).set({
        status: "QUEUED",
        message: automatic
          ? "Source admission is available again. Continuing the original search within its existing scope and remaining budget."
          : job.message,
        updatedAt: new Date(),
      }).where(eq(discoveryJobsTable.id, job.id));
    }
    await tx.update(bailSearchesTable).set({
      status: "running",
      reason: automatic
        ? "Source admission is available again. Continuing the same search with retained results and remaining budget."
        : null,
      resumeVersion: search.resumeVersion + 1,
      leaseExpiresAt: new Date(Date.now() + SEARCH_SLICE_MS),
      resumeAvailableAt: null,
      updatedAt: new Date(),
    }).where(eq(bailSearchesTable.id, search.id));
    return null;
  });
  return result ?? { ok: true };
}
