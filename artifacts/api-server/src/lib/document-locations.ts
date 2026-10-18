/** Validate child-provided locations before retaining any document evidence. */
export function documentLocations(message: Record<string, unknown>) {
  const names = ["documentSha256", "documentPageCount", "bailSectionPages"];
  const complete = ["EXTRACTED", "MISSING_BAIL_SECTION"].includes(String(message.extractionOutcome));
  if (!names.some((name) => Object.hasOwn(message, name))) {
    if (complete) throw new Error("Document evidence is missing page provenance");
    return {};
  }
  const count = message.documentPageCount;
  const pages = (value: unknown): value is number[] =>
    Array.isArray(value) && value.length <= 100
    && value.every((page, i) => Number.isSafeInteger(page) && page >= 1
      && page <= Number(count) && (i === 0 || value[i - 1] < page));
  if (typeof message.documentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(message.documentSha256)
    || !Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > 100
    || !pages(message.bailSectionPages)) throw new Error("Invalid document page provenance");
  const sectionPages = message.bailSectionPages;
  if (message.extractionOutcome === "MISSING_BAIL_SECTION" && sectionPages.length
    || message.extractionOutcome === "EXTRACTED" && (!sectionPages.length
      || !Array.isArray(message.entries) || !message.entries.length
      || message.entries.some((entry) => !entry || typeof entry !== "object"
        || !pages(entry.sourcePages) || !entry.sourcePages.length
        || entry.sourcePages.some((page: number) => !sectionPages.includes(page))))) {
    throw new Error("Entry pages do not match the inspected bail section");
  }
  return {
    documentSha256: message.documentSha256,
    documentPageCount: Number(count),
    bailSectionPages: sectionPages,
  };
}
