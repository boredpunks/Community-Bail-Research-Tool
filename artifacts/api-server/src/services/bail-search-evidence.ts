import { and, eq } from "drizzle-orm";
import { db, discoveryItemsTable, bailRecordsTable, type BailSearchRow, type BailSearchResultRow } from "@workspace/db";
import { candidateEligible, observationValues } from "../lib/discovery-candidates";
import { allowedSourceRequest } from "../lib/discovery-safety";
import { savedEntries } from "./saved-bail-extraction";
import { selectBailDecision } from "../lib/bail-decision";

/** A source link alone is not sufficient proof to publish a monetary observation. */
export function safeDocketLink(url: string | null, docket: string) {
  try {
    return url && allowedSourceRequest(url, "GET") && new URL(url).searchParams.get("docketNumber") === docket ? url : null;
  } catch { return null; }
}
export async function resultEvidence(search: BailSearchRow, row: BailSearchResultRow) {
  const id = row.sourceItemId ?? search.queue.find(item => item.docketNumber === row.docketNumber && item.hearingDate === row.hearingDate)?.itemId;
  const [item] = id ? await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.id, id)) : [];
  const [saved] = row.savedRecordId ? await db.select().from(bailRecordsTable).where(eq(bailRecordsTable.id, row.savedRecordId)) : [];
  const source = safeDocketLink(row.sourceUrl ?? item?.sourceUrl ?? null, row.docketNumber);
  let reason: string | null = null;
  let entry: NonNullable<typeof item>["provenance"]["entries"][number] | undefined;
  if (row.error || row.ambiguous || ["unknown", "ambiguous"].includes(row.classification)) {
    reason = "Evidence is missing or the decision is unresolved. Check the source before saving an observation.";
  } else if (!item || !candidateEligible(item) || row.evidenceAcquisition !== "STORED_EXTRACTION") {
    reason = "This result lacks complete source-verification or original consultation metadata. Use Advanced court search or enter verified evidence by hand; no retrieval date will be invented.";
  } else {
    const decision = selectBailDecision(savedEntries(item.provenance) ?? []);
    const normalized = savedEntries(item.provenance) ?? [];
    const index = normalized.findIndex(candidate => candidate.date === row.decisionDate
      && candidate.classification === row.classification && candidate.amount === (row.amountCents === null ? null : row.amountCents / 100)
      && candidate.quote === row.evidenceQuote);
    entry = item.provenance.entries[index];
    if (!entry || decision.ambiguous || decision.decisionDate !== row.decisionDate
      || decision.classification !== row.classification || decision.quote !== row.evidenceQuote
      || decision.amount !== (row.amountCents === null ? null : row.amountCents / 100)) {
      reason = "Source evidence has changed or cannot be associated with this decision. Start a new search and check the source.";
    }
  }
  return {
    source_url: source,
    source_retrieved_at: (row.sourceRetrievedAt ?? item?.sourceRetrievedAt)?.toISOString() ?? null,
    save_available: !saved && !reason,
    save_reason: saved ? "Already shared with the workspace." : reason,
    saved_record_id: saved?.id ?? null, review_status: saved?.reviewStatus ?? null,
    item, entry,
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
