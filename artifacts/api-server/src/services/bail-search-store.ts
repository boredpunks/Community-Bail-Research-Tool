import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable, discoveryJobsTable, discoverySourceTable,
  type BailSearchRow, type BailSearchResultRow, type BailSearchCriteria, type BailSearchQueueItem,
} from "@workspace/db";
import { csvCell } from "../lib/bail-decision";
import { resultEvidence } from "./bail-search-evidence";
import { chooseRecovery } from "./bail-search-recovery";
import { easternToday } from "../lib/discovery";
import { resultsDeadline } from "../lib/discovery-safety";
import { calendarAdmission } from "../lib/research-operations";
import { sourceAdmissionBlock, discoverySourceStatus } from "../lib/discovery-source-status";

export const SEARCH_SLICE_MS = 240_000;
export const sourceNotice = (source: string) => source === "live"
  ? "Live source search. Evidence is provisional, not confirmation of current custody, release eligibility, or amount payable."
  : "Saved workspace evidence only; no new court requests. Complete means this saved evidence set was processed, not complete court coverage.";

export function searchOwner(sessionCookie: string) {
  if (!process.env.SESSION_SECRET) throw new Error("Session signing is unavailable.");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`bail-search-owner:${sessionCookie}`).digest("hex");
}
export function resumeToken(search: BailSearchRow) {
  if (!process.env.SESSION_SECRET) throw new Error("Session signing is unavailable.");
  return createHmac("sha256", process.env.SESSION_SECRET)
    .update(`bail-resume:${search.id}:${search.ownerId}:${search.resumeVersion}`).digest("base64url");
}
export function validResumeToken(search: BailSearchRow, supplied: string) {
  const expected = Buffer.from(resumeToken(search));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function validateSearchDates(criteria: BailSearchCriteria) {
  const start = Date.parse(`${criteria.startDate}T00:00:00Z`);
  const end = Date.parse(`${criteria.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)
    || new Date(start).toISOString().slice(0, 10) !== criteria.startDate
    || new Date(end).toISOString().slice(0, 10) !== criteria.endDate
    || end < start || end - start > 365 * 86400_000
    || !Number.isSafeInteger(Math.round(criteria.maxBail * 100))
    || Math.abs(criteria.maxBail * 100 - Math.round(criteria.maxBail * 100)) > 0.00001) {
    throw new Error("Use valid hearing dates in order, at most one year apart, and a maximum with at most two decimal places.");
  }
}
export function serializeSearchResult(row: BailSearchResultRow) {
  return {
    id: row.id, docket_number: row.docketNumber, hearing_date: row.hearingDate,
    decision_date: row.decisionDate, office: row.office,
    bail_amount: row.amountCents === null ? null : row.amountCents / 100,
    percentage: row.percentage === null ? null : Number(row.percentage),
    classification: row.classification, evidence_page: row.evidencePage,
    evidence_quote: row.evidenceQuote, evidence_acquisition: row.evidenceAcquisition,
    qualifies: row.qualifies, ambiguous: row.ambiguous, error: row.error,
  };
}
export async function enrichedResult(search: BailSearchRow, row: BailSearchResultRow) {
  const { item: _item, entry: _entry, ...evidence } = await resultEvidence(search, row);
  return { ...serializeSearchResult(row), ...evidence };
}
export async function searchRecovery(search: BailSearchRow, missingEvidence: boolean) {
  const [job] = search.discoveryJobId ? await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, search.discoveryJobId)) : [];
  let cooldown = search.resumeAvailableAt;
  let sourceBlocked = false;
  if (search.status === "paused" && search.criteria.source === "live") {
    const status = await discoverySourceStatus();
    if (status.nextEligibleAt) cooldown = new Date(Math.max(cooldown?.getTime() ?? 0, Date.parse(status.nextEligibleAt)));
    const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
    const block = !job?.calendarComplete ? await calendarAdmission(db, source) : await db.transaction(tx => sourceAdmissionBlock(tx, source));
    // Timed pacing/quota waits are recoverable, unlike access denials.
    sourceBlocked = !!block && !cooldown;
    if (block && source?.blockedReason) sourceBlocked = true;
  }
  const expired = !!job && (job.status !== "PAUSED" || !!job.resultsExpiredAt
    || !!job.assessmentId || !!(resultsDeadline(job) && resultsDeadline(job)! <= new Date())
    || !job.calendarComplete && job.criteria.startDate < easternToday()
    || job.requestsUsed >= job.criteria.requestCap);
  return {
    job, recovery: chooseRecovery({ paused: search.status === "paused", saved: search.criteria.source === "saved",
      missingEvidence, expired, noJob: !job, sourceBlocked, cooldown }),
  };
}
export async function searchResponse(search: BailSearchRow, includeResults = true) {
  const rows = await db.select().from(bailSearchResultsTable)
    .where(eq(bailSearchResultsTable.searchId, search.id))
    .orderBy(asc(bailSearchResultsTable.hearingDate), asc(bailSearchResultsTable.docketNumber));
  const completed = rows.filter(row => !row.error).length;
  const { job, recovery } = await searchRecovery(search, rows.some(row => !!row.error));
  const stage = search.status === "running" ? search.criteria.source === "live" && !job?.calendarComplete ? "finding_hearings" : "checking_documents" : search.status;
  return {
    searchId: search.id, status: search.status as "running" | "paused" | "complete",
    criteria: search.criteria,
    progress: { completed, total: search.total, pending: Math.max(0, search.total - completed) },
    incomplete: search.status !== "complete", reason: search.reason,
    resumeToken: ["resume", "wait"].includes(recovery.action) ? resumeToken(search) : null,
    resumeAvailableAt: recovery.availableAt,
    results: includeResults ? await Promise.all(rows.map(row => enrichedResult(search, row))) : [],
    createdAt: search.createdAt.toISOString(), updatedAt: search.updatedAt.toISOString(),
    sourceNotice: sourceNotice(search.criteria.source),
    stage, recovery,
  };
}
export async function savedQueue(criteria: BailSearchCriteria, ownerIds: string[]) {
  const items = await db.select().from(discoveryItemsTable).where(and(
    inArray(discoveryItemsTable.ownerId, ownerIds),
    sql`(
      ${discoveryItemsTable.provenance}->>'eventDate' BETWEEN ${criteria.startDate} AND ${criteria.endDate}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(${discoveryItemsTable.provenance}->'matchingEvents', '[]'::jsonb)) event
        WHERE event->>'eventDate' BETWEEN ${criteria.startDate} AND ${criteria.endDate}
      )
    )`,
  )).orderBy(sql`${discoveryItemsTable.sourceRetrievedAt} DESC NULLS LAST`, desc(discoveryItemsTable.id)).limit(5001);
  if (items.length > 5000) throw new Error("This saved search is too broad. Narrow the hearing-date range.");
  const queue = new Map<string, BailSearchQueueItem>();
  for (const item of items) {
    const events = item.provenance.matchingEvents?.length
      ? item.provenance.matchingEvents.map(event => event.eventDate)
      : [item.provenance.eventDate];
    for (const date of events) {
      if (!date || date < criteria.startDate || date > criteria.endDate) continue;
      const key = `${item.docketNumber}:${date}`;
      if (!queue.has(key)) queue.set(key, { itemId: item.id, docketNumber: item.docketNumber,
        hearingDate: date, office: item.provenance.courtOffice });
    }
  }
  return [...queue.values()];
}
export async function exportSearchCsv(search: BailSearchRow, selection: "all" | "matches" = "all") {
  const result = await searchResponse(search);
  const columns = ["docket_number", "hearing_date", "decision_date", "office", "bail_amount",
    "percentage", "classification", "evidence_page", "evidence_quote", "qualifies", "ambiguous",
    "error", "evidence_acquisition", "source_url", "source_retrieved_at", "saved_record_id", "review_status"] as const;
  return [
    `# Search incomplete: ${result.incomplete}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Source: ${search.criteria.source === "live" ? "live calendar search" : "saved evidence only; no new court requests"}`,
    "# Coverage scope: completion means the reported evidence set was checked, not complete court coverage",
    `# Hearing dates: ${search.criteria.startDate} through ${search.criteria.endDate}; maximum recorded bail: ${search.criteria.maxBail}`,
    `# Selection: ${selection}; matches are amount-filter matches, not release eligibility`,
    `# Coverage: ${result.progress.completed}/${result.progress.total} complete; ${result.progress.pending} pending`,
    columns.join(","),
    ...result.results.filter(row => selection === "all" || row.qualifies).map(row => columns.map(column => csvCell(row[column])).join(",")),
    "",
  ].join("\r\n");
}
