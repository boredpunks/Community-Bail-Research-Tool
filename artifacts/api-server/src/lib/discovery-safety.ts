// This identifies the actual clients, not just the source domain. Changing
// either retrieval method invalidates prior proof and requires fresh approval.
import { validCalendarCriteria } from "./calendar-criteria";

export const integratedSourceMethod = "playwright-calendar+urllib-pdf-v10";
export const calendarPreviewMethod = "playwright-calendar-preview-v5";
export const resultRetentionMs = 24 * 60 * 60 * 1000;
export const calendarAuditHeaders = [
  "Docket Number", "Court Type", "Filing Date", "County", "Court Office", "Event Type",
] as const;

export function validCalendarAuditHeaders(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length === calendarAuditHeaders.length
    && value.every((label, index) => label === calendarAuditHeaders[index]);
}

type SourceState = {
  blockedReason: string | null;
  pausedUntil: Date | null;
  accessVerifiedAt: Date | null;
  verifiedMethod: string | null;
  collectionApprovedAt: Date | null;
};

export function isCalendarPreviewCriteria(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  // Historical reports keep their exact old shape. This is not a freshness
  // check: admission/approval/run/scheduler separately reject stale dates.
  const legacy = candidate.eventType === "ANY";
  const keys = ["courtOffice", "eventType", "calendarPreviewOnly", "startDate", "endDate", "recordCap", "requestCap"];
  if (legacy) keys.push("courtRoom");
  return Object.keys(candidate).length === keys.length && keys.every(key => key in candidate)
    && candidate.calendarPreviewOnly === true && candidate.recordCap === 1 && candidate.requestCap === 8
    && (legacy
      ? candidate.courtOffice === "CP-05-02-Crim" && candidate.courtRoom === "Courtroom 506"
        && candidate.startDate === "2026-10-15" && candidate.endDate === "2026-10-15"
      : validCalendarCriteria(candidate));
}

export function calendarPreviewSourceAllowed(source: {
  blockedReason: string | null;
  pausedUntil: Date | null;
  accessVerifiedAt: Date | null;
  verifiedMethod: string | null;
  collectionApprovedAt: Date | null;
  latencyWarning?: string | null;
  activeRequestId?: string | null;
}, now = new Date(), allowInFlightWait = false): boolean {
  return source.blockedReason === "SOURCE_VALIDATION_BARRIER"
    && (!source.activeRequestId || allowInFlightWait)
    && (!source.pausedUntil || source.pausedUntil <= now)
    && !source.accessVerifiedAt
    && !source.verifiedMethod
    && !source.collectionApprovedAt
    && !source.latencyWarning;
}

export function calendarPreviewRequestAllowed(path: unknown, method: unknown): boolean {
  if (path === "/CaseSearch") return method === "GET" || method === "POST";
  return method === "GET"
    && (path === "/resource/js/sitemain.min.js" || path === "/resource/css/sitemain.min.css");
}

export const sourceOutcomes = [
  "OK", "RATE_LIMIT", "ACCESS_DENIED", "CHALLENGE", "LOGIN_PROMPT", "REDIRECT", "HTTP_ERROR",
  "SIZE_LIMIT", "UNSUPPORTED_RESPONSE", "NETWORK_ERROR", "TIMEOUT", "INVALID_PDF",
  "UNCERTAIN_AFTER_RESTART", "UNCERTAIN_AFTER_WORKER", "UNCERTAIN_AFTER_ASSESSMENT",
] as const;

export function validAccountingMessage(message: Record<string, unknown>) {
  if (typeof message.requestId !== "string" || !/^[\da-f-]{36}$/i.test(message.requestId)
    || !sourceOutcomes.includes(message.outcome as typeof sourceOutcomes[number])) return false;
  const status = message.status, outcome = String(message.outcome);
  if (["NETWORK_ERROR", "TIMEOUT"].includes(outcome) || outcome.startsWith("UNCERTAIN_")) return status === null;
  if (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599) return false;
  if (["SIZE_LIMIT", "UNSUPPORTED_RESPONSE"].includes(outcome)) return true;
  if (outcome === "RATE_LIMIT") return status === 200 || status === 429;
  if (outcome === "ACCESS_DENIED") return [200, 401, 403].includes(Number(status));
  if (outcome === "LOGIN_PROMPT") return status === 200;
  if (outcome === "REDIRECT") return Number(status) >= 300 && Number(status) < 400;
  if (outcome === "HTTP_ERROR") return status !== 200;
  return status === 200;
}

