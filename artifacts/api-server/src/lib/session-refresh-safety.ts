type PlainRecord = Record<string, unknown>;

const expectedCriteria = {
  resultVersion: 2,
  courtOffice: "CP-05-02-Crim",
  eventType: "Formal Arraignment",
  courtRoom: "ANY",
  startDate: "2026-10-29",
  endDate: "2026-11-04",
  recordCap: 200,
  requestCap: 500,
  matchTarget: 200,
  matchFilters: {
    monetaryUpperBoundCents: null,
    monetaryLowerBoundCents: null,
    excludeShownPosted: false,
    inclusiveMaximum: true,
  },
} as const;

function isRecord(value: unknown): value is PlainRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function isExactAuthorizedSessionRefreshCriteria(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(expectedCriteria).sort();
  const actualKeys = Object.keys(value).sort();
  return stableJson(keys) === stableJson(actualKeys)
    && keys.every((key) => stableJson(value[key]) === stableJson(expectedCriteria[key as keyof typeof expectedCriteria]));
}

export function sameSavedCalendarResults(saved: readonly PlainRecord[], refreshed: readonly PlainRecord[]): boolean {
  if (!saved.length || saved.length !== refreshed.length) return false;
  return saved.every((oldRow, index) => {
    const newRow = refreshed[index];
    const provenance = isRecord(oldRow.provenance) ? oldRow.provenance : {};
    return !!newRow
      && oldRow.docketNumber === newRow.docketNumber
      && oldRow.position === newRow.position
      && oldRow.eventType === newRow.eventType
      && oldRow.eventDate === newRow.eventDate
      && oldRow.filingDate === newRow.filingDate
      && provenance.courtOffice === newRow.courtOffice
      && provenance.courtType === newRow.courtType
      && stableJson(provenance.matchingEvents ?? null) === stableJson(newRow.matchingEvents ?? null);
  });
}

export function canUseFirstPdfAccessCheck(input: {
  jobId: string;
  expectedJobId: string;
  itemId: string;
  expectedItemId: string;
  url: string;
  expectedUrl: string;
  requestPath: string;
  method: string;
  block: string | null;
  sourceBlockedReason: string | null;
  accessVerifiedAt: Date | null;
  verifiedMethod: string | null;
  pausedUntil: Date | null;
  calendarComplete: boolean;
  assessmentId: string | null;
  criteria: unknown;
  priorPdfRequests: number;
  priorSearchPosts: number;
}): boolean {
  return input.jobId === input.expectedJobId
    && input.itemId === input.expectedItemId
    && input.url === input.expectedUrl
    && ["/Report/CpDocketSheet", "/Report/MdjDocketSheet"].includes(input.requestPath)
    && input.method === "GET"
    && input.block === "ACCESS_UNVERIFIED"
    && input.sourceBlockedReason === null
    && input.accessVerifiedAt === null
    && input.verifiedMethod === null
    && input.pausedUntil === null
    && input.calendarComplete
    && input.assessmentId === null
    && isExactAuthorizedSessionRefreshCriteria(input.criteria)
    && input.priorPdfRequests === 0
    && input.priorSearchPosts === 2;
}
