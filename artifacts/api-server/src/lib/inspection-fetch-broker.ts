import { Resolver } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

export const INSPECTION_BROKER_ORIGIN = "https://ujsportal.pacourts.us";
export const INSPECTION_BROKER_MAX_BYTES = 4_000_000;
export const INSPECTION_BROKER_TIMEOUT_MS = 45_000;
const INSPECTION_SESSION_MS = 10 * 60_000;
const MAX_REQUEST_HEADERS_BYTES = 32_768;
const MAX_RESPONSE_HEADERS_BYTES = 32_768;
const ASSET_PATHS = new Set([
  "/resource/js/sitemain.min.js",
  "/resource/css/sitemain.min.css",
]);

type ResourceType = "document" | "script" | "stylesheet";
type HeaderPairs = Array<[string, string]>;

type TransportResponse = {
  status: number;
  rawHeaders: string[];
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
  close(): void;
  trailers?(): string[];
};

type BrokerRequest = {
  path: string;
  url: URL;
  resourceType: ResourceType;
  headers: Record<string, string>;
};

type Authorization = {
  allow: boolean;
  requestId?: string;
  reason?: string;
};

type BrokerReply =
  | { allow: false; reason: string }
  | {
      allow: true;
      requestId: string;
      status: number;
      headers: HeaderPairs;
      body: string;
    }
  | {
      allow: true;
      requestId: string;
      brokerOutcome: "SIZE_LIMIT" | "UNSUPPORTED_RESPONSE";
      status: number;
      retryAfter: string | null;
    }
  | {
      allow: true;
      requestId: string;
      transportError: "TIMEOUT" | "NETWORK_ERROR";
      status: null;
      retryAfter: null;
    };

type AuthorizeRequest = (
  path: string,
  method: "GET",
  url: string,
) => Promise<Authorization>;
type Transport = (
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
) => Promise<TransportResponse>;

export class BrokerTimeoutError extends Error {}
class BrokerSizeLimitError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super("INSPECTION_RESPONSE_TOO_LARGE");
  }
}
class UnsupportedResponseError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super("INSPECTION_RESPONSE_UNSUPPORTED");
  }
}

export function isPublicIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const value = (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!);
  const blocked: Array<[number, number]> = [
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
    [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
    [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
    [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
  ];
  return !blocked.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

async function resolvePinnedPublicIpv4(host: string, timeoutMs: number): Promise<string> {
  const resolver = new Resolver({ timeout: Math.max(1, timeoutMs), tries: 1 });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolver.cancel();
      reject(new BrokerTimeoutError("INSPECTION_FETCH_TIMEOUT"));
    }, timeoutMs);
    resolver.resolve4(host, (error, addresses) => {
      clearTimeout(timer);
      if (error || !addresses?.length) {
        reject(error ?? new Error("INSPECTION_DNS_FAILED"));
        return;
      }
      if (addresses.some((address) => !isPublicIpv4(address))) {
        reject(new Error("INSPECTION_DESTINATION_NOT_PUBLIC"));
        return;
      }
      resolve(addresses[0]!);
    });
  });
}

function openHttpsResponse(
  url: URL,
  address: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const request = httpsRequest({
      hostname: address,
      port: 443,
      servername: url.hostname,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: url.hostname, "accept-encoding": "identity" },
      agent: false,
      maxHeaderSize: MAX_RESPONSE_HEADERS_BYTES,
      rejectUnauthorized: true,
    }, (response: IncomingMessage) => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      resolve({
        status: response.statusCode ?? 0,
        rawHeaders: response.rawHeaders,
        body: (async function* () {
          try {
            for await (const chunk of response) yield chunk as Buffer;
          } catch (error) {
            if (timedOut) throw new BrokerTimeoutError("INSPECTION_FETCH_TIMEOUT");
            throw error;
          }
        })(),
        cancel: () => request.destroy(),
        close: () => clearTimeout(timer),
        trailers: () => response.rawTrailers,
      });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      request.destroy(new BrokerTimeoutError("INSPECTION_FETCH_TIMEOUT"));
    }, timeoutMs);
    request.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new UnsupportedResponseError(response.statusCode ?? 101, null));
      }
    });
    request.end();
  });
}

