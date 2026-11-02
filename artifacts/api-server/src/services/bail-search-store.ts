import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, bailSearchesTable, bailSearchResultsTable, discoveryEventsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable,
  type BailSearchRow, type BailSearchResultRow, type BailSearchCriteria, type BailSearchQueueItem,
} from "@workspace/db";
import { csvCell } from "../lib/bail-decision";
import { resultEvidence } from "./bail-search-evidence";
import { chooseRecovery, recoveryWaitForAdmission } from "./bail-search-recovery";
import { easternToday } from "../lib/discovery";
import { resultsDeadline } from "../lib/discovery-safety";
import { calendarAdmission } from "../lib/research-operations";
import { sourceAdmissionBlock, discoverySourceStatus } from "../lib/discovery-source-status";
import { canAutomaticallyCheckOrdinaryPdfAccess } from "../lib/ordinary-search-proof";
import { autoResumeQuotaBlock, visibleSearchPauseReason } from "./bail-search-auto-resume";

type CalendarCoverage = {
  segmentsChecked: number;
  segmentsTotal: number | null;
  rowsObserved: number;
  rowsRetained: number;
  rowsExcluded: number;
  partial: boolean;
};

type LocalOcrProgress = {
  pagesTotal: number;
  pagesAttempted: number;
  pagesCompleted: number;
};

type SearchTimelineEntry = {
  id: string;
  at: string;
  label: string;
  detail: string | null;
  status: "in_progress" | "completed" | "failed" | "blocked";
  durationMs: number | null;
};

const timelineRequestLabel = (path: string, method: string) => {
  if (/^\/CaseSearch\/?$/i.test(path)) return method === "POST"
    ? "Submitted the court calendar search"
    : "Loaded the court calendar search";
  if (path.startsWith("/resource/")) return "Loaded a court calendar resource";
  if (PDF_REQUEST_PATHS.has(path)) return "Requested a docket PDF";
  return "Made a court-source request";
};

const safeTimelineRequestPath = (path: string) => {
  if (path === "/CaseSearch" || path === "/CaseSearch/") return "/CaseSearch";
  if (PDF_REQUEST_PATHS.has(path)) return path;
  return null;
};

