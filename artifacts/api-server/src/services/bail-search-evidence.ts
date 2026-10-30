import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db, discoveryItemsTable, discoveryRequestsTable, bailRecordsTable,
  type BailDecisionEvidence, type BailSearchRow, type BailSearchResultRow,
  type DiscoveryEntryData, type DiscoveryItemRow,
} from "@workspace/db";
import { candidateEligible, observationValues, validCachedConsultationChronology } from "../lib/discovery-candidates";
import { allowedSourceRequest } from "../lib/discovery-safety";
import { savedEntries } from "./saved-bail-extraction";
import { selectBailDecision } from "../lib/bail-decision";

/** A source link alone is not sufficient proof to publish a monetary observation. */
export function safeDocketLink(url: string | null, docket: string) {
  try {
    return url && allowedSourceRequest(url, "GET") && new URL(url).searchParams.get("docketNumber") === docket ? url : null;
  } catch { return null; }
}

export type BailSearchDocumentStatus =
  | "NOT_REQUESTED"
  | "REQUEST_IN_PROGRESS"
  | "RETRIEVAL_FAILED"
  | "RETRIEVED"
  | "EXTRACTED"
  | "NO_BAIL_SECTION"
  | "EXTRACTION_FAILED"
  | "IDENTITY_MISMATCH"
  | "AMBIGUOUS";

export function bailSearchDocumentStatus(
  extractionOutcome: string | null | undefined,
  retrievedAt: Date | null | undefined,
  requestOutcome: string | null | undefined,
): BailSearchDocumentStatus {
  if (extractionOutcome === "EXTRACTED" && retrievedAt) return "EXTRACTED";
  if (extractionOutcome === "MISSING_BAIL_SECTION" && retrievedAt) return "NO_BAIL_SECTION";
  if (extractionOutcome === "IDENTITY_MISMATCH" && retrievedAt) return "IDENTITY_MISMATCH";
  if (extractionOutcome === "AMBIGUOUS_FINANCIAL_ASSOCIATION" && retrievedAt) return "AMBIGUOUS";
  if (retrievedAt && extractionOutcome !== "UNPROCESSED") return "EXTRACTION_FAILED";
  if (requestOutcome === "IN_FLIGHT") return "REQUEST_IN_PROGRESS";
  if (requestOutcome && requestOutcome !== "OK") return "RETRIEVAL_FAILED";
  if (retrievedAt || requestOutcome === "OK") return "RETRIEVED";
  return extractionOutcome === "RETRIEVAL_FAILED" ? "RETRIEVAL_FAILED" : "NOT_REQUESTED";
}

const categoryByClassification: Record<string, DiscoveryEntryData["bailCategory"]> = {
  monetary: "MONETARY",
  nominal: "NOMINAL",
  unsecured: "UNSECURED",
  nonmonetary: "NONMONETARY",
  denied: "DENIED",
};

function cachedEntry(entry: BailDecisionEvidence, office: string, pageCount: number): DiscoveryEntryData | null {
  if (!entry || typeof entry !== "object" || typeof entry.date !== "string"
    || typeof entry.quote !== "string" || typeof entry.classification !== "string") return null;
  const bailCategory = categoryByClassification[entry.classification];
  const parsedDate = new Date(`${entry.date}T00:00:00Z`);
  if (!bailCategory || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entry.date
    || !entry.quote.trim() || entry.quote.length > 500
    || !Number.isSafeInteger(entry.page) || !entry.page || entry.page < 1 || entry.page > pageCount
    || (entry.amount !== null && (!Number.isFinite(entry.amount) || entry.amount < 0
      || entry.amount * 100 > 2_147_483_647
      || Math.abs(entry.amount * 100 - Math.round(entry.amount * 100)) > 0.00001))
    || (entry.percentage !== null && !Number.isFinite(entry.percentage))) return null;
  const financialBasis: DiscoveryEntryData["financialBasis"] = entry.amount === null ? null
    : bailCategory === "UNSECURED" ? "UNSECURED_AMOUNT"
      : /\bcash\b/i.test(entry.quote) ? "CASH_DEPOSIT"
        : /\bsurety\b/i.test(entry.quote) ? "SURETY_BOND"
          : "RECORDED_BAIL_AMOUNT";
  return {
    action: "Bail Set",
    wording: entry.quote,
    orderDate: entry.date,
    bailCategory,
    amountCents: entry.amount === null ? null : Math.round(entry.amount * 100),
    financialBasis,
    excerpt: entry.quote,
    sourcePages: [entry.page],
    originatingCourt: office || null,
    percentageCondition: entry.percentage === null ? null : `${entry.percentage}%`,
  };
}