async function defaultTransport(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<TransportResponse> {
  const deadline = performance.now() + timeoutMs;
  const address = await resolvePinnedPublicIpv4(url.hostname, timeoutMs);
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new BrokerTimeoutError("INSPECTION_FETCH_TIMEOUT");
  return openHttpsResponse(url, address, headers, remaining);
}

function valuesFor(headers: HeaderPairs, name: string): string[] {
  return headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

function queryVersion(url: URL): string | null {
  if (!url.search) return "";
  if (url.search.length > 257 || url.search.includes("&")) return null;
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0]![0] !== "v"
    || !/^[A-Za-z0-9_-]{16,128}$/.test(entries[0]![1])) return null;
  return entries[0]![1];
}

function readTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index++) {
    const char = html[index]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

function parseStartTag(html: string, start: number, end: number): {
  tag: string;
  attributes: Map<string, string>;
} | null {
  let index = start + 1;
  const nameStart = index;
  while (index < end && /[A-Za-z0-9:-]/.test(html[index]!)) index++;
  if (index === nameStart) return null;
  const tag = html.slice(nameStart, index).toLowerCase();
  const attributes = new Map<string, string>();
  while (index < end) {
    while (index < end && (/\s/.test(html[index]!) || html[index] === "/")) index++;
    if (index >= end) break;
    const attrStart = index;
    while (index < end && !/[\s=/>]/.test(html[index]!)) index++;
    if (index === attrStart) {
      index++;
      continue;
    }
    const name = html.slice(attrStart, index).toLowerCase();
    while (index < end && /\s/.test(html[index]!)) index++;
    let value = "";
    if (html[index] === "=") {
      index++;
      while (index < end && /\s/.test(html[index]!)) index++;
      const quote = html[index] === '"' || html[index] === "'" ? html[index++]! : "";
      const valueStart = index;
      if (quote) {
        while (index < end && html[index] !== quote) index++;
        value = html.slice(valueStart, index);
        if (html[index] === quote) index++;
      } else {
        while (index < end && !/[\s>]/.test(html[index]!)) index++;
        value = html.slice(valueStart, index);
      }
    }
    attributes.set(name, value);
  }
  return { tag, attributes };
}

export function declaredInspectionAssets(documentUrl: string, body: Uint8Array): Map<string, ResourceType> {
  const result = new Map<string, ResourceType>();
  if (body.byteLength > INSPECTION_BROKER_MAX_BYTES) return result;
  let base: URL;
  try {
    base = new URL(documentUrl);
  } catch {
    return result;
  }
  if (base.origin !== INSPECTION_BROKER_ORIGIN || base.pathname !== "/CaseSearch" || base.search) return result;
  const html = Buffer.from(body).toString("utf8");
  const lowerHtml = html.toLowerCase();
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      index = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    if (html[start + 1] === "/" || html[start + 1] === "!" || html[start + 1] === "?") {
      const end = readTagEnd(html, start + 1);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = readTagEnd(html, start + 1);
    if (end < 0) break;
    index = end + 1;
    const parsed = parseStartTag(html, start, end);
    if (!parsed) continue;
    if (["script", "style", "textarea", "title"].includes(parsed.tag)) {
      const close = new RegExp(`</${parsed.tag}(?=[\\s/>])`, "g");
      close.lastIndex = index;
      const match = close.exec(lowerHtml);
      index = match ? match.index : html.length;
    }
    let rawUrl: string | undefined;
    let type: ResourceType | undefined;
    if (parsed.tag === "script" && parsed.attributes.has("src")) {
      rawUrl = parsed.attributes.get("src");
      type = "script";
    } else if (parsed.tag === "link"
      && (parsed.attributes.get("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")
      && parsed.attributes.has("href")) {
      rawUrl = parsed.attributes.get("href");
      type = "stylesheet";
    }
    if (!rawUrl || !type || rawUrl.length > 2_048) continue;
    try {
      const asset = new URL(rawUrl, base);
      if (asset.origin !== INSPECTION_BROKER_ORIGIN || !ASSET_PATHS.has(asset.pathname)
        || asset.username || asset.password || asset.hash || queryVersion(asset) === null) continue;
      const expectedType = asset.pathname.endsWith(".js") ? "script" : "stylesheet";
      if (type === expectedType) result.set(asset.href, type);
    } catch {
      // Invalid source declarations are ignored, never broadened into fetches.
    }
  }
  return result;
}

function validateRequestHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 64) return null;
  const output: Record<string, string> = {};
  const seen = new Set<string>();
  let total = 0;
  const ignoredTransportHeaders = new Set([
    "host", "connection", "content-length", "transfer-encoding", "accept-encoding",
  ]);
  const forbidden = new Set([
    "proxy-connection", "proxy-authorization", "proxy-authenticate", "upgrade",
    "te", "trailer", "keep-alive", "authorization",
  ]);
  const allowed = new Set([
    "accept", "accept-language", "cache-control", "cookie", "if-modified-since",
    "if-none-match", "origin", "pragma", "referer", "user-agent",
    "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site",
    "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
    "upgrade-insecure-requests",
  ]);
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)
      || typeof rawValue !== "string" || /[^\t\x20-\x7e]/.test(rawValue)
      || rawValue.length > 8_192) return null;
    if (seen.has(name)) return null;
    seen.add(name);
    total += name.length + rawValue.length;
    if (total > MAX_REQUEST_HEADERS_BYTES) return null;
    if (ignoredTransportHeaders.has(name)) continue;
    if (forbidden.has(name)) return null;
    if (!allowed.has(name)) return null;
    if (name === "origin") {
      try {
        if (new URL(rawValue).origin !== INSPECTION_BROKER_ORIGIN) return null;
      } catch {
        return null;
      }
    }
    if (name === "referer") {
      try {
        if (new URL(rawValue).origin !== INSPECTION_BROKER_ORIGIN) return null;
      } catch {
        return null;
      }
    }
    output[name] = rawValue;
  }
  output["accept-encoding"] = "identity";
  return output;
}