async function searchTimeline(jobId: string | null | undefined): Promise<SearchTimelineEntry[]> {
  if (!jobId) return [];
  const [requests, events] = await Promise.all([
    db.select({
      id: discoveryRequestsTable.id,
      path: discoveryRequestsTable.path,
      method: discoveryRequestsTable.method,
      outcome: discoveryRequestsTable.outcome,
      statusCode: discoveryRequestsTable.statusCode,
      startedAt: discoveryRequestsTable.startedAt,
      durationMs: discoveryRequestsTable.durationMs,
    }).from(discoveryRequestsTable)
      .where(eq(discoveryRequestsTable.jobId, jobId))
      .orderBy(desc(discoveryRequestsTable.startedAt))
      .limit(100),
    db.select({
      id: discoveryEventsTable.id,
      kind: discoveryEventsTable.kind,
      message: discoveryEventsTable.message,
      createdAt: discoveryEventsTable.createdAt,
    }).from(discoveryEventsTable)
      .where(and(
        eq(discoveryEventsTable.jobId, jobId),
        inArray(discoveryEventsTable.kind, ["START", "CALENDAR", "DOCUMENT", "CALENDAR_COVERAGE", "LOCAL_OCR_PROGRESS"]),
      ))
      .orderBy(desc(discoveryEventsTable.createdAt))
      .limit(100),
  ]);
  const timeline: SearchTimelineEntry[] = requests.map(request => ({
    id: `request-${request.id}`,
    at: request.startedAt.toISOString(),
    label: `${request.method} · ${timelineRequestLabel(request.path, request.method)}`,
    status: request.outcome === "IN_FLIGHT" ? "in_progress"
      : request.outcome === "OK" ? "completed"
        : ["ACCESS_DENIED", "CHALLENGE", "LOGIN_PROMPT", "RATE_LIMIT"].includes(request.outcome) ? "blocked" : "failed",
    detail: `${safeTimelineRequestPath(request.path) ? `Path ${safeTimelineRequestPath(request.path)} · ` : ""}${
      request.outcome === "IN_FLIGHT" ? "Waiting for the court response."
        : `${request.statusCode === null ? "No HTTP status" : `HTTP ${request.statusCode}`} · source outcome ${request.outcome}`}`,
    durationMs: request.durationMs,
  }));
  for (const event of events) {
    let label: string | null = null;
    let detail: string | null = null;
    let status: SearchTimelineEntry["status"] = "completed";
    if (event.kind === "START") {
      label = "Court-source search started";
      detail = event.message.slice(0, 700);
    } else if (event.kind === "CALENDAR") {
      label = "Court calendar validated";
      detail = event.message.slice(0, 700);
    } else if (event.kind === "DOCUMENT") {
      const document = /^Document (\d+): ([A-Z_]+)\. PDF disposed after processing\. Custody remains unknown\.$/.exec(event.message);
      if (document) {
        label = `Docket PDF ${document[1]} processed`;
        detail = `Extraction outcome: ${document[2]}. The PDF was disposed after processing.`;
      }
    } else if (event.kind === "CALENDAR_COVERAGE") {
      try {
        const coverage = JSON.parse(event.message) as Partial<CalendarCoverage>;
        if (Number.isSafeInteger(coverage.segmentsChecked) && Number(coverage.segmentsChecked) >= 0
          && Number.isSafeInteger(coverage.rowsObserved) && Number(coverage.rowsObserved) >= 0
          && Number.isSafeInteger(coverage.rowsRetained) && Number(coverage.rowsRetained) >= 0
          && Number.isSafeInteger(coverage.rowsExcluded) && Number(coverage.rowsExcluded) >= 0) {
          label = "Calendar coverage updated";
          detail = `${coverage.segmentsChecked} segment(s) checked · ${coverage.rowsObserved} row(s) observed · ${coverage.rowsRetained} retained · ${coverage.rowsExcluded} excluded`;
        }
      } catch {
        // Ignore malformed progress events rather than exposing their contents.
      }
    } else if (event.kind === "LOCAL_OCR_PROGRESS") {
      try {
        const progress = JSON.parse(event.message) as Partial<LocalOcrProgress>;
        if (Number.isSafeInteger(progress.pagesTotal) && Number(progress.pagesTotal) > 0
          && Number.isSafeInteger(progress.pagesAttempted) && Number(progress.pagesAttempted) > 0
          && Number.isSafeInteger(progress.pagesCompleted) && Number(progress.pagesCompleted) >= 0
          && Number(progress.pagesCompleted) <= Number(progress.pagesAttempted)
          && Number(progress.pagesAttempted) <= Number(progress.pagesTotal)) {
          const activePage = Number(progress.pagesAttempted) > Number(progress.pagesCompleted);
          label = `Local OCR · scanned page ${progress.pagesAttempted} of ${progress.pagesTotal} ${activePage ? "started" : "read"}`;
          detail = `${progress.pagesAttempted} page(s) attempted · ${progress.pagesCompleted} completed`;
          status = "completed";
        }
      } catch {
        // Ignore malformed progress events rather than exposing their contents.
      }
    }
    if (label) timeline.push({
      id: `event-${event.id}`,
      at: event.createdAt.toISOString(),
      label,
      detail,
      status,
      durationMs: null,
    });
  }
  return timeline.sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).slice(-100);
}

async function localOcrProgress(jobId: string | null | undefined): Promise<LocalOcrProgress | null> {
  if (!jobId) return null;
  const [event] = await db.select({
    kind: discoveryEventsTable.kind,
    message: discoveryEventsTable.message,
  }).from(discoveryEventsTable).where(and(
    eq(discoveryEventsTable.jobId, jobId),
    inArray(discoveryEventsTable.kind, ["LOCAL_OCR_PROGRESS", "LOCAL_OCR_FINISHED"]),
  )).orderBy(desc(discoveryEventsTable.createdAt)).limit(1);
  if (!event || event.kind !== "LOCAL_OCR_PROGRESS") return null;
  try {
    const value = JSON.parse(event.message) as Partial<LocalOcrProgress>;
    if (Object.keys(value).sort().join(",") !== "pagesAttempted,pagesCompleted,pagesTotal"
      || !Number.isSafeInteger(value.pagesTotal) || Number(value.pagesTotal) < 1
      || Number(value.pagesTotal) > 100
      || !Number.isSafeInteger(value.pagesAttempted)
      || Number(value.pagesAttempted) < 1
      || Number(value.pagesAttempted) > Number(value.pagesTotal)
      || !Number.isSafeInteger(value.pagesCompleted)
      || Number(value.pagesCompleted) < 0
      || Number(value.pagesCompleted) > Number(value.pagesAttempted)) return null;
    return value as LocalOcrProgress;
  } catch {
    return null;
  }
}

