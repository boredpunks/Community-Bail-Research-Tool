/** Fixed categories only: no headers, URLs, tokens, body text or case data. */
export function validCalendarResponseSize(value: Record<string, unknown>): boolean {
  const keys = ["kind", "version", "measurement", "limitBytes", "observedBytes",
    "complete", "statusCode", "mediaType", "contentEncoding"];
  return Object.keys(value).length === keys.length && keys.every(k => k in value)
    && value.kind === "calendar_response_size" && value.version === 1
    && value.measurement === "CHROMIUM_DECODED_ENTITY_BYTES"
    && Number.isInteger(value.limitBytes) && Number(value.limitBytes) >= 4_000_000
    && Number(value.limitBytes) <= 32_000_000
    && Number.isInteger(value.observedBytes) && Number(value.observedBytes) >= 0
    && Number(value.observedBytes) <= Number(value.limitBytes) + 1
    && typeof value.complete === "boolean"
    && (!value.complete || Number(value.observedBytes) <= Number(value.limitBytes))
    && (value.statusCode === null || Number.isInteger(value.statusCode)
      && Number(value.statusCode) >= 100 && Number(value.statusCode) <= 599)
    && typeof value.mediaType === "string"
    && ["text/html", "", "OTHER"].includes(value.mediaType)
    && typeof value.contentEncoding === "string"
    && ["identity", "gzip", "br", "deflate", "OTHER"].includes(value.contentEncoding);
}
