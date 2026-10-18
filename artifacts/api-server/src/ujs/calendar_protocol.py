"""Calendar preflight and pacing helpers; never retain form/cookie contents."""
import math
import asyncio
import re
from playwright.async_api import TimeoutError as BrowserTimeout
from source_protocol import CALENDAR_ASSETS
from room_discovery import PUBLIC_ROOM_HELPERS

SEARCH_CLICK_TIMEOUT_MS = 180_000
CALENDAR_FORM_READY_TIMEOUT_MS = 15_000
CALENDAR_RESULT_TIMEOUT_MS = 45_000


def calendar_asset_barrier(loaded_assets, blocked_scripts, blocked_stylesheets,
                           blocked_requests, page_errors, console_errors=0):
    if blocked_scripts or blocked_stylesheets or blocked_requests:
        return "CALENDAR_REQUIRED_RESOURCE_BLOCKED"
    if not set(CALENDAR_ASSETS).issubset(loaded_assets):
        return "CALENDAR_REQUIRED_ASSET_MISSING"
    if page_errors:
        return "CALENDAR_SCRIPT_ERROR"
    if console_errors:
        return "CALENDAR_CONSOLE_ERROR"
    return None


def expected_optional_console_error(kind, text, location_url, blocked_optional_urls):
    """Only exact browser abort errors tied to our known optional-resource aborts."""
    return (kind == "error" and location_url in blocked_optional_urls
            and text in ("Failed to load resource: net::ERR_FAILED",
                         "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"))


PUBLIC_CONTROLS = ("SEARCH_BUTTON", "FORM", "SEARCH_MODE", "JUDICIAL_DISTRICT",
                   "COURT_OFFICE", "COURT_ROOM", "SCHEDULED_EVENTS_ONLY",
                   "START_DATE", "END_DATE", "EVENT_TYPE")
CONTROL_REASONS = ("MISSING", "WRONG_FORM", "DISABLED", "UNNAMED", "VALUE_MISMATCH",
                   "BACKING_CONTROL_MISSING", "BACKING_CONTROL_AMBIGUOUS", "BACKING_VALUE_MISMATCH",
                   "OPTION_MISSING", "OPTION_AMBIGUOUS", "OPTION_DISABLED",
                   "CONTROL_AMBIGUOUS", "NO_FILTER_NOT_SELECTED", "HIDDEN",
                   "ASSOCIATION_UNPROVEN", "SUBMITTED_FIELD_MISSING", "DISCOVERY_LIMIT")
SUBMITTED_REASONS = ("SUBMITTED_COUNT_MISMATCH", "SUBMITTED_VALUE_MISMATCH")
FORM_REASONS = {"CALENDAR_CONTROL_STATE_MISMATCH": CONTROL_REASONS,
                "CALENDAR_SUBMITTED_VALUES_MISMATCH": SUBMITTED_REASONS,
                "CALENDAR_FORM_MISSING": ("MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM"),
                "CALENDAR_FORM_INITIALIZATION_TIMEOUT": (
                    "MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM", "DISABLED", "HIDDEN"),
                "CALENDAR_FORM_STRUCTURE_CHANGED": ("MISSING", "EMPTY", "FIELD_LIMIT", "FIELD_NAME_LIMIT"),
                "CRITERIA_NOT_AVAILABLE_ON_SOURCE": (
                    "OPTION_MISSING", "OPTION_DISABLED", "OUTSIDE_SOURCE_RANGE")}
FORM_DIAGNOSTIC_PHASES = (
    "INITIALIZATION", "CONTROL_SELECTION", "DATE_ENTRY", "FINAL_VALIDATION", "SUBMISSION")


class CalendarFormFailure(RuntimeError):
    def __init__(self, code, control, reason, failures=None):
        super().__init__(code)
        self.control = control
        self.reason = reason
        self.failures = failures or [{"code": code, "control": control, "reason": reason}]


