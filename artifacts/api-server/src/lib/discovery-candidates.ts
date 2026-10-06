import { createHash } from "node:crypto";
import type { DiscoveryEntryData, DiscoveryItemRow } from "@workspace/db";

export function observationKey(item: Pick<DiscoveryItemRow, "docketNumber" | "excerpt">, entry: DiscoveryEntryData | null) {
  return createHash("sha256").update(JSON.stringify({ docket: item.docketNumber, excerpt: item.excerpt, entry })).digest("hex");
}

export function candidateEligible(item: Pick<DiscoveryItemRow, "sourceRetrievedAt" | "provenance" | "excerpt" | "detail">) {
  return !!item.sourceRetrievedAt && !!(item.excerpt || item.detail)
    && (item.provenance.extractionOutcome === "MISSING_BAIL_SECTION"
      || item.provenance.extractionOutcome === "EXTRACTED" && item.provenance.entries.length > 0);
}

export function observationValues(ownerId: string, item: DiscoveryItemRow, entry: DiscoveryEntryData | null) {
  if (!candidateEligible(item)) throw new Error("Only identity-checked, source-backed evidence can be saved.");
  return {
    ownerId, caseKey: `allegheny|COMMON_PLEAS|${item.docketNumber}`, docketNumber: item.docketNumber,
    county: "Allegheny", courtLevel: "COMMON_PLEAS" as const, chargeGroup: null,
    bailCategory: entry?.bailCategory ?? "UNKNOWN" as const, financialBasis: entry?.financialBasis ?? null,
    amountCents: entry?.amountCents ?? null, orderDate: entry?.orderDate ?? null,
    sourceTitle: "Pennsylvania UJS Common Pleas docket sheet", sourceUrl: item.sourceUrl,
    sourceRetrievedAt: item.sourceRetrievedAt!, sourceObservedAt: null,
    evidenceNote: item.excerpt || item.detail!, discoveryEvidence: item.provenance,
    discoveryKey: observationKey(item, entry), discoveryItemId: item.id,
  };
}
