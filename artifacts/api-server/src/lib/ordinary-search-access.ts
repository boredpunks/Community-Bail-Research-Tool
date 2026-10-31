type PlainRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PlainRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function canUseOrdinarySearchFirstPdfAccessCheck(input: {
  jobId: string;
  expectedJobId: string;
  itemId: string;
  expectedItemId: string;
  docketNumber: string;
  expectedDocketNumber: string;
  url: string;
  expectedUrl: string;
  requestPath: string;
  method: string;
  block: string | null;
  sourceBlockedReason: string | null;
  accessVerifiedAt: Date | null;
  verifiedMethod: string | null;
  pausedUntil: Date | null;
  activeRequestId: string | null;
  jobStatus: string;
  calendarComplete: boolean;
  assessmentId: string | null;
  criteria: unknown;
  liveSearchLinked: boolean;
  firstPendingItem: boolean;
  supportedCourtType: boolean;
  priorPdfRequests: number;
  priorSearchPosts: number;
}): boolean {
  const criteria = isRecord(input.criteria) ? input.criteria : null;
  // Latency warnings are advisory; hard stops are represented by the source
  // block, cooldown, or active-request fields checked below.
  return input.jobId === input.expectedJobId
    && input.itemId === input.expectedItemId
    && input.docketNumber === input.expectedDocketNumber
    && input.url === input.expectedUrl
    && ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"].includes(input.requestPath)
    && input.method === "GET"
    && input.block === "ACCESS_UNVERIFIED"
    && (input.sourceBlockedReason === null || input.sourceBlockedReason === "SOURCE_VALIDATION_BARRIER")
    && input.accessVerifiedAt === null
    && input.verifiedMethod === null
    && input.pausedUntil === null
    && input.activeRequestId === null
    && input.jobStatus === "RUNNING"
    && input.calendarComplete
    && input.assessmentId === null
    && criteria?.resultVersion === 2
    && criteria.calendarPreviewOnly !== true
    && input.liveSearchLinked
    && input.firstPendingItem
    && input.supportedCourtType
    && input.priorPdfRequests === 0
    && input.priorSearchPosts === 1;
}