async def wait_for_calendar_search_button(page):
    """Wait for the usable Search button, not visibility of its containing form."""
    try:
        await page.wait_for_function("""() => {
          const buttons = [...document.querySelectorAll("#btnSearch")];
          return buttons.length === 1 && !!buttons[0].form
            && !buttons[0].matches(":disabled")
            && buttons[0].checkVisibility({visibilityProperty: true});
        }""", timeout=CALENDAR_FORM_READY_TIMEOUT_MS)
    except BrowserTimeout as error:
        state = await page.evaluate("""() => {
          const buttons = [...document.querySelectorAll("#btnSearch")];
          const button = buttons.length === 1 ? buttons[0] : null;
          return {
            count: Math.min(buttons.length, 2),
            visible: button ? button.checkVisibility({visibilityProperty: true}) : false,
            enabled: button ? !button.matches(":disabled") : false,
            associated: button ? !!button.form : false,
          };
        }""")
        if state["count"] == 0:
            reason = "MISSING"
        elif state["count"] > 1:
            reason = "CONTROL_AMBIGUOUS"
        elif not state["associated"]:
            reason = "WRONG_FORM"
        elif not state["enabled"]:
            reason = "DISABLED"
        else:
            reason = "HIDDEN"
        raise CalendarFormFailure(
            "CALENDAR_FORM_INITIALIZATION_TIMEOUT", "SEARCH_BUTTON", reason) from error


async def calendar_search_button_visible(page):
    """Return an observed visibility flag without leaking DOM content."""
    try:
        return await page.evaluate("""() => {
          const buttons = [...document.querySelectorAll("#btnSearch")];
          return buttons.length === 1 && buttons[0].checkVisibility({visibilityProperty: true});
        }""")
    except Exception:
        return None  # A closed/unreadable page is unknown, not an observed hidden button.


async def calendar_form_field_count(page):
    """Bound successful controls without retaining names, tokens, or values."""
    result = await page.evaluate("""() => {
      const form = document.querySelector("#btnSearch")?.form;
      if (!form) return null;
      let count = 0;
      for (const [name] of new FormData(form)) {
        if (name.length > 128) return -1;
        count += 1;
        if (count > 128) return count;
      }
      return count;
    }""")
    if result is None:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "MISSING")
    if result == -1:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "FIELD_NAME_LIMIT")
    if not isinstance(result, int) or result < 1:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "EMPTY")
    if result > 128:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "FIELD_LIMIT")
    return result


async def calendar_form_field_shape(page):
    """Historical inventory guard; keep paused inspection behavior unchanged."""
    result = await page.evaluate("""() => {
      const form = document.querySelector("#btnSearch")?.form;
      if (!form) return null;
      return [...new FormData(form).keys()].map(name =>
        /token|password|secret|session|cookie|captcha|verification|auth/i.test(name)
          ? "<sensitive>" : name);
    }""")
    if (not isinstance(result, list) or not 1 <= len(result) <= 128
            or any(not isinstance(name, str) or len(name) > 128 for name in result)):
        raise RuntimeError("CALENDAR_FORM_STRUCTURE_CHANGED")
    return tuple(result)


