"""Public filter inventory only. No Search click, query, PDF, names or tokens."""
METHOD = "playwright-coverage-inspection-v1"
PHASES = ("INITIAL", "CALENDAR", "FILING")

# Option values remain in child memory. Only a closed set of semantic flags,
# source-listed Allegheny office codes and date bounds crosses the protocol.
INVENTORY = """({phase, modeAvailable}) => {
  const form = document.querySelector('#btnSearch')?.form;
  if (!form) return {error: 'COVERAGE_FORM_MISSING'};
  const mode = document.querySelector('#SearchBy-Control select');
  const office = document.querySelector('#CourtOffice-Control select');
  const event = document.querySelector('#CalendarEventType-Control select');
  const district = document.querySelector('#JudicialDistrict-Control select');
  const eligible = node => node && node.form === form && !node.matches(':disabled');
  if (!eligible(mode) || mode.options.length > 64) return {error: 'COVERAGE_CONTROL_INVALID'};
  const labels = [...mode.options].map(option => option.textContent.trim());
  const calendarLabels = ['Calendar Event', 'Calendar Events'];
  const filingLabels = ['Date Filed', 'Filing Date', 'Date of Filing'];
  const available = (node, label) => eligible(node) && [...node.options].some(
    option => !option.disabled && option.textContent.trim() === label);
  const districtMatchesScope = eligible(district) && district.value === '05';
  const officeCodes = modeAvailable && districtMatchesScope && eligible(office) ? [...office.options].filter(option => !option.disabled)
    .map(option => option.value).filter(value => /^(?:CP|MDJ|MJ)-05(?:-[A-Za-z0-9]{1,20}){1,4}$/.test(value)) : [];
  if (officeCodes.length > 250 || new Set(officeCodes).size !== officeCodes.length)
    return {error: 'COVERAGE_CONTROL_INVALID'};
  const dates = [];
  for (const node of form.querySelectorAll('input[type=date]')) {
    if (!modeAvailable) break;
    // Read only date constraints of public filing/calendar filters, never values.
    const identity = node.name + ' ' + node.id;
    if (/token|password|secret|session|cookie|captcha|verification|auth|birth/i.test(identity)) continue;
    const purpose = /calendar|event/i.test(identity) ? 'CALENDAR' : /fil/i.test(identity) ? 'FILING' : null;
    if (!purpose) continue;
    const bound = value => value === '' ? null : /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : 'INVALID';
    dates.push({purpose, minimum: bound(node.min), maximum: bound(node.max),
      visible: !!node.getClientRects().length, enabled: !node.matches(':disabled')});
  }
  if (dates.length > 16 || dates.some(row => row.minimum === 'INVALID' || row.maximum === 'INVALID'))
    return {error: 'COVERAGE_CONTROL_INVALID'};
  return {phase, modeAvailable,
    calendarChoicePresent: calendarLabels.some(label => available(mode, label)),
    filingChoicePresent: filingLabels.some(label => available(mode, label)),
    districtMatchesScope,
    bailHearingPresent: modeAvailable && districtMatchesScope && available(event, 'Bail Hearing'),
    preliminarySingularPresent: modeAvailable && districtMatchesScope && available(event, 'Preliminary Arraignment'),
    preliminaryPluralPresent: modeAvailable && districtMatchesScope && available(event, 'Preliminary Arraignments'),
    unretainedModeOptions: labels.filter(label => ![...calendarLabels, ...filingLabels].includes(label)).length,
    officeCodes, dates};
}"""

SELECT_MODE = """({labels}) => {
  const form = document.querySelector('#btnSearch')?.form;
  const node = document.querySelector('#SearchBy-Control select');
  if (!form || !node || node.form !== form || node.matches(':disabled') || node.options.length > 64)
    return {error: 'COVERAGE_CONTROL_INVALID'};
  const options = [...node.options].filter(option => !option.disabled && labels.includes(option.textContent.trim()));
  if (options.length > 1) return {error: 'COVERAGE_CONTROL_AMBIGUOUS'};
  return {value: options.length === 1 ? options[0].value : null};
}"""


async def observe(page, emit):
    for phase, labels in (
        ("INITIAL", None),
        ("CALENDAR", ["Calendar Event", "Calendar Events"]),
        ("FILING", ["Date Filed", "Filing Date", "Date of Filing"]),
    ):
        available = True
        if labels:
            choice = await page.evaluate(SELECT_MODE, {"labels": labels})
            if not isinstance(choice, dict) or "error" in choice:
                raise RuntimeError("COVERAGE_CONTROL_INVALID")
            available = choice.get("value") is not None
            if available:
                await page.locator("#SearchBy-Control select").select_option(choice["value"])
            if phase == "CALENDAR" and available:
                # Exact previously observed district; no county substitution.
                await page.locator("#JudicialDistrict-Control select").select_option("05")
                # Exact known office only; missing support stops, never substitutes.
                await page.locator("#CourtOffice-Control select").select_option("CP-05-02-Crim")
        metadata = await page.evaluate(INVENTORY, {"phase": phase, "modeAvailable": available})
        if not isinstance(metadata, dict) or "error" in metadata:
            raise RuntimeError("COVERAGE_CONTROL_INVALID")
        emit("coverage_metadata", **metadata)
