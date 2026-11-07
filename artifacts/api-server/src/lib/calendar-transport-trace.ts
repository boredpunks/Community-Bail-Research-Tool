import { validAccountingMessage } from "./discovery-safety";

const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => key in value);
const integer = (value: unknown, max = 2_147_483_647) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const dateHeader = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const product = "(?:nginx|cloudflare|envoy|Apache|Microsoft-IIS|Varnish|ATS|awselb)(?:/\\d+(?:\\.\\d+){0,3})?";
const failureClasses = [
  "UNKNOWN", "NET_FAILED", "NET_ABORTED", "NET_BLOCKED_CLIENT", "DNS", "CONNECT", "TIMEOUT", "OTHER",
];

/** Closed, privacy-safe worker event. No raw headers, URLs, request data or source text. */
export function validCalendarTransportTrace(value: Record<string, unknown>): boolean {
  const headerKeys = ["mediaType", "contentLength", "contentEncoding", "date", "server", "via", "retryAfter"];
  const stageKeys = ["grantToRequestMs", "requestToHeadersMs", "headersToNetworkEndMs", "grantToTerminalMs"];
  if (!keys(value, [
    "kind", "requestId", "version", "outcome", "timer", "statusCode", "responseHeaders",
    "networkCompletion", "networkFailureClass", "browserFailureClass", "stages",
  ]) || value.kind !== "calendar_transport_trace" || value.version !== 1
    || !validAccountingMessage({requestId: value.requestId, status: value.statusCode, outcome: value.outcome})
    || !["NONE", "CALENDAR_STREAM_180S", "CALENDAR_HANDLING_ACK_50S",
      "SEARCH_ACTION_TIMEOUT", "WORKER_TIMEOUT"].includes(String(value.timer))
    || value.outcome === "TIMEOUT" && value.timer === "NONE"
    || value.outcome !== "TIMEOUT" && value.timer !== "NONE"
    || !["NOT_OBSERVED", "COMPLETED", "FAILED"].includes(String(value.networkCompletion))
    || !failureClasses.includes(String(value.networkFailureClass))
    || !["NOT_OBSERVED", ...failureClasses].includes(String(value.browserFailureClass))) return false;

  const headers = value.responseHeaders;
  if (headers === null || typeof headers !== "object" || Array.isArray(headers)
    || !keys(headers as Record<string, unknown>, headerKeys)) return false;
  const safeHeaders = headers as Record<string, unknown>;
  if (!["HTML", "JSON", "PDF", "TEXT", "BINARY", "OTHER", "MISSING"].includes(String(safeHeaders.mediaType))
    || safeHeaders.contentLength !== null && !integer(safeHeaders.contentLength)
    || !["identity", "gzip", "br", "deflate", "OTHER"].includes(String(safeHeaders.contentEncoding))
    || safeHeaders.date !== null && (typeof safeHeaders.date !== "string" || !dateHeader.test(safeHeaders.date))
    || safeHeaders.server !== null && (typeof safeHeaders.server !== "string"
      || !new RegExp(`^${product}$`, "i").test(safeHeaders.server))
    || safeHeaders.via !== null && (typeof safeHeaders.via !== "string"
      || !new RegExp(`^\\d(?:\\.\\d)? ${product}$`, "i").test(safeHeaders.via))
    || safeHeaders.retryAfter !== null && (typeof safeHeaders.retryAfter !== "string"
      || !(/^\d{1,10}$/.test(safeHeaders.retryAfter) || dateHeader.test(safeHeaders.retryAfter)))) return false;

  const stages = value.stages;
  if (stages === null || typeof stages !== "object" || Array.isArray(stages)
    || !keys(stages as Record<string, unknown>, stageKeys)
    || !Object.values(stages as Record<string, unknown>).every(
      elapsed => elapsed === null || integer(elapsed, 600_000))) return false;
  return true;
}
