/** Completion describes traversal, not whether every PDF contains usable bail. */
export function completedLiveSearch(
  job: { status: string; calendarComplete: boolean; paginationComplete: boolean; resultCapReached: boolean },
  items: readonly { sourceRetrievedAt: unknown; provenance: { extractionOutcome: string } }[],
  results: readonly { error: string | null }[],
  total: number,
): { reason: string | null } | null {
  if (job.status !== "COMPLETED" || !job.calendarComplete || !job.paginationComplete
    || job.resultCapReached || results.length !== total
    || items.some(item => !item.sourceRetrievedAt || ![
      "EXTRACTED", "MISSING_BAIL_SECTION", "UNSUPPORTED_LAYOUT",
      "AMBIGUOUS_FINANCIAL_ASSOCIATION", "UNREADABLE",
    ].includes(item.provenance.extractionOutcome))) return null;
  const review = results.filter(row => row.error).length;
  return { reason: review
    ? `Search finished. ${review} result${review === 1 ? " needs" : "s need"} review. Available docket numbers and extracted bail amounts are retained.`
    : null };
}
