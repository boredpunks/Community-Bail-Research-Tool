/** Closed, redacted source-form observations; never submitted search proof. */
export const filingInspectionMethod = "playwright-filing-control-inventory-v8";
const legacyInventoryMethods = ["playwright-filing-control-inventory-v2", "playwright-filing-control-inventory-v3", "playwright-filing-control-inventory-v4", "playwright-filing-control-inventory-v5", "playwright-filing-control-inventory-v6", "playwright-filing-control-inventory-v7"];
export const filingPhases = ["INITIAL", "FILING", "ADVANCED", "COUNTY", "FINAL"] as const;
const legacyInventoryPhases = ["INITIAL", "FILING", "FINAL"];
const legacyFilingPhases = ["FILING", "COURT_TYPE", "COUNTY", "CASE_TYPE", "FINAL"] as const;
export const filingRoles = ["SEARCH_MODE", "COURT_TYPE", "COUNTY", "CASE_TYPE", "COURT_OFFICE"] as const;
const exactKeys = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).sort().join() === [...keys].sort().join();
const count = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const realDate = (value: unknown) => value === null || typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
export function validFilingMetadata(message: Record<string, unknown>) {
  // Keep consumed v1 reports readable without accepting v1 in the current worker.
  if (message.method === filingInspectionMethod || legacyInventoryMethods.includes(String(message.method)))
    return validFilingInventoryMetadata(message, true);
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
  "Judicial District", "County", "Case Type", "Case Category", "Court Office",
  "Court Types", "Case Types", "Search All Courts", "All Courts", "Search All Cases", "All Cases", "Include Closed Cases",
  "Advanced Search", "Enable Advanced Search", "Use Advanced Search", "Show Advanced Search", "Limit Search",
  "Restrict Search", "Enable Filters",
  "CP Court", "CP County", "MDJ Court", "MDJ County", "MDC Court", "MDC County",
  "Magisterial District Court", "Magisterial District Courts", "Court of Common Pleas",
  "Common Pleas Court", "Originating Court", "Originating County", "Court Name",
  "Court Location", "Docket Type", "Docket Category", "Case Status", "Active Only",
  "Court Number", "Court No", "Court No.", "Court #", "Court Code", "Court ID",
  "Court Identifier", "Court Division", "Court Jurisdiction", "Court Offices",
  "Court Office(s)", "Court(s)", "Court (Required)", "Court (Optional)",
  "Trial Court", "Local Court", "County Court", "Municipal Court",
  "MDJ Court Office", "Court Office (MDJ)", "Court Office (MJ)",
  "Magisterial District Court Office"] as const;
export const filingPublicWords = ["all", "court", "courts", "case", "cases", "criminal", "search", "system",
  "type", "types", "county", "closed", "include", "exclude", "magisterial", "district", "common", "pleas", "level", "by",
  "advanced", "enable", "enabled", "show", "options", "filters", "filter", "limit", "limited", "restrict", "restricted",
  "specific", "within", "only", "use", "criteria", "cp", "mdj", "mdc", "originating", "location", "docket", "status", "active",
  "number", "no", "code", "id", "identifier", "division", "jurisdiction", "office", "offices", "required", "optional",
  "trial", "local", "municipal"] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const subset = (value: unknown, vocabulary: readonly string[]) => Array.isArray(value)
  && value.length <= vocabulary.length && value.every(key => typeof key === "string" && vocabulary.includes(key))
  && new Set(value).size === value.length;
