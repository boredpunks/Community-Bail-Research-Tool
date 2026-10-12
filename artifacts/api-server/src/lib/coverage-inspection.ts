/** Operator-only coverage observation, never discovery or access proof. */
export const coverageInspectionMethod = "playwright-coverage-inspection-v1";
export const coveragePhases = ["INITIAL", "CALENDAR", "FILING"] as const;
const flags = ["modeAvailable", "calendarChoicePresent", "filingChoicePresent",
  "bailHearingPresent", "preliminarySingularPresent", "preliminaryPluralPresent", "districtMatchesScope"];
const dateFields = ["purpose", "minimum", "maximum", "visible", "enabled"];
const officeCode = /^(?:CP|MDJ|MJ)-05(?:-[A-Za-z0-9]{1,20}){1,4}$/;
const realDate = (value: unknown) => value === null || typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

export function validCoverageMetadata(message: Record<string, unknown>) {
  const keys = ["kind", "phase", ...flags, "officeCodes", "dates", "unretainedModeOptions"];
  if (Object.keys(message).sort().join() !== keys.sort().join()
    || message.kind !== "coverage_metadata" || !coveragePhases.includes(message.phase as typeof coveragePhases[number])
    || !flags.every(key => typeof message[key] === "boolean")
    || !Number.isSafeInteger(message.unretainedModeOptions) || Number(message.unretainedModeOptions) < 0
    || Number(message.unretainedModeOptions) > 64 || !Array.isArray(message.officeCodes)
    || message.officeCodes.length > 250 || !message.officeCodes.every(code => typeof code === "string" && officeCode.test(code))
    || new Set(message.officeCodes).size !== message.officeCodes.length
    || !Array.isArray(message.dates) || message.dates.length > 16) return false;
  return message.dates.every(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    return Object.keys(row).sort().join() === [...dateFields].sort().join()
      && ["CALENDAR", "FILING"].includes(String(row.purpose))
      && realDate(row.minimum) && realDate(row.maximum)
      && typeof row.visible === "boolean" && typeof row.enabled === "boolean";
  });
}
