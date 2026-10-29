import { createHash } from "node:crypto";
import type { DiscoveryEntryData, DiscoveryItemRow } from "@workspace/db";
import { allowedSourceRequest } from "./discovery-safety";
import { withoutNonmonetaryAmount } from "@workspace/bail-research";

export function validCachedConsultationChronology(
  consultedAt: Date | null,
  calendarRetrievedAt: string,
  originalRetrievedAt: Date | null,
) {
  if (!consultedAt || !Number.isFinite(consultedAt.getTime())) return false;
  const calendarTime = Date.parse(calendarRetrievedAt);
  return Number.isFinite(calendarTime)
    && consultedAt.getTime() >= calendarTime
    && consultedAt.getTime() <= Date.now() + 5 * 60_000
    && (!originalRetrievedAt || (Number.isFinite(originalRetrievedAt.getTime())
      && consultedAt.getTime() >= originalRetrievedAt.getTime()));
}

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
  const documentWasRetrieved = item.provenance.documentAcquisition !== "CACHED_PDF"
    && item.sourceRetrievedAt instanceof Date
    && Number.isFinite(item.sourceRetrievedAt.getTime());
  const cachedDocumentIsVerified = item.provenance.documentAcquisition === "CACHED_PDF"
    && /^[a-f0-9]{64}$/.test(item.provenance.documentSha256 ?? "")
    && Number.isSafeInteger(item.provenance.documentPageCount)
    && (item.provenance.documentPageCount ?? 0) > 0 && (item.provenance.documentPageCount ?? 101) <= 100
    && Number.isFinite(Date.parse(item.provenance.documentConsultedAt ?? ""))
    && item.provenance.originalDocumentRetrievedAt === (item.sourceRetrievedAt?.toISOString() ?? null);
  const cachedConsultationFollowsCalendar = item.provenance.documentAcquisition !== "CACHED_PDF"
    || validCachedConsultationChronology(
      item.provenance.documentConsultedAt ? new Date(item.provenance.documentConsultedAt) : null,
      item.provenance.calendarRetrievedAt,
      item.provenance.originalDocumentRetrievedAt ? new Date(item.provenance.originalDocumentRetrievedAt) : null,
    );
  const extracted = item.provenance.extractionOutcome === "EXTRACTED"
    && item.provenance.entries.length > 0 && !!item.excerpt;
  const verifiedMissingSection = item.provenance.extractionOutcome === "MISSING_BAIL_SECTION"
    && item.provenance.entries.length === 0 && !!item.detail;
  return docketIdentityMatches && calendarWasRetrieved && cachedConsultationFollowsCalendar
    && (documentWasRetrieved || cachedDocumentIsVerified)
    && (extracted || verifiedMissingSection);
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
      ? "User-supplied PDF — local verification, not live retrieval"
      : item.provenance.documentAcquisition === "CACHED_PDF"
        ? item.provenance.originalDocumentRetrievedAt === null
          ? "Pennsylvania UJS docket sheet — verified local cache; original retrieval time not recorded"
          : "Pennsylvania UJS docket sheet — verified local cache"
        : "Pennsylvania UJS docket sheet", sourceUrl: item.sourceUrl,
    // The legacy record column is labelled consultation time. For cache-only
    // evidence, keep the unknown original retrieval date in discoveryEvidence.
    sourceRetrievedAt: item.provenance.documentAcquisition === "CACHED_PDF"
      ? new Date(item.provenance.documentConsultedAt!)
      : item.sourceRetrievedAt!,
    sourceObservedAt: item.provenance.documentAcquisition === "MANUAL_UPLOAD" ? item.sourceRetrievedAt! : null,
    evidenceNote: item.excerpt || item.detail!, discoveryEvidence: {
      ...item.provenance, entries: item.provenance.entries.map(withoutNonmonetaryAmount),
    },
    discoveryKey: observationKey(item, entry), discoveryItemId: item.id,
  };
}