async function calendarCoverage(jobId: string | null | undefined): Promise<CalendarCoverage> {
  const empty: CalendarCoverage = {
    segmentsChecked: 0, segmentsTotal: null, rowsObserved: 0, rowsRetained: 0, rowsExcluded: 0, partial: false,
  };
  if (!jobId) return empty;
  const [event] = await db.select({ message: discoveryEventsTable.message }).from(discoveryEventsTable)
    .where(and(eq(discoveryEventsTable.jobId, jobId), eq(discoveryEventsTable.kind, "CALENDAR_COVERAGE")))
    .orderBy(desc(discoveryEventsTable.createdAt)).limit(1);
  if (!event) return empty;
  try {
    const value = JSON.parse(event.message) as Partial<CalendarCoverage>;
    if (!Number.isSafeInteger(value.segmentsChecked) || Number(value.segmentsChecked) < 0
      || value.segmentsTotal !== null && (!Number.isSafeInteger(value.segmentsTotal)
        || Number(value.segmentsTotal) < Number(value.segmentsChecked))
      || !Number.isSafeInteger(value.rowsObserved) || Number(value.rowsObserved) < 0
      || !Number.isSafeInteger(value.rowsRetained) || Number(value.rowsRetained) < 0
      || !Number.isSafeInteger(value.rowsExcluded) || Number(value.rowsExcluded) < 0
      || typeof value.partial !== "boolean") throw new Error("Invalid retained calendar coverage");
    return value as CalendarCoverage;
  } catch {
    return empty;
  }
}

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

const PDF_REQUEST_PATHS = new Set(["/Report/CpDocketSheet", "/Report/MdjDocketSheet"]);
type DocumentRequestTimingRow = {
  itemId: string | null;
  path: string;
  outcome: string;
  durationMs: number | null;
  startedAt: Date;
};