FORM_CHECK = """({expected}) => {
  const buttons = [...document.querySelectorAll("#btnSearch")];
  if (buttons.length !== 1) return {failures: [{
    code: "CALENDAR_FORM_MISSING", control: "SEARCH_BUTTON",
    reason: buttons.length === 0 ? "MISSING" : "CONTROL_AMBIGUOUS"}]};
  const button = buttons[0];
  const form = button?.form;
  if (!form) return {failures: [{
    code: "CALENDAR_FORM_MISSING", control: "SEARCH_BUTTON", reason: "WRONG_FORM"}]};
  if (!button.checkVisibility({visibilityProperty: true})) return {failures: [{
    code: "CALENDAR_CONTROL_STATE_MISMATCH", control: "SEARCH_BUTTON", reason: "HIDDEN"}]};
  if (button.matches(":disabled")) return {failures: [{
    code: "CALENDAR_CONTROL_STATE_MISMATCH", control: "SEARCH_BUTTON", reason: "DISABLED"}]};
  const action = new URL(button.getAttribute("formaction") || form.action, document.baseURI);
  if (action.href !== "https://ujsportal.pacourts.us/CaseSearch"
      || (button.getAttribute("formmethod") || form.method).toLowerCase() !== "post"
      || (button.getAttribute("formenctype") || form.enctype).toLowerCase()
        !== "application/x-www-form-urlencoded")
    return "UNSUPPORTED_CALENDAR_FORM_TARGET";
  if (!form.checkValidity()) return "SOURCE_FORM_VALIDATION";
  const data = new FormData(form);
  const failures = [];
  const verifiedFields = [];
  const fail = (code, control, reason) => failures.push({code, control, reason});
  for (const [selector, value, name, containerSelector] of expected) {
    const controls = [...document.querySelectorAll(selector)];
    const control = controls[0];
    const reason = !control ? "MISSING"
      : controls.length !== 1 ? "CONTROL_AMBIGUOUS"
      : control.form !== form ? "WRONG_FORM"
      : control.matches(":disabled") ? "DISABLED"
      : control.value !== value ? "VALUE_MISMATCH" : null;
    if (reason) {
      fail("CALENDAR_CONTROL_STATE_MISMATCH", name, reason);
      continue;
    }
    let submittedControl = control;
    if (!control.name) {
      // A UI-only select may use a hidden or text model input. Inspect the DOM
      // input type property, not a required type attribute (text is the default).
      // Do not invent a server field name or search outside this widget.
      if (!containerSelector) {
        fail("CALENDAR_CONTROL_STATE_MISMATCH", name, "UNNAMED");
        continue;
      }
      const container = document.querySelector(containerSelector);
      const backing = container?.contains(control)
        ? [...container.querySelectorAll("input[name]")].filter(
            field => ["hidden", "text"].includes(field.type)
              && field.name && field.form === form && !field.matches(":disabled"))
        : [];
      if (backing.length !== 1) {
        fail("CALENDAR_CONTROL_STATE_MISMATCH", name,
          backing.length === 0 ? "BACKING_CONTROL_MISSING" : "BACKING_CONTROL_AMBIGUOUS");
        continue;
      }
      submittedControl = backing[0];
      if (submittedControl.value !== value) {
        fail("CALENDAR_CONTROL_STATE_MISMATCH", name, "BACKING_VALUE_MISMATCH");
        continue;
      }
    }
    const submitted = data.getAll(submittedControl.name);
    if (submitted.length !== 1 || submitted[0] !== value)
      fail("CALENDAR_SUBMITTED_VALUES_MISMATCH", name,
        submitted.length !== 1 ? "SUBMITTED_COUNT_MISMATCH" : "SUBMITTED_VALUE_MISMATCH");
    else verifiedFields.push({name: submittedControl.name, value: submitted[0]});
  }
  return failures.length ? {failures} : {verifiedFields};
}"""

def valid_form_failure(value):
    return (isinstance(value, dict) and set(value) == {"code", "control", "reason"}
            and isinstance(value.get("code"), str) and value.get("control") in PUBLIC_CONTROLS
            and value.get("reason") in FORM_REASONS.get(value["code"], ()))


