import type { BailRecordRow } from "@workspace/db";

export function serializeBailRecord(record: BailRecordRow) {
  return {
    id: record.id,
    docketNumber: record.docketNumber,
    county: record.county,
    courtLevel: record.courtLevel,
    chargeGroup: record.chargeGroup,
    bailCategory: record.bailCategory,
    financialBasis: record.financialBasis,
    amountCents: record.amountCents,
    orderDate: record.orderDate,
    sourceTitle: record.sourceTitle,
    sourceUrl: record.sourceUrl,
    sourceRetrievedAt: record.sourceRetrievedAt.toISOString(),
    sourceObservedAt: record.sourceObservedAt?.toISOString() ?? null,
    evidenceNote: record.evidenceNote,
    discoveryEvidence: record.discoveryEvidence,
    reviewStatus: record.reviewStatus,
    orderInterpretation: record.orderInterpretation,
    reviewComment: record.reviewComment,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function descriptiveRange(amounts: number[]) {
  const sorted = [...amounts].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0
    ? null
    : sorted.length % 2 === 1
      ? sorted[middle]!
      : Math.floor((sorted[middle - 1]! + sorted[middle]! + 1) / 2);
  return {
    minimumCents: sorted[0] ?? null,
    medianCents: median,
    maximumCents: sorted[sorted.length - 1] ?? null,
  };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