function validateBrokerRequest(raw: Record<string, unknown>): BrokerRequest | null {
  if (Object.keys(raw).sort().join(",") !== "headers,kind,method,path,resourceType,url"
    || raw.kind !== "request" || raw.method !== "GET"
    || typeof raw.path !== "string" || raw.path.length > 128
    || typeof raw.url !== "string" || raw.url.length > 2_048
    || typeof raw.resourceType !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return null;
  }
  if (url.origin !== INSPECTION_BROKER_ORIGIN || url.pathname !== raw.path
    || url.username || url.password || url.hash) return null;
  const headers = validateRequestHeaders(raw.headers);
  if (!headers) return null;
  if (raw.path === "/CaseSearch") {
    if (url.search || raw.resourceType.toLowerCase() !== "document") return null;
    return { path: raw.path, url, resourceType: "document", headers };
  }
  if (!ASSET_PATHS.has(raw.path)) return null;
  if (queryVersion(url) === null) return null;
  const resourceType: ResourceType = raw.path.endsWith(".js") ? "script" : "stylesheet";
  if (raw.resourceType.toLowerCase() !== resourceType) return null;
  return { path: raw.path, url, resourceType, headers };
}

function parseHeaderPairs(rawHeaders: string[]): HeaderPairs {
  if (rawHeaders.length % 2 !== 0 || rawHeaders.length > 512) {
    throw new Error("INSPECTION_RESPONSE_HEADERS_INVALID");
  }
  const pairs: HeaderPairs = [];
  let total = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]!;
    const value = rawHeaders[index + 1]!;
    total += name.length + value.length;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || /[\r\n\0]/.test(value) || total > MAX_RESPONSE_HEADERS_BYTES) {
      throw new Error("INSPECTION_RESPONSE_HEADERS_INVALID");
    }
    pairs.push([name, value]);
  }
  return pairs;
}

