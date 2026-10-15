export const formInspectionMethod = "playwright-form-inspection-v1";

// Keep disabled until the offline-reviewed request gate has a separate live
// approval. Changing this requires a fresh enforcement review.
export const formInspectionLiveEnabled = false;

const inspectionPaths = new Set([
  "/CaseSearch",
  "/resource/js/sitemain.min.js",
  "/resource/css/sitemain.min.css",
]);

export function inspectionRequestAllowed(path: unknown, method: unknown) {
  return method === "GET" && inspectionPaths.has(String(path));
}

export function validInspectionMetadata(message: Record<string, unknown>) {
  const labels = ["SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "START_DATE", "END_DATE", "EVENT_TYPE"];
  const flags = ["uiPresent", "uiNamed", "uiEnabled", "uiSameForm", "uiMatches"];
  const counts = ["sameFormNamed", "outsideContainerNamed", "nativeMatches"];
  const types = ["hidden", "text", "date", "number", "select", "other"];
  const allowed = ["control", "types", ...flags, ...counts].sort().join(",");
  if (message.phase !== "BEFORE"
    || !Array.isArray(message.controls) || message.controls.length !== 6
    || Object.keys(message).some(key => !["kind", "phase", "controls"].includes(key))) return false;
  return message.controls.every((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== allowed || row.control !== labels[index]
      || !flags.every(key => typeof row[key] === "boolean")
      || !counts.every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 32)
      || !row.types || typeof row.types !== "object" || Array.isArray(row.types)) return false;
    const histogram = row.types as Record<string, unknown>;
    if (Object.keys(histogram).sort().join(",") !== [...types].sort().join(",")
      || !types.every(key => Number.isSafeInteger(histogram[key]) && Number(histogram[key]) >= 0 && Number(histogram[key]) <= 32)) return false;
    const total = types.reduce((sum, key) => sum + Number(histogram[key]), 0);
    return total <= 32 && Number(row.sameFormNamed) <= total
      && Number(row.outsideContainerNamed) <= Number(row.sameFormNamed)
      && Number(row.nativeMatches) <= Number(row.sameFormNamed);
  });
}