export function latestDocumentRequestByItem(requests: readonly DocumentRequestTimingRow[]) {
  const latest = new Map<string, { outcome: string; durationMs: number | null }>();
  for (const request of [...requests].sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())) {
    if (!request.itemId || !PDF_REQUEST_PATHS.has(request.path) || latest.has(request.itemId)) continue;
    latest.set(request.itemId, { outcome: request.outcome, durationMs: request.durationMs });
  }
  return latest;
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
    review_dismissed: row.reviewDismissedAt !== null,
    source_consulted_at: row.sourceConsultedAt?.toISOString() ?? row.sourceRetrievedAt?.toISOString() ?? null,
    source_pdf_sha256: row.sourcePdfSha256,
  };
}
export async function enrichedResult(search: BailSearchRow, row: BailSearchResultRow,
  knownDocumentRequest?: { outcome: string; durationMs: number | null } | null) {
  const { item: _item, entry: _entry, ...evidence } = await resultEvidence(search, row, knownDocumentRequest);
  return { ...serializeSearchResult(row), ...evidence };
}
export async function searchRecovery(search: BailSearchRow, missingEvidence: boolean) {
  const [job] = search.discoveryJobId ? await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, search.discoveryJobId)) : [];
  let cooldown: Date | null = null;
  let sourceBlocked = false;
  let block: string | null = null;
  let latestRequest: { outcome: string; statusCode: number | null } | undefined;
  if (search.status === "paused" && search.criteria.source === "live") {
    if (job) {
      [latestRequest] = await db.select({
        outcome: discoveryRequestsTable.outcome,
        statusCode: discoveryRequestsTable.statusCode,
      }).from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id))
        .orderBy(desc(discoveryRequestsTable.startedAt)).limit(1);
    }
    const [source] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS"));
    block = !job?.calendarComplete ? await calendarAdmission(db, source) : await db.transaction(tx => sourceAdmissionBlock(tx, source));
    if (job && ["ACCESS_UNVERIFIED", "SOURCE_VALIDATION_BARRIER"].includes(block ?? "")
      && await canAutomaticallyCheckOrdinaryPdfAccess(job, source)) block = null;
    // Only a wait returned by the same admission calculation can expose
    // Resume later. A future pacing estimate must not mask an access block.
    if (block) {
      const status = await discoverySourceStatus();
      cooldown = recoveryWaitForAdmission(block, [
        search.resumeAvailableAt,
        status.nextEligibleAt ? new Date(status.nextEligibleAt) : null,
        status.pausedUntil ? new Date(status.pausedUntil) : null,
      ]);
    }
    sourceBlocked = !!block && !cooldown;
  }
  const deadline = job ? resultsDeadline(job) : null;
  const expired = !!job && (job.status !== "PAUSED" || !!job.resultsExpiredAt
    || !!job.assessmentId || !!(deadline && deadline <= new Date())
    || !job.calendarComplete && job.criteria.startDate < easternToday()
    || job.requestsUsed >= job.criteria.requestCap);
  const expiryReason = !job ? null
    : job.requestsUsed >= job.criteria.requestCap ? "This search used its full source-request budget."
      : !job.calendarComplete && job.criteria.startDate < easternToday() ? "The original calendar date window has passed."
        : job.resultsExpiredAt || deadline && deadline <= new Date() ? "The retained source results have expired."
          : job.assessmentId ? "This source job belongs to an assessment scope that cannot be resumed from this search."
            : job.status !== "PAUSED" ? "The linked source job is no longer paused."
              : null;
  return {
    job, recovery: chooseRecovery({ paused: search.status === "paused", saved: search.criteria.source === "saved",
      missingEvidence, expired, noJob: search.criteria.source === "live" && !job, sourceBlocked, cooldown,
      evidence: {
        calendarValidated: !!job?.calendarComplete,
        autoResumeQuota: autoResumeQuotaBlock(search.reason) !== null,
        retainedRows: await db.select({ id: bailSearchResultsTable.id }).from(bailSearchResultsTable)
          .where(eq(bailSearchResultsTable.searchId, search.id)).then(rows => rows.length),
        documentsDiscovered: job ? await db.select({ id: discoveryItemsTable.id }).from(discoveryItemsTable)
          .where(eq(discoveryItemsTable.jobId, job.id)).then(rows => rows.length) : 0,
        documentsProcessed: job ? await db.select({ id: discoveryItemsTable.id }).from(discoveryItemsTable)
          .where(and(eq(discoveryItemsTable.jobId, job.id),
            sql`${discoveryItemsTable.provenance}->>'extractionOutcome' <> 'UNPROCESSED'`)).then(rows => rows.length) : 0,
        blockReason: block,
        latestOutcome: latestRequest?.outcome ?? null,
        latestStatusCode: latestRequest?.statusCode ?? null,
        jobMessage: job?.message ?? search.reason,
        expiryReason,
        source: search.criteria.source,
      },
    }),
  };
}
export async function searchResponse(search: BailSearchRow, includeResults = true) {
  const rows = await db.select().from(bailSearchResultsTable)
    .where(eq(bailSearchResultsTable.searchId, search.id))
    .orderBy(asc(bailSearchResultsTable.hearingDate), asc(bailSearchResultsTable.docketNumber));
  const completed = rows.filter(row => !row.error).length;
  const { job, recovery } = await searchRecovery(search, rows.some(row => !!row.error));
  const stage = search.criteria.source === "live" && !job?.calendarComplete
    ? search.status === "running" ? "finding_hearings" : search.status
    : search.status === "running" || search.status === "paused" ? "checking_documents" : search.status;
  const queueItemByKey = new Map(search.queue.map(item => [`${item.docketNumber}:${item.hearingDate}`, item]));
  const documentItemIds = [...new Set(rows.flatMap(row => {
    const id = row.sourceItemId ?? queueItemByKey.get(`${row.docketNumber}:${row.hearingDate}`)?.itemId;
    return id ? [id] : [];
  }))];
  const documentItems = documentItemIds.length
    ? await db.select({
      id: discoveryItemsTable.id,
      sourceRetrievedAt: discoveryItemsTable.sourceRetrievedAt,
      extractionOutcome: sql<string>`${discoveryItemsTable.provenance}->>'extractionOutcome'`,
      entries: sql<unknown[]>`${discoveryItemsTable.provenance}->'entries'`,
    }).from(discoveryItemsTable).where(inArray(discoveryItemsTable.id, documentItemIds))
    : [];
  const documentRequests = job && documentItemIds.length
    ? await db.select({
      itemId: discoveryRequestsTable.itemId,
      path: discoveryRequestsTable.path,
      outcome: discoveryRequestsTable.outcome,
      startedAt: discoveryRequestsTable.startedAt,
      durationMs: discoveryRequestsTable.durationMs,
    }).from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.jobId, job.id),
      inArray(discoveryRequestsTable.itemId, documentItemIds),
      inArray(discoveryRequestsTable.path, ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"]),
    )).orderBy(desc(discoveryRequestsTable.startedAt))
    : [];
  const latestRequestsByItem = latestDocumentRequestByItem(documentRequests);
  const itemIdByResult = (row: BailSearchResultRow) => row.sourceItemId
    ?? queueItemByKey.get(`${row.docketNumber}:${row.hearingDate}`)?.itemId;
  const retrievedItemIds = new Set(documentRequests.flatMap(request => request.itemId && request.outcome === "OK" ? [request.itemId] : []));
  for (const item of documentItems) if (item.sourceRetrievedAt) retrievedItemIds.add(item.id);
  const documentsProcessed = documentItems.filter(item => !!item.sourceRetrievedAt && item.extractionOutcome !== "UNPROCESSED").length;
  const documentsWithEvidence = documentItems.filter(item => item.extractionOutcome === "EXTRACTED"
    && Array.isArray(item.entries) && item.entries.length > 0).length;
  const [currentRequest] = job ? await db.select({
    method: discoveryRequestsTable.method,
    path: discoveryRequestsTable.path,
    startedAt: discoveryRequestsTable.startedAt,
  }).from(discoveryRequestsTable).where(and(
    eq(discoveryRequestsTable.jobId, job.id),
    eq(discoveryRequestsTable.outcome, "IN_FLIGHT"),
  )).limit(1) : [];
  const coverage = await calendarCoverage(job?.id);
  const timeline = includeResults ? await searchTimeline(job?.id) : [];
  const ocrProgress = search.status === "running" && job?.status === "RUNNING"
    ? await localOcrProgress(job.id)
    : null;
  return {
    searchId: search.id, status: search.status as "running" | "paused" | "complete",
    criteria: search.criteria,
    progress: {
      completed, total: search.total, pending: Math.max(0, search.total - completed),
      calendarValidated: !!job?.calendarComplete,
      calendarCoverage: coverage,
      documentsDiscovered: documentItemIds.length,
      documentRequestsAttempted: documentRequests.length,
      documentsRetrieved: retrievedItemIds.size,
      documentsProcessed,
      documentsWithEvidence,
      sourceRequestsUsed: job?.requestsUsed ?? 0,
      sourceRequestLimit: job?.criteria.requestCap ?? null,
      localOcr: ocrProgress,
      timeline,
      ...(currentRequest ? { currentRequest: {
        method: currentRequest.method, path: currentRequest.path, startedAt: currentRequest.startedAt.toISOString(),
      } } : {}),
    },
    incomplete: search.status !== "complete",
    reason: search.status === "running" && job ? job.message : visibleSearchPauseReason(search.reason),
    resumeToken: ["resume", "wait"].includes(recovery.action) ? resumeToken(search) : null,
    resumeAvailableAt: recovery.availableAt,
    results: includeResults ? await Promise.all(rows.map(row => {
      const itemId = itemIdByResult(row);
      return enrichedResult(search, row, itemId ? latestRequestsByItem.get(itemId) ?? null : null);
    })) : [],
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
export async function exportSearchCsv(
  search: BailSearchRow,
  selection: "all" | "matches" | "visible" = "all",
  office?: string,
  officeMode?: "exact" | "unrecorded",
) {
  const result = await searchResponse(search);
  const columns = ["docket_number", "hearing_date", "decision_date", "office", "bail_amount",
    "percentage", "classification", "evidence_page", "evidence_quote", "qualifies", "ambiguous",
    "error", "evidence_acquisition", "source_url", "source_retrieved_at", "source_consulted_at",
    "source_pdf_sha256", "saved_record_id", "review_status"] as const;
  const selected = result.results.filter(row => {
    if (selection === "matches" && !(row.qualifies && row.bail_amount !== null && !row.ambiguous)) return false;
    if (selection !== "visible") return true;
    if (officeMode === "unrecorded") return !row.office?.trim();
    if (officeMode === "exact") return office !== undefined && row.office === office;
    return true;
  });
  const officeDescription = selection !== "visible" ? "" : officeMode === "unrecorded"
    ? "; office: not recorded"
    : officeMode === "exact" ? `; office: ${office}` : "; office: all";
  return [
    `# Search incomplete: ${result.incomplete}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Source: ${search.criteria.source === "live" ? "live calendar search" : "saved evidence only; no new court requests"}`,
    "# Coverage scope: completion means the reported evidence set was checked, not complete court coverage",
    `# Hearing dates: ${search.criteria.startDate} through ${search.criteria.endDate}; maximum recorded bail: ${search.criteria.maxBail}`,
    `# Selection: ${selection}${officeDescription}; matches are amount-filter matches, not release eligibility`,
    `# Coverage: ${result.progress.completed}/${result.progress.total} complete; ${result.progress.pending} pending`,
    columns.join(","),
    ...selected.map(row => columns.map(column => csvCell(row[column])).join(",")),
    "",
  ].join("\r\n");
}