function retryAfter(headers: HeaderPairs): string | null {
  const values = valuesFor(headers, "retry-after");
  return values.length === 1 && values[0]!.length <= 128 ? values[0]! : null;
}

async function readBoundedBody(response: TransportResponse): Promise<Buffer> {
  const headers = parseHeaderPairs(response.rawHeaders);
  if (headers.some(([, value]) => /[^\t\x20-\x7e]/.test(value))) {
    throw new UnsupportedResponseError(response.status, retryAfter(headers));
  }
  const contentLengths = valuesFor(headers, "content-length");
  if (contentLengths.length > 1) {
    throw new UnsupportedResponseError(response.status, retryAfter(headers));
  }
  if (contentLengths.length === 1) {
    const rawLength = contentLengths[0]!;
    if (!/^\d+$/.test(rawLength)) throw new UnsupportedResponseError(response.status, retryAfter(headers));
    if (Number(rawLength) > INSPECTION_BROKER_MAX_BYTES) {
      throw new BrokerSizeLimitError(response.status, retryAfter(headers));
    }
  }
  const encodings = valuesFor(headers, "content-encoding");
  if (encodings.some((value) => value.trim().toLowerCase() !== "identity")) {
    throw new UnsupportedResponseError(response.status, retryAfter(headers));
  }
  const connectionTokens = valuesFor(headers, "connection").flatMap((value) =>
    value.toLowerCase().split(",").map((token) => token.trim()));
  if (valuesFor(headers, "trailer").length
    || connectionTokens.some((token) => !["close", "keep-alive"].includes(token))) {
    throw new UnsupportedResponseError(response.status, retryAfter(headers));
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk);
      if (bytes + chunk.length > INSPECTION_BROKER_MAX_BYTES) {
        response.cancel();
        chunks.length = 0;
        throw new BrokerSizeLimitError(response.status, retryAfter(headers));
      }
      chunks.push(chunk);
      bytes += chunk.length;
    }
    if (response.trailers?.().length) {
      throw new UnsupportedResponseError(response.status, retryAfter(headers));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    response.close();
  }
}

export class InspectionFetchBroker {
  private readonly startedAt: number;
  private readonly requestedPaths = new Set<string>();
  private readonly declaredAssets = new Map<string, ResourceType>();
  private busy = false;
  private pending: {
    requestId: string; status: number | null; outcome: string; retryAfter: string | null;
  } | null = null;

  constructor(
    private readonly transport: Transport = defaultTransport,
    private readonly maxBytes = INSPECTION_BROKER_MAX_BYTES,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.startedAt = this.clock();
    if (maxBytes !== INSPECTION_BROKER_MAX_BYTES) {
      throw new Error("INSPECTION_BROKER_POLICY_FIXED");
    }
  }

  async handle(raw: Record<string, unknown>, authorize: AuthorizeRequest): Promise<BrokerReply> {
    if (this.busy || this.pending) return { allow: false, reason: "INSPECTION_ACCOUNTING_REQUIRED" };
    this.busy = true;
    try {
      const reply = await this.handleRequest(raw, authorize);
      if (reply.allow) {
        const outcome = "transportError" in reply ? reply.transportError
          : "brokerOutcome" in reply ? reply.brokerOutcome
            : classifyBrokerResponse(reply.status, reply.headers, Buffer.from(reply.body, "base64"));
        this.pending = {
          requestId: reply.requestId, status: reply.status, outcome,
          retryAfter: "headers" in reply ? retryAfter(reply.headers) : reply.retryAfter,
        };
      }
      return reply;
    } finally {
      this.busy = false;
    }
  }