async def validate_calendar_form(page, criteria, selected_values=None):
    # Compare only the intended public controls, in memory. Hidden tokens remain
    # under normal browser handling and are never returned or logged.
    selected_values = selected_values or {}
    expected = [
        ["#SearchBy-Control select", selected_values.get("searchMode", "CalendarEvent"), "SEARCH_MODE", "#SearchBy-Control"],
        ["#JudicialDistrict-Control select", selected_values.get("judicialDistrict", "05"), "JUDICIAL_DISTRICT", "#JudicialDistrict-Control"],
        ["#CourtOffice-Control select", selected_values.get("courtOffice", criteria["courtOffice"]), "COURT_OFFICE", "#CourtOffice-Control"],
        ["input[name=CalendarEventStartDate]", criteria["startDate"], "START_DATE", None],
        ["input[name=CalendarEventEndDate]", criteria["endDate"], "END_DATE", None],
        ["#CalendarEventType-Control select", selected_values.get("eventType", criteria["eventType"]), "EVENT_TYPE", "#CalendarEventType-Control"],
    ]
    if criteria.get("courtRoom") or "courtRoom" in selected_values:
        expected.insert(3, ['select[name="CourtRoomID"]',
                            selected_values.get("courtRoom", criteria.get("courtRoom", "")),
                            "COURT_ROOM", None])
    result = await page.evaluate(FORM_CHECK, {"expected": expected})
    if isinstance(result, dict):
        failures = result.get("failures")
        if (set(result) == {"failures"} and isinstance(failures, list) and 1 <= len(failures) <= len(PUBLIC_CONTROLS)
                and all(valid_form_failure(failure) for failure in failures)
                and len({failure["control"] for failure in failures}) == len(failures)):
            first = failures[0]
            raise CalendarFormFailure(first["code"], first["control"], first["reason"], failures)
        fields = result.get("verifiedFields")
        if (set(result) == {"verifiedFields"} and isinstance(fields, list)
                and len(fields) == len(expected)
                and all(isinstance(field, dict) and set(field) == {"name", "value"}
                        and isinstance(field["name"], str) and 1 <= len(field["name"]) <= 128
                        and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}", field["name"])
                        and not re.search(r"token|password|secret|session|cookie|captcha|verification|auth",
                                          field["name"], re.I)
                        and isinstance(field["value"], str)
                        for field in fields)
                and len({field["name"] for field in fields}) == len(fields)
                and all(field["value"] == spec[1]
                        for field, spec in zip(fields, expected, strict=True))):
            return tuple((field["name"], field["value"]) for field in fields)
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")
    if not isinstance(result, dict):
        raise RuntimeError(result if isinstance(result, str) and result.startswith(
            ("CALENDAR_", "SOURCE_FORM_", "UNSUPPORTED_CALENDAR_")) else "CALENDAR_PREFLIGHT_FAILED")


async def select_bound_calendar_controls(page, criteria):
    """Current method: resolve the observed public room, not a presumed field."""
    other = {key: value for key, value in criteria.items() if key != "courtRoom"}
    values = await select_calendar_preview_controls(page, other)
    if criteria.get("courtRoom") not in (None, "", "ANY"):
        if criteria["courtRoom"] != "Courtroom 506":
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM", "OPTION_MISSING")
        from courtroom_observation import PROBE
        deadline = asyncio.get_running_loop().time() + 15
        selected = False
        stable_since = None
        previous = None
        while True:
            state = await page.evaluate(PROBE, {"select506": False})
            if not isinstance(state, dict) or "error" in state:
                raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM", "WRONG_FORM")
            ready = (state["labels"] == 1 and state["controls"] == 1 and state["enabled"]
                     and state["sameForm"] and not state["busy"]
                     and state["room506Options"] == 1 and state["room506Enabled"])
            now = asyncio.get_running_loop().time()
            if state != previous:
                previous, stable_since = state, now
            stable = now - stable_since >= 0.5
            if ready and stable:
                if not selected:
                    await page.evaluate(PROBE, {"select506": True})
                    selected, previous = True, None
                    continue
                if state["room506Selected"] and state["namedBindings"] == 1 and state["nativeMatches"]:
                    values["courtRoom"] = "Courtroom 506"  # Public criterion, never a native value.
                    break
            if now >= deadline:
                reason = ("CONTROL_AMBIGUOUS" if state["labels"] > 1 or state["controls"] > 1
                          else "MISSING" if not state["labels"] or not state["controls"]
                          else "DISABLED" if not state["enabled"] or state["busy"]
                          else "OPTION_MISSING" if state["room506Options"] != 1
                          else "OPTION_DISABLED" if not state["room506Enabled"]
                          else "BACKING_VALUE_MISMATCH")
                raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM", reason)
            await asyncio.sleep(0.05)
    return values