// Numerical predicates can be checked offline without inventing case evidence.
export function qualifyingMonetaryTotal(category: string, basis: string | null, cents: number | null, maximum: number, inclusive: boolean) {
  return category === "MONETARY" && basis === "TOTAL_BAIL" && cents !== null
    && Number.isSafeInteger(cents) && cents >= 0 && (inclusive ? cents <= maximum : cents < maximum);
}

export function rollingUsage(starts: Date[], now: Date, hourlyCap: number, dailyCap: number) {
  const inDay = starts.filter((at) => at.getTime() > now.getTime() - 86_400_000).sort((a, b) => a.getTime() - b.getTime());
  const inHour = inDay.filter((at) => at.getTime() > now.getTime() - 3_600_000);
  const hourRelease = inHour.length >= hourlyCap ? inHour[inHour.length - hourlyCap]!.getTime() + 3_600_000 : 0;
  const dayRelease = inDay.length >= dailyCap ? inDay[inDay.length - dailyCap]!.getTime() + 86_400_000 : 0;
  return {
    hourlyUsed: inHour.length, dailyUsed: inDay.length,
    blockedReason: dayRelease ? "DAILY_REQUEST_LIMIT" : hourRelease ? "HOURLY_REQUEST_LIMIT" : null,
    nextEligibleAt: Math.max(hourRelease, dayRelease) ? new Date(Math.max(hourRelease, dayRelease)) : null,
  };
}

export function paceEligibleAt(source: { lastRequestAt: Date | null; lastCompletedAt: Date | null; adaptiveSpacingMs: number }, baseSpacingMs: number) {
  const anchor = Math.max(source.lastRequestAt?.getTime() ?? 0, source.lastCompletedAt?.getTime() ?? 0);
  return anchor ? new Date(anchor + Math.max(baseSpacingMs, source.adaptiveSpacingMs)) : null;
}

export function throttleDeadline(now: Date, minimumMs: number, previousThrottles: number, retryAfter: unknown) {
  let deadline = now.getTime() + Math.min(86_400_000, minimumMs * 2 ** Math.min(previousThrottles, 6));
  if (typeof retryAfter === "string") {
    const value = retryAfter.trim();
    const at = /^\d+$/.test(value) ? Math.min(8_640_000_000_000_000, now.getTime() + Number(value) * 1000) : Date.parse(value);
    if (Number.isFinite(at)) deadline = Math.max(deadline, at);
  }
  return new Date(deadline);
}

export function responseHealth(source: { adaptiveSpacingMs: number; slowResponseStreak: number }, durationMs: number, recentOkDurations: number[], baseMs: number) {
  // Do not let a run of already-slow responses become the new "healthy"
  // baseline and silently suppress deterioration detection.
  const ordered = recentOkDurations.filter((ms) => ms >= 0 && ms < 20_000).sort((a, b) => a - b);
  const baseline = ordered[Math.floor(ordered.length / 2)] ?? 10_000;
  const slow = durationMs >= Math.max(20_000, baseline * 2);
  const streak = slow ? source.slowResponseStreak + 1 : 0;
  const spacing = Math.max(baseMs, source.adaptiveSpacingMs);
  return {
    slowResponseStreak: streak,
    adaptiveSpacingMs: streak === 3 || streak === 6 ? Math.min(3_600_000, spacing * 2) : spacing,
    latencyWarning: slow ? `Slow response ${streak}; conservative pacing retained. ${streak >= 6 ? "Collection paused for assessment." : "No automatic acceleration."}` : null,
    blockedReason: streak >= 6 ? "RESPONSE_DETERIORATION" : null,
  };
}

