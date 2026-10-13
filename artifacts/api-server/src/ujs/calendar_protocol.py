"""Calendar preflight and pacing helpers; never retain form/cookie contents."""
import math
from source_protocol import CALENDAR_ASSETS

SEARCH_CLICK_TIMEOUT_MS = 180_000


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


PUBLIC_CONTROLS = ("SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE",
                   "COURT_ROOM", "START_DATE", "END_DATE", "EVENT_TYPE")
CONTROL_REASONS = ("MISSING", "WRONG_FORM", "DISABLED", "UNNAMED", "VALUE_MISMATCH",
                   "BACKING_CONTROL_MISSING", "BACKING_CONTROL_AMBIGUOUS", "BACKING_VALUE_MISMATCH",
                   "OPTION_MISSING", "OPTION_AMBIGUOUS", "OPTION_DISABLED",
                   "CONTROL_AMBIGUOUS", "NO_FILTER_NOT_SELECTED")
SUBMITTED_REASONS = ("SUBMITTED_COUNT_MISMATCH", "SUBMITTED_VALUE_MISMATCH")
FORM_REASONS = {"CALENDAR_CONTROL_STATE_MISMATCH": CONTROL_REASONS,
                "CALENDAR_SUBMITTED_VALUES_MISMATCH": SUBMITTED_REASONS}


class CalendarFormFailure(RuntimeError):
    def __init__(self, code, control, reason, failures=None):
        super().__init__(code)
        self.control = control
        self.reason = reason
        self.failures = failures or [{"code": code, "control": control, "reason": reason}]


async def calendar_form_field_shape(page):
    """Keep only ordered field names, never values, tokens, or request bodies."""
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
  const button = document.querySelector("#btnSearch");
  const form = button?.form;
  if (!form) return "CALENDAR_FORM_MISSING";
  const action = new URL(button.getAttribute("formaction") || form.action, document.baseURI);
  if (action.href !== "https://ujsportal.pacourts.us/CaseSearch"
      || (button.getAttribute("formmethod") || form.method).toLowerCase() !== "post"
      || (button.getAttribute("formenctype") || form.enctype).toLowerCase()
        !== "application/x-www-form-urlencoded")
    return "UNSUPPORTED_CALENDAR_FORM_TARGET";
  if (button.matches(":disabled") || !form.checkValidity()) return "SOURCE_FORM_VALIDATION";
  const data = new FormData(form);
  const failures = [];
  const fail = (code, control, reason) => failures.push({code, control, reason});
  for (const [selector, value, name, containerSelector] of expected) {
    const control = document.querySelector(selector);
    const reason = !control ? "MISSING"
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
  }
  return failures.length ? {failures} : "OK";
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
    if criteria.get("courtRoom"):
        expected.insert(3, ['select[name="CourtRoomID"]',
                            selected_values.get("courtRoom", criteria["courtRoom"]),
                            "COURT_ROOM", None])
    result = await page.evaluate(FORM_CHECK, {"expected": expected})
    if isinstance(result, dict):
        failures = result.get("failures")
        if (set(result) == {"failures"} and isinstance(failures, list) and 1 <= len(failures) <= len(PUBLIC_CONTROLS)
                and all(valid_form_failure(failure) for failure in failures)
                and len({failure["control"] for failure in failures}) == len(failures)):
            first = failures[0]
            raise CalendarFormFailure(first["code"], first["control"], first["reason"], failures)
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")
    if result != "OK":
        raise RuntimeError(result if isinstance(result, str) and result.startswith(
            ("CALENDAR_", "SOURCE_FORM_", "UNSUPPORTED_CALENDAR_")) else "CALENDAR_PREFLIGHT_FAILED")


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
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", control_name, reason)
        await page.locator(selector).select_option(value=result["value"])
        selected = await page.locator(selector).input_value()
        if selected != result["value"]:
            raise CalendarFormFailure(
                "CALENDAR_CONTROL_STATE_MISMATCH", control_name, "VALUE_MISMATCH")
        return selected

    if criteria.get("eventType") != "ANY" or not criteria.get("courtRoom"):
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")

    search_mode = await select_exact_option(
        "#SearchBy-Control select", "Calendar Event", "SEARCH_MODE")
    judicial_district = await select_exact_option(
        "#JudicialDistrict-Control select", "Allegheny - 05", "JUDICIAL_DISTRICT")
    court_office = await select_exact_option(
        "#CourtOffice-Control select", criteria["courtOffice"], "COURT_OFFICE")
    court_room = await select_exact_option(
        'select[name="CourtRoomID"]', criteria["courtRoom"], "COURT_ROOM")

    # "ANY" is an application sentinel, never a source value. The served form
    # must already expose and select one unique empty no-filter option.
    no_filter = await page.evaluate("""() => {
      const controls = [...document.querySelectorAll("#CalendarEventType-Control select")];
      if (!controls.length) return {reason: "MISSING"};
      if (controls.length !== 1) return {reason: "CONTROL_AMBIGUOUS"};
      const control = controls[0];
      const form = document.querySelector("#btnSearch")?.form;
      if (!form || control.form !== form) return {reason: "WRONG_FORM"};
      if (control.matches(":disabled")) return {reason: "DISABLED"};
      const blanks = [...control.options].filter(option => option.value === "" && option.label.trim() === "");
      if (!blanks.length) return {reason: "OPTION_MISSING"};
      if (blanks.length !== 1) return {reason: "OPTION_AMBIGUOUS"};
      if (blanks[0].disabled) return {reason: "OPTION_DISABLED"};
      if (control.selectedOptions.length !== 1 || control.selectedOptions[0] !== blanks[0])
        return {reason: "NO_FILTER_NOT_SELECTED"};
      return {value: ""};
    }""")
    if not isinstance(no_filter, dict) or no_filter != {"value": ""}:
        reason = no_filter.get("reason") if isinstance(no_filter, dict) else None
        if reason not in CONTROL_REASONS:
            reason = "OPTION_MISSING"
        raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", "EVENT_TYPE", reason)
    return {
        "searchMode": search_mode,
        "judicialDistrict": judicial_district,
        "courtOffice": court_office,
        "courtRoom": court_room,
        "eventType": "",
    }


async def submit_calendar_search(page):
    # Request pacing happens inside the routed request. The click timeout must
    # exceed the 60–90 second pre-request wait or Playwright cancels it locally.
    async with page.expect_navigation(
        wait_until="load", timeout=SEARCH_CLICK_TIMEOUT_MS
    ):
        await page.locator("#btnSearch").click(timeout=SEARCH_CLICK_TIMEOUT_MS)


async def fill_calendar_dates(page, criteria):
    # Blur each control so native change handlers run before the final readback.
    # Locators are resolved anew after any dependent-control replacement.
    for name, key in (("CalendarEventStartDate", "startDate"),
                      ("CalendarEventEndDate", "endDate")):
        control = page.locator(f"input[name={name}]")
        await control.fill(criteria[key])
        await control.blur()


def response_pause(last_completed, now, interval):
    """Response-completion jitter is bounded; the shared scheduler may wait longer."""
    if not math.isfinite(interval) or not 60 <= interval <= 90:
        raise ValueError("INVALID_RESPONSE_INTERVAL")
    if not math.isfinite(now) or last_completed is not None and not math.isfinite(last_completed):
        raise ValueError("INVALID_RESPONSE_CLOCK")
    return 0 if last_completed is None else max(0, last_completed + interval - now)
