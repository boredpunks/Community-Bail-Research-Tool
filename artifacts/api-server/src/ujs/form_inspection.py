"""Read-only, redacted public filter diagnostics. Never return HTML or values."""
from urllib.parse import parse_qs
import re

METHOD = "playwright-form-inspection-v1"
SENSITIVE = re.compile(r"token|password|secret|session|cookie|captcha|verification|auth", re.I)
CONTROLS = ("SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "START_DATE", "END_DATE", "EVENT_TYPE")
KEYS = ("SearchBy", "JudicialDistrict", "CourtOffice", "CalendarEventStartDate", "CalendarEventEndDate", "CalendarEventType")

SNAPSHOT = """({expected}) => {
  const button = document.querySelector('#btnSearch'), form = button?.form;
  if (!form) return {error: 'CALENDAR_FORM_MISSING'};
  const action = new URL(button.getAttribute('formaction') || form.action, document.baseURI);
  if (action.href !== 'https://ujsportal.pacourts.us/CaseSearch'
      || (button.getAttribute('formmethod') || form.method).toLowerCase() !== 'post')
    return {error: 'UNSUPPORTED_CALENDAR_FORM_TARGET'};
  if (button.matches(':disabled') || !form.checkValidity())
    return {error: 'SOURCE_FORM_VALIDATION'};
  const data = new FormData(form), controls = [], bindings = [];
  for (const [label, selector, containerId, publicId, value] of expected) {
    const ui = document.querySelector(selector), group = containerId && document.getElementById(containerId);
    const nodes = new Set(group ? group.querySelectorAll('input[name],select[name],textarea[name]') : []);
    const identified = document.getElementById(publicId);
    if (identified) nodes.add(identified);
    if (!containerId && ui) nodes.add(ui);
    if (nodes.size > 32) return {error: 'INSPECTION_METADATA_INVALID'};
    const row = {control: label, uiPresent: !!ui, uiNamed: !!ui?.name,
      uiEnabled: !!ui && !ui.matches(':disabled'), uiSameForm: !!ui && ui.form === form,
      uiMatches: !!ui && ['select-one','date','text'].includes(ui.type) && ui.value === value,
      types: {hidden: 0, text: 0, date: 0, number: 0, select: 0, other: 0},
      sameFormNamed: 0, outsideContainerNamed: 0, nativeMatches: 0, nativePostedMatches: 0, knownKeyPostedMatches: 0};
    const names = [];
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
      if (entries.length === 1 && entries[0] === value) row.nativeMatches++;
      if (field.name.length > 128) return {error: 'INSPECTION_METADATA_INVALID'};
      names.push(field.name);
    }
    controls.push(row); bindings.push([...new Set(names)]);
  }
  return {metadata: {phase: 'BEFORE', controls}, bindings};
}"""


def expected(criteria):
    return [
        [CONTROLS[0], "#SearchBy-Control select", "SearchBy-Control", KEYS[0], "CalendarEvent"],
        [CONTROLS[1], "#JudicialDistrict-Control select", "JudicialDistrict-Control", KEYS[1], "05"],
        [CONTROLS[2], "#CourtOffice-Control select", "CourtOffice-Control", KEYS[2], criteria["courtOffice"]],
        [CONTROLS[3], "input[name=CalendarEventStartDate]", None, KEYS[3], criteria["startDate"]],
        [CONTROLS[4], "input[name=CalendarEventEndDate]", None, KEYS[4], criteria["endDate"]],
        [CONTROLS[5], "#CalendarEventType-Control select", "CalendarEventType-Control", KEYS[5], criteria["eventType"]],
    ]


async def snapshot(page, criteria):
    result = await page.evaluate(SNAPSHOT, {"expected": expected(criteria)})
    if not isinstance(result, dict) or "error" in result:
        code = result.get("error") if isinstance(result, dict) else None
        raise RuntimeError(code if code in {"CALENDAR_FORM_MISSING", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                                           "SOURCE_FORM_VALIDATION"} else "INSPECTION_METADATA_INVALID")
    # Names stay in child memory only; stdout/database receive metadata alone.
    bindings = result.get("bindings")
    if (not isinstance(bindings, list) or len(bindings) != 6
            or any(not isinstance(row, list) or len(row) > 32
                   or any(not isinstance(name, str) or len(name) > 128 or SENSITIVE.search(name)
                          for name in row) for row in bindings)):
        raise RuntimeError("INSPECTION_METADATA_INVALID")
    return result["metadata"], bindings


def local_post_metadata(before, bindings, criteria, body, content_type):
    if (not isinstance(body, str) or len(body.encode()) > 131072
            or content_type.split(";")[0].strip().lower() != "application/x-www-form-urlencoded"):
        raise RuntimeError("INSPECTION_BODY_UNSUPPORTED")
    try:
        fields = parse_qs(body, keep_blank_values=True, max_num_fields=128, errors="strict")
    except (ValueError, UnicodeError):
        raise RuntimeError("INSPECTION_BODY_UNSUPPORTED") from None
    rows = []
    for row, names, spec, key in zip(before["controls"], bindings, expected(criteria), KEYS):
        value = spec[-1]
        updated = {**row, "types": dict(row["types"])}
        updated["nativePostedMatches"] = sum(fields.get(name) == [value] for name in names)
        # Known public property suffixes only. This is observation, NOT an
        # inferred association or permission to alter the PDF validator.
        updated["knownKeyPostedMatches"] = sum(
            values == [value] for name, values in fields.items()
            if len(name) <= 128 and not SENSITIVE.search(name)
            and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", name)
            and (name == key or name.endswith("." + key)))
        rows.append(updated)
    return {"phase": "LOCAL_POST", "controls": rows}