export function allowedSourceRequest(raw: unknown, method: unknown) {
  if (typeof raw !== "string" || !["GET", "POST"].includes(String(method))) return false;
  try {
    const url = new URL(raw);
    if (url.origin !== "https://ujsportal.pacourts.us" || url.username || url.password || url.hash) return false;
    if (url.pathname === "/CaseSearch") return !url.search;
    if (["/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css"].includes(url.pathname)) {
      if (method !== "GET") return false;
      if (!url.search) return true;
      const entries = [...url.searchParams.entries()];
      const version = entries[0]?.[1] ?? "";
      return url.search.length <= 257 && !url.search.includes("&") && entries.length === 1 && entries[0]![0] === "v"
        && version.length >= 16 && version.length <= 128 && !/[^A-Za-z0-9_-]/.test(version);
    }
    if (url.pathname !== "/Report/CpDocketSheet" || method !== "GET") return false;
    return url.searchParams.getAll("docketNumber").length === 1
      && /^CP-02-CR-\d{7}-\d{4}$/.test(url.searchParams.get("docketNumber") ?? "")
      && url.searchParams.getAll("dnh").length <= 1
      && [...url.searchParams.keys()].every((key) => ["docketNumber", "dnh"].includes(key));
  } catch { return false; }
}

export function validCalendarDiagnostics(message: Record<string, unknown>) {
  return ["READY", "RESULT"].includes(String(message.phase))
    // Historical v8 diagnostics predate cache/network counters and remain readable.
    && ["networkRequests", "cachedResponses"].every(key => message[key] === undefined
      || Number.isSafeInteger(message[key]) && Number(message[key]) >= 0 && Number(message[key]) <= 10_000)
    && ["blockedScripts", "blockedStylesheets", "blockedRequests", "pageErrors", "consoleErrors", "optionalConsoleErrors"].every(
      (key) => Number.isSafeInteger(message[key]) && Number(message[key]) >= 0 && Number(message[key]) <= 10_000)
    && typeof message.scriptLoaded === "boolean" && typeof message.stylesheetLoaded === "boolean";
}

export function validCalendarFormDiagnostic(message: Record<string, unknown>) {
  const reasons = message.code === "CALENDAR_CONTROL_STATE_MISMATCH"
    ? ["MISSING", "WRONG_FORM", "DISABLED", "UNNAMED", "VALUE_MISMATCH",
      "BACKING_CONTROL_MISSING", "BACKING_CONTROL_AMBIGUOUS", "BACKING_VALUE_MISMATCH",
      "OPTION_MISSING", "OPTION_AMBIGUOUS", "OPTION_DISABLED",
      "CONTROL_AMBIGUOUS", "NO_FILTER_NOT_SELECTED", "HIDDEN"]
    : message.code === "CALENDAR_SUBMITTED_VALUES_MISMATCH"
    ? ["SUBMITTED_COUNT_MISMATCH", "SUBMITTED_VALUE_MISMATCH"]
    : message.code === "CALENDAR_FORM_MISSING"
    ? ["MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM"]
    : message.code === "CALENDAR_FORM_INITIALIZATION_TIMEOUT"
    ? ["MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM", "DISABLED", "HIDDEN"]
    : message.code === "CALENDAR_FORM_STRUCTURE_CHANGED"
    ? ["MISSING", "EMPTY", "FIELD_LIMIT", "FIELD_NAME_LIMIT"]
    : message.code === "CRITERIA_NOT_AVAILABLE_ON_SOURCE"
    ? ["OPTION_MISSING", "OPTION_DISABLED", "OUTSIDE_SOURCE_RANGE"] : [];
  return Object.keys(message).every((key) => ["kind", "code", "control", "reason", "phase"].includes(key))
    && (message.kind === undefined || message.kind === "calendar_form_diagnostic")
    && (message.phase === undefined || ["INITIALIZATION", "CONTROL_SELECTION", "DATE_ENTRY", "FINAL_VALIDATION", "SUBMISSION"].includes(String(message.phase)))
    && ["SEARCH_BUTTON", "FORM", "SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "COURT_ROOM", "START_DATE", "END_DATE", "EVENT_TYPE"].includes(String(message.control))
    && reasons.includes(String(message.reason));
}

export function calendarDiagnosticRejection(message: unknown): string | null {
  if (message === "Invalid public form diagnostic") return "PARENT_REJECTED_CALENDAR_FORM_DIAGNOSTIC";
  if (message === "Invalid calendar diagnostics") return "PARENT_REJECTED_CALENDAR_DIAGNOSTIC";
  if (message === "Invalid calendar state evidence") return "PARENT_REJECTED_CALENDAR_STATE";
  return null;
}

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