async def validate_bound_calendar_form(page, criteria, selected_values):
    if criteria.get("courtRoom") == "ANY":
        submitted_fields = await validate_calendar_form(
            page, {k: v for k, v in criteria.items() if k != "courtRoom"},
            {k: v for k, v in selected_values.items() if k != "courtRoom"})
        additional_fields = await validate_unfiltered_room_and_schedule(page)
        names = {name for name, _ in submitted_fields}
        if any(name in names for name, _ in additional_fields):
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM",
                                      "BACKING_CONTROL_AMBIGUOUS")
        return submitted_fields + additional_fields
    if not criteria.get("courtRoom"):
        return await validate_calendar_form(page, criteria, selected_values)
    from courtroom_observation import PROBE
    # Keep the frozen inspection validator intact. Check other fields with its
    # existing native FormData checks, then rediscover and validate the room.
    submitted_fields = await validate_calendar_form(
        page, {k: v for k, v in criteria.items() if k != "courtRoom"},
        {k: v for k, v in selected_values.items() if k != "courtRoom"})
    state = await page.evaluate(PROBE, {"select506": False, "includeSubmissionField": True})
    if (criteria["courtRoom"] != "Courtroom 506" or not isinstance(state, dict)
            or "error" in state or state["labels"] != 1 or state["controls"] != 1
            or not all(state[k] for k in ("enabled", "sameForm", "room506Enabled",
                                          "room506Selected", "nativeMatches"))
            or state["busy"] or state["room506Options"] != 1 or state["namedBindings"] != 1):
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM", "BACKING_VALUE_MISMATCH")
    binding = state.get("submittedBinding") if isinstance(state, dict) else None
    if (not isinstance(binding, dict) or set(binding) != {"name", "value"}
            or not isinstance(binding["name"], str) or not re.fullmatch(
                r"[A-Za-z][A-Za-z0-9_.-]{0,127}", binding["name"])
            or re.search(r"token|password|secret|session|cookie|captcha|verification|auth",
                         binding["name"], re.I)
            or not isinstance(binding["value"], str)
            or len({name for name, _ in submitted_fields} | {binding["name"]})
               != len(submitted_fields) + 1):
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM", "BACKING_VALUE_MISMATCH")
    return submitted_fields + ((binding["name"], binding["value"]),)


