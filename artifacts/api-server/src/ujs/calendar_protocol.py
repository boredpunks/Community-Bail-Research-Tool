"""Calendar preflight and pacing helpers; never retain form/cookie contents."""
import math
from playwright.async_api import TimeoutError as BrowserTimeout
from source_protocol import CALENDAR_ASSETS

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
                   "COURT_OFFICE", "COURT_ROOM", "START_DATE", "END_DATE", "EVENT_TYPE")
CONTROL_REASONS = ("MISSING", "WRONG_FORM", "DISABLED", "UNNAMED", "VALUE_MISMATCH",
                   "BACKING_CONTROL_MISSING", "BACKING_CONTROL_AMBIGUOUS", "BACKING_VALUE_MISMATCH",
                   "OPTION_MISSING", "OPTION_AMBIGUOUS", "OPTION_DISABLED",
                   "CONTROL_AMBIGUOUS", "NO_FILTER_NOT_SELECTED", "HIDDEN",
                   "EMPTY", "FIELD_LIMIT", "OUTSIDE_SOURCE_RANGE")
SUBMITTED_REASONS = ("SUBMITTED_COUNT_MISMATCH", "SUBMITTED_VALUE_MISMATCH")
FORM_REASONS = {"CALENDAR_CONTROL_STATE_MISMATCH": CONTROL_REASONS,
                "CALENDAR_SUBMITTED_VALUES_MISMATCH": SUBMITTED_REASONS,
                "CALENDAR_FORM_MISSING": ("MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM"),
                "CALENDAR_FORM_INITIALIZATION_TIMEOUT": (
                    "MISSING", "CONTROL_AMBIGUOUS", "WRONG_FORM", "DISABLED", "HIDDEN"),
                "CALENDAR_FORM_STRUCTURE_CHANGED": ("MISSING", "EMPTY", "FIELD_LIMIT"),
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
            && !buttons[0].matches(":disabled") && buttons[0].checkVisibility();
        }""", timeout=CALENDAR_FORM_READY_TIMEOUT_MS)
    except BrowserTimeout as error:
        state = await page.evaluate("""() => {
          const buttons = [...document.querySelectorAll("#btnSearch")];
          const button = buttons.length === 1 ? buttons[0] : null;
          return {
            count: Math.min(buttons.length, 2),
            visible: button ? button.checkVisibility() : false,
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
          return buttons.length === 1 && buttons[0].checkVisibility();
        }""")
    except Exception:
        return False


async def calendar_form_field_count(page):
    """Bound successful controls without retaining names, tokens, or values."""
    result = await page.evaluate("""() => {
      const form = document.querySelector("#btnSearch")?.form;
      if (!form) return null;
      let count = 0;
      for (const _entry of new FormData(form)) {
        count += 1;
        if (count > 128) return count;
      }
      return count;
    }""")
    if result is None:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "MISSING")
    if not isinstance(result, int) or result < 1:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "EMPTY")
    if result > 128:
        raise CalendarFormFailure("CALENDAR_FORM_STRUCTURE_CHANGED", "FORM", "FIELD_LIMIT")
    return result


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
            if criteria.get("eventType") != "ANY":
                raise RuntimeError("CRITERIA_NOT_AVAILABLE_ON_SOURCE")
            raise CalendarFormFailure("CALENDAR_CONTROL_STATE_MISMATCH", control_name, reason)
        await page.locator(selector).select_option(value=result["value"])
        selected = await page.locator(selector).input_value()
        if selected != result["value"]:
            if criteria.get("eventType") != "ANY":
                raise RuntimeError("CRITERIA_NOT_AVAILABLE_ON_SOURCE")
            raise CalendarFormFailure(
                "CALENDAR_CONTROL_STATE_MISMATCH", control_name, "VALUE_MISMATCH")
        return selected

    if criteria.get("eventType") not in ("ANY", "Bail Hearing", "Preliminary Arraignment"):
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")

    search_mode = await select_exact_option(
        "#SearchBy-Control select", "Calendar Event", "SEARCH_MODE")
    judicial_district = await select_exact_option(
        "#JudicialDistrict-Control select", "Allegheny - 05", "JUDICIAL_DISTRICT")
    court_office = await select_exact_option(
        "#CourtOffice-Control select", criteria["courtOffice"], "COURT_OFFICE")
    court_room = None
    if criteria.get("courtRoom"):
        court_room = await select_exact_option(
            'select[name="CourtRoomID"]', criteria["courtRoom"], "COURT_ROOM")

    if criteria["eventType"] != "ANY":
        event_type = await select_exact_option(
            "#CalendarEventType-Control select", criteria["eventType"], "EVENT_TYPE")
        return {"searchMode": search_mode, "judicialDistrict": judicial_district,
                "courtOffice": court_office, "eventType": event_type,
                **({"courtRoom": court_room} if court_room else {})}
    if not court_room:
        raise RuntimeError("CALENDAR_PREFLIGHT_FAILED")

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
        if await control.count() != 1 or not await control.is_enabled():
            raise RuntimeError("CRITERIA_NOT_AVAILABLE_ON_SOURCE")
        # Native public constraints are source availability, not permission to
        # clamp a date. Missing/changed controls still fail closed.
        minimum = await control.get_attribute("min")
        maximum = await control.get_attribute("max")
        if ((minimum and criteria[key] < minimum)
                or (maximum and criteria[key] > maximum)):
            raise RuntimeError("CRITERIA_NOT_AVAILABLE_ON_SOURCE")
        await control.fill(criteria[key])
        await control.blur()
        if await control.input_value() != criteria[key]:
            raise RuntimeError("CRITERIA_NOT_AVAILABLE_ON_SOURCE")


def response_pause(last_completed, now, interval):
    """Response-completion jitter is bounded; the shared scheduler may wait longer."""
    if not math.isfinite(interval) or not 60 <= interval <= 90:
        raise ValueError("INVALID_RESPONSE_INTERVAL")
    if not math.isfinite(now) or last_completed is not None and not math.isfinite(last_completed):
        raise ValueError("INVALID_RESPONSE_CLOCK")
    return 0 if last_completed is None else max(0, last_completed + interval - now)
