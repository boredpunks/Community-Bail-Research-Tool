// This identifies the actual clients, not just the source domain. Changing
// either retrieval method invalidates prior proof and requires fresh approval.
export const integratedSourceMethod = "playwright-calendar+urllib-pdf-v1";
export const resultRetentionMs = 24 * 60 * 60 * 1000;

type SourceState = {
  blockedReason: string | null;
  pausedUntil: Date | null;
  accessVerifiedAt: Date | null;
  verifiedMethod: string | null;
  collectionApprovedAt: Date | null;
};

export function collectionBlock(source: SourceState | undefined, now = new Date()): string | null {
  // Only a rate-limit cooldown expires automatically. Denials, challenges and
  // uncertain in-flight requests always require an operator's assessment.
  if (source?.blockedReason && !(source.blockedReason === "RATE_LIMIT"
    && source.pausedUntil && source.pausedUntil <= now)) return source.blockedReason;
  if (source?.pausedUntil && source.pausedUntil > now) return source.blockedReason ?? "SOURCE_COOLDOWN";
  if (!source?.accessVerifiedAt || source.verifiedMethod !== integratedSourceMethod) return "ACCESS_UNVERIFIED";
  if (!source.collectionApprovedAt || source.collectionApprovedAt < source.accessVerifiedAt) return "COLLECTION_NOT_APPROVED";
  return null;
}

export function resultsDeadline(job: { status: string; updatedAt: Date }): Date | null {
  return ["RUNNING", "QUEUED"].includes(job.status) ? null : new Date(job.updatedAt.getTime() + resultRetentionMs);
}