async def validate_unfiltered_room_and_schedule(page):
    result = await page.evaluate("() => {" + PUBLIC_ROOM_HELPERS + r"""
      const buttons = [...document.querySelectorAll("#btnSearch")];
      const form = buttons.length === 1 ? buttons[0].form : null;
      if (!form) return {control: "COURT_ROOM",
        reason: buttons.length > 1 ? "CONTROL_AMBIGUOUS" : "MISSING"};
      const discovered = discoverPublicRoom(form);
      if (discovered.limit) return {control: "COURT_ROOM", reason: "DISCOVERY_LIMIT"};
      if (discovered.reason) return {control: "COURT_ROOM", reason: discovered.reason};
      const select = discovered.select;
      if (select.matches(":disabled")) return {control: "COURT_ROOM", reason: "DISABLED"};
      if (!select.getClientRects().length) return {control: "COURT_ROOM", reason: "HIDDEN"};
      const blank = [...select.options].filter(option => option.value === "");
      if (blank.length !== 1) return {control: "COURT_ROOM",
        reason: blank.length ? "OPTION_AMBIGUOUS" : "OPTION_MISSING"};
      if (blank[0].disabled || blank[0].closest("optgroup")?.disabled)
        return {control: "COURT_ROOM", reason: "OPTION_DISABLED"};
      if (select.multiple || select.value !== "" || select.selectedOptions.length !== 1
          || select.selectedOptions[0] !== blank[0])
        return {control: "COURT_ROOM", reason: "NO_FILTER_NOT_SELECTED"};
      const room = publicRoomBinding(form, select, discovered.group);
      if (room.reason) return {control: "COURT_ROOM", reason: room.reason};
      const normalize = label => label.textContent.replace(/[:\s]+$/g, "").trim();
      const oneLabel = text => {
        const matches = [...document.querySelectorAll("label")].filter(label =>
          (form.contains(label) || label.control?.form === form) && normalize(label) === text);
        return matches.length === 1 ? matches[0] : null;
      };
      const inspect = (labelText, controlName) => {
        const label = oneLabel(labelText);
        if (!label) return {control: controlName, reason: "MISSING"};
        const control = label.control;
        if (!control) return {control: controlName, reason: "ASSOCIATION_UNPROVEN"};
        if (control.form !== form) return {control: controlName, reason: "WRONG_FORM"};
        if (control.matches(":disabled")) return {control: controlName, reason: "DISABLED"};
        if (!label.getClientRects().length || !control.getClientRects().length)
          return {control: controlName, reason: "HIDDEN"};
        if (control.type !== "checkbox" || !control.checked) {
          return {control: controlName, reason: "VALUE_MISMATCH"};
        }
        if (!control.name || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(control.name)
            || /token|password|secret|session|cookie|captcha|verification|auth/i.test(control.name))
          return {control: controlName, reason: "UNNAMED"};
        const value = control.value;
        const values = new FormData(form).getAll(control.name);
        if (!values.length) return {control: controlName, reason: "SUBMITTED_FIELD_MISSING"};
        if (values.length !== 1 || values[0] !== value)
          return {control: controlName, reason: "BACKING_VALUE_MISMATCH"};
        return {name: control.name, value};
      };
      const schedule = inspect("Scheduled Events Only", "SCHEDULED_EVENTS_ONLY");
      if (schedule.reason) return schedule;
      if (room.name === schedule.name) return {control: "SCHEDULED_EVENTS_ONLY", reason: "BACKING_CONTROL_AMBIGUOUS"};
      return {bindings: [
        {name: room.name, value: room.value},
        {name: schedule.name, value: schedule.value},
      ]};
    }""")
    if not isinstance(result, dict) or set(result) != {"bindings"}:
        control = result.get("control") if isinstance(result, dict) else None
        reason = result.get("reason") if isinstance(result, dict) else None
        if control not in ("COURT_ROOM", "SCHEDULED_EVENTS_ONLY"):
            control = "COURT_ROOM"
        if reason not in CONTROL_REASONS:
            reason = "BACKING_VALUE_MISMATCH"
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", control, reason)
    bindings = result["bindings"]
    if (not isinstance(bindings, list) or len(bindings) != 2
            or any(not isinstance(row, dict) or set(row) != {"name", "value"}
                   or not isinstance(row["name"], str) or not re.fullmatch(
                       r"[A-Za-z][A-Za-z0-9_.-]{0,127}", row["name"])
                   or re.search(r"token|password|secret|session|cookie|captcha|verification|auth",
                                row["name"], re.I)
                   or not isinstance(row["value"], str) for row in bindings)
            or len({row["name"] for row in bindings}) != 2):
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM",
                                  "BACKING_VALUE_MISMATCH")
    return tuple((row["name"], row["value"]) for row in bindings)