function cachedItem(item: DiscoveryItemRow, row: BailSearchResultRow): { item: DiscoveryItemRow; entry: DiscoveryEntryData } | null {
  const consultedAt = row.sourceConsultedAt;
  if (row.sourceRetrievedAt && !Number.isFinite(row.sourceRetrievedAt.getTime())) return null;
  const originalRetrievedAt = row.sourceRetrievedAt?.toISOString() ?? null;
  if (row.evidenceAcquisition !== "CACHE" || !consultedAt || !Number.isFinite(consultedAt.getTime())
    || consultedAt.getTime() > Date.now() + 5 * 60_000
    || !/^[a-f0-9]{64}$/.test(row.sourcePdfSha256 ?? "")
    || !Number.isSafeInteger(row.sourcePageCount) || (row.sourcePageCount ?? 0) < 1 || (row.sourcePageCount ?? 101) > 100
    || !row.evidencePage || row.evidencePage < 1 || row.evidencePage > (row.sourcePageCount ?? 0)
    || typeof row.evidenceQuote !== "string" || !row.evidenceQuote.trim() || row.sourceItemId !== item.id
    || row.docketNumber !== item.docketNumber || row.sourceUrl !== item.sourceUrl
    || !safeDocketLink(row.sourceUrl, row.docketNumber)
    || !validCachedConsultationChronology(consultedAt, item.provenance.calendarRetrievedAt, row.sourceRetrievedAt)) return null;
  if (!Array.isArray(row.history) || row.history.length === 0) return null;
  const entries = row.history.map(entry => cachedEntry(entry, row.office, row.sourcePageCount!));
  if (entries.some(entry => !entry)) return null;
  const decision = selectBailDecision(row.history);
  if (decision.ambiguous || decision.decisionDate !== row.decisionDate
    || decision.classification !== row.classification
    || decision.amount !== (row.amountCents === null ? null : row.amountCents / 100)
    || decision.percentage !== (row.percentage === null ? null : Number(row.percentage))
    || decision.page !== row.evidencePage || decision.quote !== row.evidenceQuote) return null;
  const selectedIndex = row.history.findIndex(entry => entry.date === row.decisionDate
    && entry.classification === row.classification
    && entry.amount === (row.amountCents === null ? null : row.amountCents / 100)
    && entry.percentage === (row.percentage === null ? null : Number(row.percentage))
    && entry.page === row.evidencePage && entry.quote === row.evidenceQuote);
  if (selectedIndex < 0) return null;
  const provenance = {
    ...item.provenance,
    extractionOutcome: "EXTRACTED" as const,
    entries: entries as DiscoveryEntryData[],
    documentAcquisition: "CACHED_PDF" as const,
    documentSha256: row.sourcePdfSha256!,
    documentPageCount: row.sourcePageCount!,
    documentConsultedAt: consultedAt.toISOString(),
    originalDocumentRetrievedAt: originalRetrievedAt,
  };
  return {
    item: { ...item, excerpt: row.evidenceQuote, provenance },
    entry: entries[selectedIndex]!,
  };
}