  acknowledge(message: Record<string, unknown>): boolean {
    const expected = this.pending;
    if (!expected || message.requestId !== expected.requestId
      || message.status !== expected.status || message.outcome !== expected.outcome
      || (message.retryAfter ?? null) !== expected.retryAfter) return false;
    this.pending = null;
    return true;
  }

  private async handleRequest(raw: Record<string, unknown>, authorize: AuthorizeRequest): Promise<BrokerReply> {
    const request = validateBrokerRequest(raw);
    if (!request) return { allow: false, reason: "INSPECTION_BROKER_REQUEST_INVALID" };
    if (this.clock() - this.startedAt >= INSPECTION_SESSION_MS) {
      return { allow: false, reason: "INSPECTION_SESSION_DEADLINE" };
    }
    if (this.requestedPaths.has(request.path)) {
      return { allow: false, reason: "INSPECTION_PATH_ALREADY_ATTEMPTED" };
    }
    if (request.path !== "/CaseSearch") {
      const declared = this.declaredAssets.get(request.url.href);
      if (declared !== request.resourceType) {
        return { allow: false, reason: "INSPECTION_ASSET_NOT_DECLARED" };
      }
    }
    this.requestedPaths.add(request.path);
    const authorization = await authorize(request.path, "GET", request.url.href);
    if (authorization.allow !== true || typeof authorization.requestId !== "string"
      || !/^[\da-f-]{36}$/i.test(authorization.requestId)) {
      return { allow: false, reason: authorization.reason ?? "REQUEST_NOT_PERMITTED" };
    }
    if (this.clock() - this.startedAt >= INSPECTION_SESSION_MS) {
      return {
        allow: true, requestId: authorization.requestId, transportError: "TIMEOUT",
        status: null, retryAfter: null,
      };
    }

    let response: TransportResponse | undefined;
    try {
      const remaining = Math.max(1, Math.floor(INSPECTION_SESSION_MS - (this.clock() - this.startedAt)));
      response = await this.transport(
        request.url, request.headers, Math.min(INSPECTION_BROKER_TIMEOUT_MS, remaining),
      );
      const headers = parseHeaderPairs(response.rawHeaders);
      const body = await readBoundedBody(response);
      if (request.path === "/CaseSearch" && response.status === 200) {
        for (const [url, type] of declaredInspectionAssets(request.url.href, body)) {
          this.declaredAssets.set(url, type);
        }
      }
      return {
        allow: true,
        requestId: authorization.requestId,
        status: response.status,
        headers,
        body: body.toString("base64"),
      };
    } catch (error) {
      response?.cancel();
      response?.close();
      if (error instanceof BrokerSizeLimitError) {
        return {
          allow: true, requestId: authorization.requestId,
          brokerOutcome: "SIZE_LIMIT", status: error.status, retryAfter: error.retryAfter,
        };
      }
      if (error instanceof UnsupportedResponseError) {
        return {
          allow: true, requestId: authorization.requestId,
          brokerOutcome: "UNSUPPORTED_RESPONSE", status: error.status, retryAfter: error.retryAfter,
        };
      }
      return {
        allow: true,
        requestId: authorization.requestId,
        transportError: error instanceof BrokerTimeoutError ? "TIMEOUT" : "NETWORK_ERROR",
        status: null,
        retryAfter: null,
      };
    }
  }
}

function classifyBrokerResponse(status: number, headers: HeaderPairs, body: Buffer): string {
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "ACCESS_DENIED";
  if (status >= 300 && status < 400) return "REDIRECT";
  if (status !== 200) return "HTTP_ERROR";
  const text = body.toString("utf8");
  const html = valuesFor(headers, "content-type").some((value) => /text\/html/i.test(value))
    || /^\s*(?:<html|<!doctype)/i.test(text);
  if (html) {
    if (/verify you are human|cf-chl-|g-recaptcha|hcaptcha/i.test(text)) return "CHALLENGE";
    if (/too many requests|too many attempts/i.test(text)) return "RATE_LIMIT";
    if (/access denied/i.test(text)) return "ACCESS_DENIED";
  }
  return "OK";
}
