/** Closed, redacted source-form observations; never submitted search proof. */
export const filingInspectionMethod = "playwright-filing-control-inventory-v2";
export const filingPhases = ["INITIAL", "FILING", "FINAL"] as const;
const legacyFilingPhases = ["FILING", "COURT_TYPE", "COUNTY", "CASE_TYPE", "FINAL"] as const;
export const filingRoles = ["SEARCH_MODE", "COURT_TYPE", "COUNTY", "CASE_TYPE", "COURT_OFFICE"] as const;
const exactKeys = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).sort().join() === [...keys].sort().join();
const count = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const realDate = (value: unknown) => value === null || typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
export function validFilingMetadata(message: Record<string, unknown>) {
  // Keep consumed v1 reports readable without accepting v1 in the current worker.
  if (message.method === filingInspectionMethod) return validFilingInventoryMetadata(message);
  if (!exactKeys(message, ["kind", "phase", "controls", "scopeReady", "modeMatchesFiling", "officeCodes", "dates", "unclassifiedSelects"])
    || message.kind !== "filing_metadata" || !legacyFilingPhases.includes(message.phase as typeof legacyFilingPhases[number])
    || typeof message.scopeReady !== "boolean" || typeof message.modeMatchesFiling !== "boolean"
    || !count(message.unclassifiedSelects, 64)
    || !Array.isArray(message.controls) || message.controls.length !== filingRoles.length
    || !Array.isArray(message.officeCodes) || message.officeCodes.length > 250
    || !message.officeCodes.every(code => typeof code === "string" && /^(?:MDJ|MJ)-05(?:-[A-Za-z0-9]{1,20}){1,4}$/.test(code))
    || new Set(message.officeCodes).size !== message.officeCodes.length
    || !Array.isArray(message.dates) || message.dates.length > 16) return false;
  for (const [index, raw] of message.controls.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    if (!exactKeys(row, ["role", "candidates", "visible", "enabled", "optionCount", "choicePresent",
      "selectedChoiceMatches", "nativeNamed", "nativeMatches", "association"])
      || row.role !== filingRoles[index] || !count(row.candidates, 64) || !count(row.optionCount, 2000)
      || !count(row.nativeNamed, 32) || !count(row.nativeMatches, Number(row.nativeNamed))
      || !["visible", "enabled", "choicePresent", "selectedChoiceMatches"].every(key => typeof row[key] === "boolean")
      || !["NONE", "DOM_GROUP", "DIRECT_LABEL"].includes(String(row.association))
      || (row.choicePresent || row.selectedChoiceMatches) && (row.candidates !== 1 || !row.visible || !row.enabled)) return false;
  }
  const expectedScope = message.modeMatchesFiling && message.controls.slice(1, 4).every(row => row.selectedChoiceMatches);
  if (message.modeMatchesFiling !== message.controls[0].selectedChoiceMatches
    || message.scopeReady !== expectedScope || !message.scopeReady && message.officeCodes.length !== 0) return false;
  return message.dates.every(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    return exactKeys(row, ["minimum", "maximum", "visible", "enabled", "nativeNamed", "nativeSuccessful"])
      && realDate(row.minimum) && realDate(row.maximum)
      && ["visible", "enabled", "nativeNamed", "nativeSuccessful"].every(key => typeof row[key] === "boolean")
      && (!row.nativeSuccessful || row.nativeNamed && row.enabled);
  });
}

export const filingPublicLabels = ["Search By", "Court", "Courts", "Court Type", "Court Level",
  "Court System", "Court Selection", "Court Category", "Court of Record",
  "Judicial District", "County", "Case Type", "Case Category", "Court Office"] as const;
const choiceKeys = ["FILING", "MDJ", "ALLEGHENY", "CRIMINAL"];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const subset = (value: unknown, vocabulary: readonly string[]) => Array.isArray(value)
  && value.length <= vocabulary.length && value.every(key => typeof key === "string" && vocabulary.includes(key))
  && new Set(value).size === value.length;
export function validFilingInventoryMetadata(message: Record<string, unknown>) {
  if (!exactKeys(message, ["kind", "method", "phase", "modeMatchesFiling", "controls", "omittedSensitiveControls"])
    || message.kind !== "filing_metadata" || message.method !== filingInspectionMethod
    || !filingPhases.includes(message.phase as typeof filingPhases[number])
    || typeof message.modeMatchesFiling !== "boolean" || !count(message.omittedSensitiveControls, 128)
    || !Array.isArray(message.controls) || message.controls.length + Number(message.omittedSensitiveControls) > 128
    || message.phase !== "INITIAL" && !message.modeMatchesFiling) return false;
  let priorOrdinal = -1;
  for (const row of message.controls) {
    if (!object(row) || !exactKeys(row, ["ordinal", "widget", "labels", "associations", "hasPublicLabel",
      "visible", "enabled", "ownership", "optionCount", "publicChoices", "selectedPublicChoices", "nativeSuccessful"])
      || !count(row.ordinal, 127) || Number(row.ordinal) <= priorOrdinal
      || typeof row.widget !== "string" || !["SELECT", "RADIO", "CHECKBOX", "COMBOBOX", "TAB", "MENUITEMRADIO", "BUTTON"].includes(row.widget)
      || !subset(row.labels, filingPublicLabels) || !subset(row.associations, ["LABEL", "ARIA", "GROUP", "TEXT"])
      || typeof row.ownership !== "string" || !["SEARCH", "OTHER", "NONE"].includes(row.ownership) || !count(row.optionCount, 2000)
      || !["hasPublicLabel", "visible", "enabled", "nativeSuccessful"].every(key => typeof row[key] === "boolean")
      || !object(row.publicChoices) || !object(row.selectedPublicChoices)
      || !exactKeys(row.publicChoices, choiceKeys) || !exactKeys(row.selectedPublicChoices, choiceKeys)
      || row.nativeSuccessful && (row.ownership !== "SEARCH" || !row.enabled
        || !["SELECT", "RADIO", "CHECKBOX"].includes(String(row.widget)))) return false;
    for (const key of choiceKeys) {
      const max = ["SELECT", "COMBOBOX"].includes(String(row.widget)) ? Number(row.optionCount) : 1;
      if (!count(row.publicChoices[key], max)
        || !count(row.selectedPublicChoices[key], Number(row.publicChoices[key]))) return false;
    }
    priorOrdinal = Number(row.ordinal);
  }
  return true;
}