export async function resultEvidence(search: BailSearchRow, row: BailSearchResultRow,
  knownDocumentRequest?: { outcome: string; durationMs: number | null } | null) {
  const id = row.sourceItemId ?? search.queue.find(item => item.docketNumber === row.docketNumber && item.hearingDate === row.hearingDate)?.itemId;
  const [item] = id ? await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id, id)) : [];
  const [documentRequest] = knownDocumentRequest !== undefined ? [knownDocumentRequest]
    : id && search.discoveryJobId ? await db.select({
    outcome: discoveryRequestsTable.outcome,
    durationMs: discoveryRequestsTable.durationMs,
  }).from(discoveryRequestsTable).where(and(
    eq(discoveryRequestsTable.jobId, search.discoveryJobId),
    eq(discoveryRequestsTable.itemId, id),
    inArray(discoveryRequestsTable.path, ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"]),
  )).orderBy(desc(discoveryRequestsTable.startedAt)).limit(1) : [];
  const [saved] = row.savedRecordId ? await db.select().from(bailRecordsTable).where(eq(bailRecordsTable.id, row.savedRecordId)) : [];
  const source = safeDocketLink(row.sourceUrl ?? item?.sourceUrl ?? null, row.docketNumber);
  let reason: string | null = null;
  let evidenceItem: DiscoveryItemRow | undefined;
  let entry: DiscoveryEntryData | undefined;
  if (row.error || row.ambiguous || ["unknown", "ambiguous"].includes(row.classification)) {
    reason = "Evidence is missing or the decision is unresolved. Check the source before saving an observation.";
  } else if (!item || source !== item.sourceUrl) {
    reason = "This result lacks matching source identity. Check the source before saving an observation.";
  } else if (row.evidenceAcquisition === "CACHE") {
    const verified = cachedItem(item, row);
    if (!verified || !candidateEligible(verified.item)) {
      reason = "Cached evidence could not be tied to a verified source, page, quote and consultation time. It cannot be shared for review.";
    } else {
      evidenceItem = verified.item;
      entry = verified.entry;
    }
  } else if (!candidateEligible(item) || row.evidenceAcquisition !== "STORED_EXTRACTION") {
    reason = "This result lacks complete source-verification or consultation metadata. Use Advanced court search or enter verified evidence by hand; no retrieval date will be invented.";
  } else {
    const decision = selectBailDecision(savedEntries(item.provenance) ?? []);
    const normalized = savedEntries(item.provenance) ?? [];
    const index = normalized.findIndex(candidate => candidate.date === row.decisionDate
      && candidate.classification === row.classification && candidate.amount === (row.amountCents === null ? null : row.amountCents / 100)
      && candidate.quote === row.evidenceQuote);
    entry = item.provenance.entries[index];
    evidenceItem = item;
    if (!entry || decision.ambiguous || decision.decisionDate !== row.decisionDate
      || decision.classification !== row.classification || decision.quote !== row.evidenceQuote
      || decision.amount !== (row.amountCents === null ? null : row.amountCents / 100)) {
      evidenceItem = undefined;
      reason = "Source evidence has changed or cannot be associated with this decision. Start a new search and check the source.";
    }
  }
  return {
    document_status: row.evidenceAcquisition === "CACHE"
      ? row.history.length ? "EXTRACTED" : "NO_BAIL_SECTION"
      : bailSearchDocumentStatus(item?.provenance.extractionOutcome, row.sourceRetrievedAt ?? item?.sourceRetrievedAt, documentRequest?.outcome),
    source_url: source,
    source_retrieved_at: (row.sourceRetrievedAt ?? item?.sourceRetrievedAt)?.toISOString() ?? null,
    source_consulted_at: (row.sourceConsultedAt ?? row.sourceRetrievedAt ?? item?.sourceRetrievedAt)?.toISOString() ?? null,
    source_pdf_sha256: row.sourcePdfSha256 ?? null,
    document_timings: {
      slot_wait_ms: item?.provenance.documentTimings?.slotWaitMs ?? null,
      retrieval_ms: documentRequest?.outcome === "OK" ? documentRequest.durationMs : null,
      extraction_ms: item?.provenance.documentTimings?.extractionMs ?? null,
      persistence_ms: item?.provenance.documentTimings?.persistenceMs ?? null,
    },
    save_available: !saved && !reason,
    save_reason: saved ? "Already shared with the workspace." : reason,
    saved_record_id: saved?.id ?? null, review_status: saved?.reviewStatus ?? null,
    item: evidenceItem, entry,
  };
}
export async function shareResult(search: BailSearchRow, row: BailSearchResultRow, ownerId: string) {
  const evidence = await resultEvidence(search, row);
  if (evidence.saved_record_id) return evidence.saved_record_id;
  if (!evidence.save_available || !evidence.item || !evidence.entry) throw new Error(evidence.save_reason ?? "This result cannot be saved.");
  const values = observationValues(ownerId, evidence.item, evidence.entry);
  return db.transaction(async tx => {
    const [created] = await tx.insert(bailRecordsTable).values(values).onConflictDoNothing({
      target: [bailRecordsTable.ownerId, bailRecordsTable.discoveryKey],
    }).returning();
    const record = created ?? (await tx.select().from(bailRecordsTable).where(and(
      eq(bailRecordsTable.ownerId, ownerId), eq(bailRecordsTable.discoveryKey, values.discoveryKey),
    )))[0]!;
    return record.id;
  });
}
