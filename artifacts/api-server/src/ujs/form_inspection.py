"""Read-only, redacted public filter diagnostics. Never return HTML or values."""

METHOD = "parent-https+playwright-form-inspection-v3"
CONTROLS = ("SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "COURT_ROOM",
            "START_DATE", "END_DATE", "EVENT_TYPE")
KEYS = ("SearchBy", "JudicialDistrict", "CourtOffice", "CourtRoomID",
        "CalendarEventStartDate", "CalendarEventEndDate", "CalendarEventType")

SNAPSHOT = """({expected}) => {
  const button = document.querySelector('#btnSearch'), form = button?.form;
  if (!form) return {error: 'CALENDAR_FORM_MISSING'};
  const action = new URL(button.getAttribute('formaction') || form.action, document.baseURI);
  if (action.href !== 'https://ujsportal.pacourts.us/CaseSearch'
      || (button.getAttribute('formmethod') || form.method).toLowerCase() !== 'post'
      || (button.getAttribute('formenctype') || form.enctype).toLowerCase()
        !== 'application/x-www-form-urlencoded')
    return {error: 'UNSUPPORTED_CALENDAR_FORM_TARGET'};
  if (button.matches(':disabled') || !form.checkValidity())
    return {error: 'SOURCE_FORM_VALIDATION'};
  const data = new FormData(form), controls = [], bindings = [];
  for (const [label, selector, containerId, publicId, value] of expected) {
    const ui = document.querySelector(selector), group = containerId && document.getElementById(containerId);
    const nodes = new Set(group ? group.querySelectorAll('input[name],select[name],textarea[name]') : []);
    const identified = publicId ? document.getElementById(publicId) : null;
    if (identified) nodes.add(identified);
    if (!containerId && ui) nodes.add(ui);
    if (nodes.size > 32) return {error: 'INSPECTION_METADATA_INVALID'};
    const courtRoom = label === 'COURT_ROOM';
    const selectedValue = courtRoom ? ui?.value : value;
    const uiMatches = courtRoom
      ? !!ui && ui.selectedOptions.length === 1 && ui.selectedOptions[0].label.trim() === value
      : !!ui && ['select-one','date','text'].includes(ui.type) && ui.value === value;
    const row = {control: label, uiPresent: !!ui, uiNamed: !!ui?.name,
      uiEnabled: !!ui && !ui.matches(':disabled'), uiSameForm: !!ui && ui.form === form,
      uiMatches,
      types: {hidden: 0, text: 0, date: 0, number: 0, select: 0, other: 0},
      sameFormNamed: 0, outsideContainerNamed: 0, nativeMatches: 0};
    for (const field of nodes) {
      if (!field.name || /token|password|secret|session|cookie|captcha|verification|auth/i.test(field.name + field.id))
        continue;
      const kind = field.type === 'select-one' ? 'select' : field.type;
      row.types[Object.hasOwn(row.types, kind) ? kind : 'other']++;
      if (!['hidden','text','date','number','select-one','textarea'].includes(field.type)
          || field.form !== form || field.matches(':disabled')) continue;
      row.sameFormNamed++;
      if (group && !group.contains(field)) row.outsideContainerNamed++;
      const entries = data.getAll(field.name);
      if (entries.length === 1 && entries[0] === selectedValue) row.nativeMatches++;
      if (field.name.length > 128) return {error: 'INSPECTION_METADATA_INVALID'};
    }
    controls.push(row);
  }
  return {phase: 'BEFORE', controls};
}"""


def expected(criteria):
    event_type = "" if criteria.get("eventType") == "ANY" else criteria["eventType"]
    return [
        [CONTROLS[0], "#SearchBy-Control select", "SearchBy-Control", KEYS[0], "CalendarEvent"],
        [CONTROLS[1], "#JudicialDistrict-Control select", "JudicialDistrict-Control", KEYS[1], "05"],
        [CONTROLS[2], "#CourtOffice-Control select", "CourtOffice-Control", KEYS[2], criteria["courtOffice"]],
        [CONTROLS[3], 'select[name="CourtRoomID"]', None, None, criteria["courtRoom"]],
        [CONTROLS[4], "input[name=CalendarEventStartDate]", None, KEYS[4], criteria["startDate"]],
        [CONTROLS[5], "input[name=CalendarEventEndDate]", None, KEYS[5], criteria["endDate"]],
        [CONTROLS[6], "#CalendarEventType-Control select", "CalendarEventType-Control", KEYS[6], event_type],
    ]


async def snapshot(page, criteria):
    result = await page.evaluate(SNAPSHOT, {"expected": expected(criteria)})
    if not isinstance(result, dict) or "error" in result:
        code = result.get("error") if isinstance(result, dict) else None
        raise RuntimeError(code if code in {"CALENDAR_FORM_MISSING", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                                           "SOURCE_FORM_VALIDATION"} else "INSPECTION_METADATA_INVALID")
    return result
