import { validAccountingMessage } from "./discovery-safety";

interface DenialEvidence {
  status: number;
  mediaType: string;
  byteCount: number;
  contentLength?: number;
  headers: Record<string, string>;
  excerpt?: string;
}
export interface SourceResponse extends Record<string, unknown> {
  kind: "response";
  requestId: string;
  status: number | null;
  outcome: string;
  retryAfter: string | null;
  denialEvidence?: DenialEvidence;
  linkCaptureToGetSeconds?: number | null;
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const dateHeader = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const product = "(?:nginx|cloudflare|envoy|Apache|Microsoft-IIS|Varnish|ATS|awselb)(?:/\\d+(?:\\.\\d+){0,3})?";
const phrases = "Unauthorized request|Access denied|Too many requests|Forbidden|Rate limit exceeded|Authentication required|Please try again later";

function safeHeader(key: string, v: unknown): boolean {
  if (typeof v !== "string" || v.length > 200) return false;
  if (v === "[redacted]") return true;
  if (key === "date") return dateHeader.test(v);
  if (key === "retry-after") return /^\d{1,10}$/.test(v) || dateHeader.test(v);
  if (key === "server") return new RegExp(`^${product}$`, "i").test(v);
  if (key === "via") return new RegExp(`^\\d(?:\\.\\d)? ${product}$`, "i").test(v);
  return key === "www-authenticate" && ["Basic", "Bearer", "Digest", "Negotiate"].includes(v);
}

export function validDenialEvidence(v: unknown): v is DenialEvidence {
  if (!object(v) || !keys(v, ["status", "mediaType", "byteCount", "contentLength", "headers", "excerpt"])
    || ![401, 403, 429].includes(Number(v.status)) || typeof v.status !== "number"
    || typeof v.mediaType !== "string"
    || !["text/plain", "text/html", "application/pdf", "application/json", "application/octet-stream", "other"].includes(v.mediaType)
    || !count(v.byteCount) || Number(v.byteCount) > 4_000_001
    || "contentLength" in v && !count(v.contentLength)
    || !object(v.headers) || !keys(v.headers, ["server", "via", "retry-after", "www-authenticate", "date"])
    || !Object.entries(v.headers).every(([k, value]) => safeHeader(k, value))) return false;
  if ("excerpt" in v) {
    if (!["text/plain", "text/html"].includes(String(v.mediaType))
      || typeof v.excerpt !== "string" || v.excerpt.length > 200
      || !(v.excerpt === "[redacted]" || new RegExp(`^(?:${phrases})(?: (?:${phrases}))*$`).test(v.excerpt))) return false;
  }
  return true;
}

/** Closed parent wire contract. Never coerce, strip unknown keys, or log input. */
export function validSourceResponse(v: unknown): v is SourceResponse {
  return object(v) && keys(v, ["kind", "requestId", "status", "outcome", "retryAfter",
    "denialEvidence", "linkCaptureToGetSeconds"])
    && v.kind === "response" && validAccountingMessage(v)
    && (v.retryAfter === null || typeof v.retryAfter === "string" && v.retryAfter.length <= 200)
    && (!("denialEvidence" in v) || validDenialEvidence(v.denialEvidence) && v.denialEvidence.status === v.status)
    && (!("linkCaptureToGetSeconds" in v) || v.linkCaptureToGetSeconds === null
      || typeof v.linkCaptureToGetSeconds === "number" && Number.isFinite(v.linkCaptureToGetSeconds)
        && v.linkCaptureToGetSeconds >= 0);
}

/** Only sanitized evidence and authoritative persisted duration enter events. */
export function sourceResponseEvents(message: SourceResponse, durationMs: number | null) {
  if (!validSourceResponse(message) || durationMs !== null && (!count(durationMs) || durationMs > 2_147_483_647))
    throw new Error("Invalid source response metadata");
  return [
    {kind: "SOURCE_REQUEST_TIMING", message: JSON.stringify({
      requestId: message.requestId, durationMs,
      ...("linkCaptureToGetSeconds" in message ? {linkCaptureToGetSeconds: message.linkCaptureToGetSeconds} : {}),
    })},
    ...(message.denialEvidence ? [{kind: "DOCUMENT_DENIAL", message: JSON.stringify(message.denialEvidence)}] : []),
  ];
}
