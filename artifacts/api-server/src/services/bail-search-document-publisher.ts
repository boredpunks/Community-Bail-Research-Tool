import { and, eq } from "drizzle-orm";
import {
  db, bailSearchesTable, bailSearchResultsTable, discoveryItemsTable,
  type BailSearchRow, type BailSearchQueueItem,
} from "@workspace/db";
import { selectBailDecision, qualifiesMonetary } from "../lib/bail-decision";
import { extractSavedBail, savedEntries } from "./saved-bail-extraction";
import { resultDatesForItem } from "./bail-search-projection";

type ProjectionStore = Pick<typeof db, "select" | "insert" | "update">;

export async function storeItem(
  search: BailSearchRow,
  queued: BailSearchQueueItem,
  cacheAllowed: boolean,
  store: ProjectionStore = db,
) {
  const [item] = await store.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id, queued.itemId));
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
  await store.insert(bailSearchResultsTable).values(values).onConflictDoUpdate({
    target: [bailSearchResultsTable.searchId, bailSearchResultsTable.docketNumber, bailSearchResultsTable.hearingDate],
    set: values,
  });
}

/**
 * Reflect one identity-checked, extracted PDF in each linked live-search result.
 * The optional transaction store keeps projection and verification atomic.
 */
export async function publishVerifiedDocumentToSearch(
  jobId: string,
  itemId: string,
  store: ProjectionStore = db,
) {
  const linkedSearches = await store.select().from(bailSearchesTable)
    .where(eq(bailSearchesTable.discoveryJobId, jobId));
  const [item] = await store.select().from(discoveryItemsTable).where(and(
    eq(discoveryItemsTable.id, itemId), eq(discoveryItemsTable.jobId, jobId),
  ));
  if (!item || !item.sourceRetrievedAt || !item.provenance.documentSha256
    || !["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)) return;

  const allItems = await store.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, jobId));
  for (const search of linkedSearches) {
    if (search.criteria.source !== "live") continue;
    const matching = resultDatesForItem(search.criteria, item)
      .filter(date => search.criteria.courtOffice === undefined || search.criteria.courtOffice === "ANY"
        || item.provenance.courtOffice === search.criteria.courtOffice);
    for (const hearingDate of matching) {
      await storeItem(search, {
        itemId: item.id, docketNumber: item.docketNumber, hearingDate, office: item.provenance.courtOffice,
      }, false, store);
    }
    const total = allItems.reduce((count, row) => count + resultDatesForItem(search.criteria, row)
      .filter(date => search.criteria.courtOffice === undefined || search.criteria.courtOffice === "ANY"
        || row.provenance.courtOffice === search.criteria.courtOffice).length, 0);
    const results = await store.select().from(bailSearchResultsTable)
      .where(eq(bailSearchResultsTable.searchId, search.id));
    await store.update(bailSearchesTable).set({
      total,
      processed: results.filter(row => !row.error).length,
      updatedAt: new Date(),
    }).where(eq(bailSearchesTable.id, search.id));
  }
}