async def select_calendar_preview_controls(page, criteria):
    """Resolve only exact public labels from the served form; never guess values."""
    async def select_exact_option(selector, label, control_name):
        result = await page.evaluate("""({selector, label}) => {
          const controls = [...document.querySelectorAll(selector)];
          if (!controls.length) return {reason: "MISSING"};
          if (controls.length !== 1) return {reason: "CONTROL_AMBIGUOUS"};
          const control = controls[0];
          const form = document.querySelector("#btnSearch")?.form;
          if (!form || control.form !== form) return {reason: "WRONG_FORM"};
          if (control.matches(":disabled")) return {reason: "DISABLED"};
          const options = [...control.options].filter(option => option.label.trim() === label);
          if (!options.length) return {reason: "OPTION_MISSING"};
          if (options.length !== 1) return {reason: "OPTION_AMBIGUOUS"};
          if (options[0].disabled) return {reason: "OPTION_DISABLED"};
          return {value: options[0].value};
        }""", {"selector": selector, "label": label})
        if not isinstance(result, dict) or set(result) != {"value"} or not isinstance(result["value"], str):
            reason = result.get("reason") if isinstance(result, dict) else None
            if reason not in CONTROL_REASONS:
                reason = "OPTION_MISSING"
            if (reason in ("OPTION_MISSING", "OPTION_DISABLED")
                    and control_name in ("COURT_OFFICE", "EVENT_TYPE")
                    and criteria.get("eventType") != "ANY"):
                raise CalendarFormFailure(
                    "CRITERIA_NOT_AVAILABLE_ON_SOURCE", control_name, reason)
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", control_name, reason)
        await page.locator(selector).select_option(value=result["value"])
        selected = await page.locator(selector).input_value()
        if selected != result["value"]:
            raise CalendarFormFailure(
                "CALENDAR_CONTROL_STATE_MISMATCH", control_name, "VALUE_MISMATCH")
        return selected

    if criteria.get("eventType") not in ("ANY", "Bail Hearing", "Preliminary Arraignment"):
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")

    async def select_no_filter(selector, control_name):
        state = await page.evaluate("""(selector) => {
          const controls = [...document.querySelectorAll(selector)];
          if (controls.length !== 1) return {reason: controls.length ? "CONTROL_AMBIGUOUS" : "MISSING"};
          const control = controls[0];
          const form = document.querySelector("#btnSearch")?.form;
          if (!form || control.form !== form) return {reason: "WRONG_FORM"};
          if (control.matches(":disabled")) return {reason: "DISABLED"};
          const blanks = [...control.options].filter(option => option.value === "");
          if (blanks.length !== 1) return {reason: blanks.length ? "OPTION_AMBIGUOUS" : "OPTION_MISSING"};
          if (blanks[0].disabled) return {reason: "OPTION_DISABLED"};
          if (control.value !== "" || control.selectedOptions.length !== 1
              || control.selectedOptions[0] !== blanks[0]) return {reason: "NO_FILTER_NOT_SELECTED"};
          return {value: ""};
        }""", selector)
        if state != {"value": ""}:
            reason = state.get("reason") if isinstance(state, dict) else None
            if reason not in CONTROL_REASONS:
                reason = "OPTION_MISSING"
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", control_name, reason)
        return ""

    search_mode = await select_exact_option(
        "#SearchBy-Control select", "Calendar Event", "SEARCH_MODE")
    judicial_district = await select_exact_option(
        "#JudicialDistrict-Control select", "Allegheny - 05", "JUDICIAL_DISTRICT")
    court_office = (await select_no_filter("#CourtOffice-Control select", "COURT_OFFICE")
                    if criteria["courtOffice"] == "ANY"
                    else await select_exact_option(
                        "#CourtOffice-Control select", criteria["courtOffice"], "COURT_OFFICE"))
    court_room = criteria.get("courtRoom")
    if court_room and court_room != "ANY":
        court_room = await select_exact_option(
            'select[name="CourtRoomID"]', criteria["courtRoom"], "COURT_ROOM")
    event_type = (await select_no_filter("#CalendarEventType-Control select", "EVENT_TYPE")
                  if criteria["eventType"] == "ANY"
                  else await select_exact_option(
                      "#CalendarEventType-Control select", criteria["eventType"], "EVENT_TYPE"))
    return {
        "searchMode": search_mode,
        "judicialDistrict": judicial_district,
        "courtOffice": court_office,
        "courtRoom": court_room,
        "eventType": event_type,
    }