export function validFilingInventoryMetadata(message: Record<string, unknown>, allowHistorical = false) {
  const legacy = allowHistorical && legacyInventoryMethods.includes(String(message.method));
  const legacyV2 = legacy && message.method === legacyInventoryMethods[0];
  const legacyV5 = legacy && message.method === legacyInventoryMethods[3];
  const legacyV6 = legacy && message.method === legacyInventoryMethods[4];
  const legacyV7 = legacy && message.method === legacyInventoryMethods[5];
  const wordInventory = !legacy || message.method === legacyInventoryMethods[2] || legacyV5 || legacyV6 || legacyV7;
  const allowedPhases: readonly string[] = legacyV5 ? ["INITIAL", "FILING", "ADVANCED", "FINAL"]
    : legacy && !legacyV6 && !legacyV7 ? legacyInventoryPhases : filingPhases;
  const choiceKeys = ["FILING", "MDJ", "ALLEGHENY", "CRIMINAL", ...(wordInventory ? ["COMMON_PLEAS"] : [])];
  if (!exactKeys(message, ["kind", "method", "phase", "modeMatchesFiling", "controls", "omittedSensitiveControls",
      ...(!legacy || legacyV5 || legacyV6 || legacyV7 ? ["advancedSearch"] : []),
      ...(!legacy || legacyV6 || legacyV7 ? ["county"] : []), ...(!legacy || legacyV7 ? ["officeIdentification"] : [])])
    || message.kind !== "filing_metadata" || message.method !== filingInspectionMethod && !legacy
    || !allowedPhases.includes(String(message.phase))
    || typeof message.modeMatchesFiling !== "boolean" || !count(message.omittedSensitiveControls, 128)
    || !Array.isArray(message.controls) || message.controls.length + Number(message.omittedSensitiveControls) > 128
    || message.phase !== "INITIAL" && !message.modeMatchesFiling) return false;
  let priorOrdinal = -1;
  for (const row of message.controls) {
    if (!object(row) || !exactKeys(row, ["ordinal", "widget", "labels", "associations", "hasPublicLabel",
      "visible", "enabled", "ownership", "optionCount", "publicChoices", "selectedPublicChoices", "nativeSuccessful",
      ...(legacyV2 ? [] : ["optionState"]), ...(wordInventory ? ["labelWords"] : [])])
      || !count(row.ordinal, 127) || Number(row.ordinal) <= priorOrdinal
      || typeof row.widget !== "string" || !["SELECT", "RADIO", "CHECKBOX", "COMBOBOX", "TAB", "MENUITEMRADIO", "BUTTON", ...(wordInventory ? ["LINK"] : [])].includes(row.widget)
      || !subset(row.labels, filingPublicLabels) || !subset(row.associations, ["LABEL", "ARIA", "GROUP", "TEXT"])
      || wordInventory && !subset(row.labelWords, filingPublicWords)
      || typeof row.ownership !== "string" || !["SEARCH", "OTHER", "NONE"].includes(row.ownership)
      || !["hasPublicLabel", "visible", "enabled", "nativeSuccessful"].every(key => typeof row[key] === "boolean")
      || row.nativeSuccessful && (row.ownership !== "SEARCH" || !row.enabled
        || !["SELECT", "RADIO", "CHECKBOX"].includes(String(row.widget)))) return false;
    if (!legacyV2 && (typeof row.optionState !== "string" || !["OBSERVED", "OVER_LIMIT"].includes(row.optionState))) return false;
    if (!legacyV2 && row.optionState === "OVER_LIMIT") {
      if (!["SELECT", "COMBOBOX"].includes(row.widget) || row.optionCount !== null
        || row.publicChoices !== null || row.selectedPublicChoices !== null) return false;
      priorOrdinal = Number(row.ordinal);
      continue;
    }
    if (!count(row.optionCount, 2000) || !object(row.publicChoices) || !object(row.selectedPublicChoices)
      || !exactKeys(row.publicChoices, choiceKeys) || !exactKeys(row.selectedPublicChoices, choiceKeys)) return false;
    for (const key of choiceKeys) {
      const max = ["SELECT", "COMBOBOX"].includes(String(row.widget)) ? Number(row.optionCount) : 1;
      if (!count(row.publicChoices[key], max)
        || !count(row.selectedPublicChoices[key], Number(row.publicChoices[key]))) return false;
    }
    priorOrdinal = Number(row.ordinal);
  }
  if (legacy && !legacyV5 && !legacyV6 && !legacyV7) return true;
  const advanced = message.advancedSearch;
  const candidates = message.controls.filter(row => row.widget === "CHECKBOX" && row.labels.includes("Advanced Search"));
  const eligible = candidates.length === 1 && message.modeMatchesFiling && candidates[0].visible
    && candidates[0].enabled && candidates[0].ownership === "SEARCH" && candidates[0].hasPublicLabel;
  if (!(object(advanced) && exactKeys(advanced, ["candidates", "eligible", "checked"])
    && advanced.candidates === candidates.length && advanced.eligible === eligible
    && (candidates.length === 1 ? typeof advanced.checked === "boolean" : advanced.checked === null)
    && (!["ADVANCED", "COUNTY", "FINAL"].includes(String(message.phase)) || eligible && advanced.checked === true))) return false;
  if (legacyV5) return true;
  const counties = message.controls.filter(row => row.widget === "SELECT" && row.labels.includes("County"));
  const countyEligible = counties.length === 1 && eligible && advanced.checked === true
    && counties[0].visible && counties[0].enabled && counties[0].ownership === "SEARCH"
    && counties[0].hasPublicLabel && counties[0].optionState === "OBSERVED"
    && counties[0].publicChoices.ALLEGHENY === 1;
  const selected = counties.length === 1 && counties[0].optionState === "OBSERVED"
    ? counties[0].selectedPublicChoices.ALLEGHENY === 1 : null;
  if (!(object(message.county) && exactKeys(message.county, ["candidates", "eligible", "selected"])
    && message.county.candidates === counties.length && message.county.eligible === countyEligible
    && message.county.selected === selected
    && (!["COUNTY", "FINAL"].includes(String(message.phase)) || countyEligible && selected === true))) return false;
  if (legacyV6) return true;
  const offices = message.controls.filter(row => row.widget === "SELECT" && row.visible && row.enabled
    && row.ownership === "SEARCH" && row.hasPublicLabel && row.labelWords.includes("court")
    && (row.labelWords.includes("office") || row.labelWords.includes("offices")));
  const ready = countyEligible && selected === true && ["COUNTY", "FINAL"].includes(String(message.phase));
  const state = !ready ? "NOT_READY" : offices.length === 0 ? "MISSING"
    : offices.length !== 1 ? "AMBIGUOUS" : offices[0].optionState === "OVER_LIMIT" ? "OVER_LIMIT" : "OBSERVED";
  const identification = message.officeIdentification;
  if (!object(identification) || !exactKeys(identification, ["state", "candidates", "controlOrdinal", "codes", "unrecognizedOptions"])
    || identification.state !== state || identification.candidates !== offices.length
    || identification.controlOrdinal !== (ready && offices.length === 1 ? offices[0].ordinal : null)) return false;
  if (state !== "OBSERVED") return identification.codes === null && identification.unrecognizedOptions === null;
  return Array.isArray(identification.codes) && identification.codes.length <= 250
    && count(identification.unrecognizedOptions, Number(offices[0].optionCount))
    && identification.codes.length + Number(identification.unrecognizedOptions) === offices[0].optionCount
    && identification.codes.every(row => object(row) && exactKeys(row, ["code", "kind", "enabled", "selected"])
      && typeof row.code === "string" && /^05-\d-\d{2}$/.test(row.code)
      && ["EXPLICIT_MDJ", "DISTRICT_CODE_UNVERIFIED"].includes(String(row.kind))
      && typeof row.enabled === "boolean" && typeof row.selected === "boolean");
}
