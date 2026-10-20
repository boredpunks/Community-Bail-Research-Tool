import { createHash } from "node:crypto";
import type { DiscoveryEntryData, DiscoveryItemRow } from "@workspace/db";
import { allowedSourceRequest } from "./discovery-safety";
import { withoutNonmonetaryAmount } from "@workspace/bail-research";

export function observationKey(item: Pick<DiscoveryItemRow, "docketNumber" | "excerpt">, entry: DiscoveryEntryData | null) {
  // Keep legacy keys stable when additive page provenance becomes available.
  // Location metadata is evidence, not a second observation of the same entry.
  const identity = entry ? {
    action: entry.action, wording: entry.wording, orderDate: entry.orderDate,
    bailCategory: entry.bailCategory, amountCents: entry.amountCents, financialBasis: entry.financialBasis,
  } : null;
  return createHash("sha256").update(JSON.stringify({ docket: item.docketNumber, excerpt: item.excerpt, entry: identity })).digest("hex");
}

export function candidateEligible(item: Pick<DiscoveryItemRow,
  "docketNumber" | "sourceUrl" | "sourceRetrievedAt" | "provenance" | "excerpt" | "detail"
>) {
  const supportedDocket = /^(?:CP-02-CR|MJ-05\d{3}-(?:CR|NT))-\d{7}-\d{4}$/.test(item.docketNumber);
  const manual = item.provenance.documentAcquisition === "MANUAL_UPLOAD"
    && /^[a-f0-9]{64}$/.test(item.provenance.documentSha256 ?? "");
  const docketIdentityMatches = supportedDocket && (manual || (
    supportedDocket
    && allowedSourceRequest(item.sourceUrl, "GET")
    && new URL(item.sourceUrl).searchParams.get("docketNumber") === item.docketNumber));
  const calendarWasRetrieved = manual || (allowedSourceRequest(item.provenance.calendarUrl, "GET")
    && Number.isFinite(Date.parse(item.provenance.calendarRetrievedAt)));
  const documentWasRetrieved = item.sourceRetrievedAt instanceof Date
    && Number.isFinite(item.sourceRetrievedAt.getTime());
  const extracted = item.provenance.extractionOutcome === "EXTRACTED"
    && item.provenance.entries.length > 0 && !!item.excerpt;
  const verifiedMissingSection = item.provenance.extractionOutcome === "MISSING_BAIL_SECTION"
    && item.provenance.entries.length === 0 && !!item.detail;
  return docketIdentityMatches && calendarWasRetrieved && documentWasRetrieved && (extracted || verifiedMissingSection);
}

export function observationValues(ownerId: string, item: DiscoveryItemRow, entry: DiscoveryEntryData | null) {
  if (!candidateEligible(item)) throw new Error("Only identity-checked, source-backed evidence can be saved.");
  entry = entry ? withoutNonmonetaryAmount(entry) : null;
  return {
    ownerId, caseKey: `allegheny|${item.docketNumber.startsWith("MJ-") ? "MDJ" : "COMMON_PLEAS"}|${item.docketNumber}`, docketNumber: item.docketNumber,
    county: "Allegheny", courtLevel: item.docketNumber.startsWith("MJ-") ? "MDJ" as const : "COMMON_PLEAS" as const, chargeGroup: null,
    bailCategory: entry?.bailCategory ?? "UNKNOWN" as const, financialBasis: entry?.financialBasis ?? null,
    amountCents: entry?.amountCents ?? null, orderDate: entry?.orderDate ?? null,
    sourceTitle: item.provenance.documentAcquisition === "MANUAL_UPLOAD"
      ? "User-supplied PDF — local verification, not live retrieval" : "Pennsylvania UJS docket sheet", sourceUrl: item.sourceUrl,
    // Legacy schema requires a timestamp; for manual evidence this is the
    // local file receipt time, explicitly labelled by title and acquisition.
    sourceRetrievedAt: item.sourceRetrievedAt!,
    sourceObservedAt: item.provenance.documentAcquisition === "MANUAL_UPLOAD" ? item.sourceRetrievedAt! : null,
    evidenceNote: item.excerpt || item.detail!, discoveryEvidence: {
      ...item.provenance, entries: item.provenance.entries.map(withoutNonmonetaryAmount),
    },
    discoveryKey: observationKey(item, entry), discoveryItemId: item.id,
  };
}
