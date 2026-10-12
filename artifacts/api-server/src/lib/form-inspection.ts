export const formInspectionMethod = "playwright-form-inspection-v1";

export function inspectionRequestAllowed(path: unknown, method: unknown) {
  return method === "GET" && ["/CaseSearch", "/resource/js/sitemain.min.js",
    "/resource/css/sitemain.min.css"].includes(String(path));
}

export function validInspectionMetadata(message: Record<string, unknown>) {
  const labels = ["SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "START_DATE", "END_DATE", "EVENT_TYPE"];
  const flags = ["uiPresent", "uiNamed", "uiEnabled", "uiSameForm", "uiMatches"];
  const counts = ["sameFormNamed", "outsideContainerNamed", "nativeMatches", "nativePostedMatches", "knownKeyPostedMatches"];
  const types = ["hidden", "text", "date", "number", "select", "other"];
  const allowed = ["control", "types", ...flags, ...counts].sort().join(",");
  if (!["BEFORE", "LOCAL_POST"].includes(String(message.phase))
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
      && Number(row.nativeMatches) <= Number(row.sameFormNamed)
      && Number(row.nativePostedMatches) <= Number(row.sameFormNamed)
      && (message.phase !== "BEFORE" || row.nativePostedMatches === 0 && row.knownKeyPostedMatches === 0);
  });
}