async def submit_calendar_search(page):
    # Commit, not full load: result-page assets must not consume the submission
    # deadline. This guard still allows the routed POST's pre-request pacing.
    # Register completion before clicking so a fast, fulfilled response cannot
    # race the listener. Use the public event waiter, not Response.finished():
    # pinned Playwright leaves the latter's target-close task pending.
    async with page.expect_event(
        "requestfinished",
        predicate=lambda request: (
            request.method == "POST" and request.is_navigation_request()
            and request.frame == page.main_frame
            and request.url == "https://ujsportal.pacourts.us/CaseSearch"
        ),
        timeout=SEARCH_CLICK_TIMEOUT_MS,
    ) as completed:
        async with page.expect_navigation(
            wait_until="commit", timeout=SEARCH_CLICK_TIMEOUT_MS
        ) as navigation:
            await page.locator("#btnSearch").click(
                timeout=SEARCH_CLICK_TIMEOUT_MS, no_wait_after=True)
    response = await navigation.value
    request = await completed.value
    if response is None or response.request != request:
        raise RuntimeError("SUBMISSION_NOT_OBSERVED")
    # Start the result deadline only after the POST body finishes. No exact
    # source empty marker has been captured, so do not invent one here.
    await page.locator("#caseSearchResultGrid").wait_for(
        state="attached", timeout=CALENDAR_RESULT_TIMEOUT_MS)


async def fill_calendar_dates(page, criteria):
    # Blur each control so native change handlers run before the final readback.
    # Locators are resolved anew after any dependent-control replacement.
    for name, key in (("CalendarEventStartDate", "startDate"),
                      ("CalendarEventEndDate", "endDate")):
        control = page.locator(f"input[name={name}]")
        label = "START_DATE" if key == "startDate" else "END_DATE"
        count = await control.count()
        if count != 1:
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", label,
                                      "MISSING" if count == 0 else "CONTROL_AMBIGUOUS")
        if not await control.is_enabled():
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", label, "DISABLED")
        if not await control.evaluate(
                "(el) => !!el.form && el.form === document.querySelector('#btnSearch')?.form"):
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", label, "WRONG_FORM")
        # Native public constraints are source availability, not permission to
        # clamp a date. Missing/changed controls still fail closed.
        minimum = await control.get_attribute("min")
        maximum = await control.get_attribute("max")
        if ((minimum and criteria[key] < minimum)
                or (maximum and criteria[key] > maximum)):
            raise CalendarFormFailure(
                "CRITERIA_NOT_AVAILABLE_ON_SOURCE", label, "OUTSIDE_SOURCE_RANGE")
        await control.fill(criteria[key])
        await control.blur()
        if await control.input_value() != criteria[key]:
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", label, "VALUE_MISMATCH")


def response_pause(last_completed, now, interval):
    """Response-completion jitter is bounded; the shared scheduler may wait longer."""
    if not math.isfinite(interval) or not 60 <= interval <= 90:
        raise ValueError("INVALID_RESPONSE_INTERVAL")
    if not math.isfinite(now) or last_completed is not None and not math.isfinite(last_completed):
        raise ValueError("INVALID_RESPONSE_CLOCK")
    return 0 if last_completed is None else max(0, last_completed + interval - now)


async def validate_unfiltered_calendar_room(page):
    """No criterion is not proof of no source filter; never reset a chosen room."""
    reason = await page.evaluate("""() => {
      const controls = [...document.querySelectorAll('select[name="CourtRoomID"]')];
      if (!controls.length) return "MISSING";
      if (controls.length !== 1) return "CONTROL_AMBIGUOUS";
      const control = controls[0], form = document.querySelector("#btnSearch")?.form;
      if (!form || control.form !== form) return "WRONG_FORM";
      if (control.matches(":disabled")) return "DISABLED";
      const blanks = [...control.options].filter(option =>
        option.value === "" && option.label.trim() === "");
      if (!blanks.length) return "OPTION_MISSING";
      if (blanks.length !== 1) return "OPTION_AMBIGUOUS";
      if (blanks[0].disabled) return "OPTION_DISABLED";
      return control.selectedOptions.length === 1 && control.selectedOptions[0] === blanks[0]
        ? null : "NO_FILTER_NOT_SELECTED";
    }""")
    if reason is not None:
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "COURT_ROOM",
                                  reason if reason in CONTROL_REASONS else "OPTION_MISSING")
