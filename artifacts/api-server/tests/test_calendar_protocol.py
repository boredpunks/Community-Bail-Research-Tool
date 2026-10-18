"""Offline public-form checks only. No docket rows or outbound source requests."""
import asyncio
import shutil
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import calendar_protocol
from calendar_protocol import response_pause, validate_calendar_form, submit_calendar_search, calendar_asset_barrier, fill_calendar_dates, expected_optional_console_error, CalendarFormFailure, select_calendar_preview_controls, calendar_form_field_count, validate_unfiltered_calendar_room
from source_protocol import CALENDAR_ASSETS
from evidence import calendar_result_state
from evidence import CALENDAR_AUDIT_HEADERS, CalendarResults, validate_event_date
from worker import valid_bounded_engine_scope


SYNTHETIC_HEADER_ONLY_CALENDAR = """<!-- synthetic parser fixture; public headers only, no docket/case rows -->
<form id="calendarSearch"><button id="btnSearch">Search</button></form>
<table id="caseSearchResultGrid"><thead><tr>{headers}</tr></thead><tbody></tbody></table>"""


class FormDiagnosticProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_failures_are_bounded_and_redacted(self):
        class Page:
            async def evaluate(self, _script, _args):
                return self.result

        page = Page()
        criteria = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
                    "startDate": "2026-10-06", "endDate": "2026-10-12"}
        failure = {"code": "CALENDAR_CONTROL_STATE_MISMATCH", "control": "SEARCH_MODE", "reason": "UNNAMED"}
        malformed = [
            {"failures": []},
            {"failures": [failure] * 7},
            {"failures": [failure, failure]},
            {"failures": [{**failure, "control": "unrecognized-field"}]},
            {"failures": [{**failure, "reason": "unclassified text"}]},
            {"failures": [{**failure, "code": ["invalid"]}]},
            {"failures": [{**failure, "value": "not-allowed"}]},
            {"failures": [failure], "html": "not-allowed"},
        ]
        for result in malformed:
            with self.subTest(result=result):
                page.result = result
                with self.assertRaisesRegex(RuntimeError, "^CALENDAR_PREFLIGHT_FAILED$"):
                    await validate_calendar_form(page, criteria)
        second = {**failure, "control": "COURT_OFFICE", "reason": "DISABLED"}
        page.result = {"failures": [failure, second]}
        with self.assertRaises(CalendarFormFailure) as error:
            await validate_calendar_form(page, criteria)
        self.assertEqual(error.exception.failures, [failure, second])
        self.assertEqual(str(error.exception), "CALENDAR_CONTROL_STATE_MISMATCH")


class BoundedEngineScopeTests(unittest.TestCase):
    def test_bounded_engine_scope_enforces_per_permit_request_cap(self):
        criteria = {
            "courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
            "courtRoom": "Courtroom 506", "recordCap": 5,
            "calendarPreviewOnly": False,
        }
        self.assertTrue(valid_bounded_engine_scope({**criteria, "requestCap": 8}))
        self.assertTrue(valid_bounded_engine_scope({**criteria, "requestCap": 12}))
        self.assertFalse(valid_bounded_engine_scope({**criteria, "requestCap": 7}))
        self.assertFalse(valid_bounded_engine_scope({**criteria, "requestCap": 13}))
        self.assertFalse(valid_bounded_engine_scope({**criteria, "requestCap": True}))


class CalendarStructureTests(unittest.TestCase):
    def setUp(self):
        names = ["Column"] * 18
        for index, name in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                            9: "County", 10: "Court Office", 14: "Event Type"}.items():
            names[index] = name
        self.html = SYNTHETIC_HEADER_ONLY_CALENDAR.format(
            headers="".join(f"<th>{name}</th>" for name in names))
        self.criteria = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
                         "startDate": "2026-10-06", "endDate": "2026-10-12"}

    def test_form_can_remain_visible_but_empty_table_is_not_success_or_empty_search(self):
        parser = CalendarResults()
        parser.feed(self.html)
        self.assertTrue(parser.table_found)
        self.assertEqual(parser.validated(self.criteria), [])
        self.assertEqual(parser.validated_column_headers, CALENDAR_AUDIT_HEADERS)
        self.assertNotIn("Column", parser.validated_column_headers)
        self.assertEqual(calendar_result_state(parser.table_found, [], False),
                         "RESULTS_NOT_VALIDATED")

    def test_any_event_type_keeps_filter_unrestricted(self):
        parser = CalendarResults()
        parser.feed(self.html)
        criteria = {**self.criteria, "eventType": "ANY"}
        self.assertEqual(parser.validated(criteria), [])
        self.assertEqual(calendar_result_state(parser.table_found, [], False),
                         "RESULTS_NOT_VALIDATED")

    def test_unknown_table_layout_is_not_validated(self):
        parser = CalendarResults()
        parser.feed(self.html.replace("<th>County</th>", "<th>Changed heading</th>"))
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_CALENDAR_LAYOUT"):
            parser.validated(self.criteria)
        self.assertIsNone(parser.validated_column_headers)

    def test_data_row_without_document_link_is_not_silently_skipped(self):
        parser = CalendarResults()
        # Empty malformed cells, explicitly not a docket or case record.
        parser.feed(self.html.replace("<tbody></tbody>",
            "<tbody><tr>" + "<td></td>" * 18 + "</tr></tbody>"))
        with self.assertRaisesRegex(ValueError, "CALENDAR_DOCUMENT_LINK_MISSING"):
            parser.validated(self.criteria)

    def test_malformed_link_is_not_a_case_record(self):
        # Deliberately invalid sentinel; this fixture does not describe a case.
        row = [""] * 18
        row[2] = '<a href="/Report/CpDocketSheet?docketNumber=not-a-docket">invalid</a>'
        row[9], row[10], row[14] = "Allegheny", "CP-05-02-Crim", "Bail Hearing"
        html = self.html.replace("<tbody></tbody>",
                                 "<tbody><tr>" + "".join(f"<td>{cell}</td>" for cell in row)
                                 + "</tr></tbody>")
        parser = CalendarResults()
        parser.feed(html)
        with self.assertRaisesRegex(ValueError, "CALENDAR_DOCUMENT_LINK_MISSING"):
            parser.validated(self.criteria)


class PacingTests(unittest.TestCase):
    def test_every_event_date_requires_supported_query_binding(self):
        criteria = {"startDate": "2026-10-06", "endDate": "2026-10-12"}
        for text, expected in (("10/06/2026", "2026-10-06"),
                               ("10/12/2026 09:00", "2026-10-12")):
            self.assertEqual(validate_event_date(text, criteria), expected)
        for text in ("", "unobserved", "10/40/2026"):
            with self.assertRaisesRegex(ValueError, "UNSUPPORTED_EVENT_DATE_LAYOUT"):
                validate_event_date(text, criteria)
        for text in ("10/05/2026", "10/13/2026"):
            with self.assertRaisesRegex(ValueError, "CALENDAR_EVENT_DATE_OUTSIDE_REQUESTED_WINDOW"):
                validate_event_date(text, criteria)

    def test_response_completion_bounds(self):
        self.assertEqual(response_pause(None, 100, 60), 0)
        self.assertEqual(response_pause(100, 100, 60), 60)
        self.assertEqual(response_pause(100, 100, 90), 90)
        self.assertEqual(response_pause(100, 120, 75), 55)
        self.assertEqual(response_pause(100, 200, 90), 0)
        for interval in (30, 59.99, 90.01, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                response_pause(100, 100, interval)

    def test_asset_preflight(self):
        assets = set(CALENDAR_ASSETS)
        self.assertIsNone(calendar_asset_barrier(assets, 0, 0, 0, 0))
        self.assertEqual(calendar_asset_barrier(set(), 0, 0, 0, 0),
                         "CALENDAR_REQUIRED_ASSET_MISSING")
        for counters in ((1, 0, 0, 0, 0), (0, 1, 0, 0, 0), (0, 0, 1, 0, 0)):
            self.assertEqual(calendar_asset_barrier(assets, *counters),
                             "CALENDAR_REQUIRED_RESOURCE_BLOCKED")
        self.assertEqual(calendar_asset_barrier(assets, 0, 0, 0, 0, 1), "CALENDAR_CONSOLE_ERROR")
        self.assertEqual(calendar_asset_barrier(assets, 0, 0, 0, 1), "CALENDAR_SCRIPT_ERROR")

    def test_result_states_need_validated_evidence(self):
        self.assertEqual(calendar_result_state(False, 0, False), "RESULTS_NOT_VALIDATED")
        self.assertEqual(calendar_result_state(True, 0, False), "RESULTS_NOT_VALIDATED")
        self.assertEqual(calendar_result_state(False, 1, False), "RESULTS_NOT_VALIDATED")
        self.assertEqual(calendar_result_state(True, 1, False), "RESULTS_VALIDATED")
        self.assertEqual(calendar_result_state(True, 0, True), "EMPTY_RESULTS_VALIDATED")
        # No explicit empty-state marker was retained; the live adapter never
        # sets this flag until the court's exact marker is documented.
        self.assertEqual(calendar_result_state(True, 0, False), "RESULTS_NOT_VALIDATED")


class FormTests(unittest.IsolatedAsyncioTestCase):
    async def test_unfiltered_calendar_form_keeps_room_blank_and_scheduled_only_checked(self):
        from calendar_protocol import select_bound_calendar_controls, validate_bound_calendar_form
        markup = """
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post">
          <div id="SearchBy-Control"><select name="SearchBy">
            <option value="CalendarEvent" selected>Calendar Event</option>
          </select></div>
          <div id="JudicialDistrict-Control"><select name="JudicialDistrict">
            <option value="05" selected>Allegheny - 05</option>
          </select></div>
          <div id="CourtOffice-Control"><select name="CourtOffice">
            <option value="" selected></option><option value="CP-05-02-Crim">CP-05-02-Crim</option>
          </select></div>
          <label for="room">Room</label>
          <select id="room" name="CourtRoomID">
            <option value="" selected></option><option value="fixture-room">Fixture room</option>
          </select>
          <div id="CalendarEventType-Control"><select name="CalendarEventType">
            <option value="" selected></option><option value="Bail Hearing">Bail Hearing</option>
          </select></div>
          <input type="date" name="CalendarEventStartDate" value="2026-10-19">
          <input type="date" name="CalendarEventEndDate" value="2026-10-19">
          <label for="scheduled">Scheduled Events Only</label>
          <input id="scheduled" type="checkbox" name="ScheduledEventsOnly" value="1" checked>
          <button id="btnSearch" type="submit">Search</button>
        </form>"""
        criteria = {"courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
                    "startDate": "2026-10-19", "endDate": "2026-10-19"}
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []
            async def block(route):
                outbound.append(route.request.url)
                await route.abort()
            await context.route("**/*", block)
            page = await context.new_page()
            try:
                await page.set_content(markup)
                selected = await select_bound_calendar_controls(page, criteria)
                fields = await validate_bound_calendar_form(page, criteria, selected)
                self.assertEqual(selected["courtOffice"], "")
                self.assertEqual(selected["eventType"], "")
                self.assertIn(("CourtRoomID", ""), fields)
                self.assertIn(("ScheduledEventsOnly", "1"), fields)
                self.assertEqual(outbound, [])

                await page.set_content(markup.replace(' checked>', '>'))
                selected = await select_bound_calendar_controls(page, criteria)
                with self.assertRaises(CalendarFormFailure) as failure:
                    await validate_bound_calendar_form(page, criteria, selected)
                self.assertEqual(failure.exception.control, "SCHEDULED_EVENTS_ONLY")
                self.assertEqual(outbound, [])
            finally:
                await context.close()
                await browser.close()

    async def test_prevalidated_room_observation_continues_on_the_current_page(self):
        from courtroom_observation import observe

        markup = """
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post"
              enctype="application/x-www-form-urlencoded">
          <label for="room">Courtroom</label>
          <select id="room" name="room">
            <option value="fixture-room-506" selected>506</option>
          </select>
          <button id="btnSearch" type="submit">Search</button>
        </form>"""
        criteria = {"courtOffice": "CP-05-02-Crim", "courtRoom": "Courtroom 506",
                    "eventType": "Bail Hearing", "startDate": "2026-10-18",
                    "endDate": "2026-10-23", "recordCap": 5, "requestCap": 12}
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []

            async def block(route):
                outbound.append(route.request.url)
                await route.abort()

            await context.route("**/*", block)
            page = await context.new_page()
            try:
                await page.set_content(markup)
                original_url = page.url
                messages = []
                def emit(kind, **values):
                    messages.append({"kind": kind, **values})

                metadata = await observe(page, emit, criteria, controls_prevalidated=True)
                self.assertEqual(metadata["outcome"], "BOUND_506")
                self.assertEqual(messages[0]["outcome"], "BOUND_506")
                self.assertEqual(page.url, original_url)
                self.assertEqual(outbound, [])
                self.assertTrue(metadata["afterSelection"]["nativeMatches"])
            finally:
                await context.close()
                await browser.close()

    async def test_bound_room_uses_public_labels_and_revalidates_native_binding(self):
        from calendar_protocol import select_bound_calendar_controls, validate_bound_calendar_form
        markup = """
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post">
          <div id="SearchBy-Control"><select name="mode"><option>Calendar Event</option></select></div>
          <div id="JudicialDistrict-Control"><select name="district"><option>Allegheny - 05</option></select></div>
          <div id="CourtOffice-Control"><select name="office"><option>CP-05-02-Crim</option></select></div>
          <div id="CalendarEventType-Control"><select name="event"><option>Bail Hearing</option></select></div>
          <div><label for="public-room">Courtroom</label><select id="public-room" name="hypothetical-native">
            <option value="" selected></option><option value="fixture-only-506">506</option></select></div>
          <input type="date" name="CalendarEventStartDate" required>
          <input type="date" name="CalendarEventEndDate" required>
          <button id="btnSearch">Search</button>
        </form>"""
        criteria = {"courtOffice": "CP-05-02-Crim", "courtRoom": "Courtroom 506", "eventType": "Bail Hearing",
                    "startDate": "2026-10-16", "endDate": "2026-10-22"}
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []
            async def block(route):
                outbound.append(route.request.url)
                await route.abort()
            await context.route("**/*", block)
            page = await context.new_page()
            try:
                for unnamed in (False, True):
                    await page.set_content(markup)
                    if unnamed:
                        await page.locator("#public-room").evaluate("""el => {
                          el.removeAttribute('name');
                          el.insertAdjacentHTML('afterend', '<input name="fixture-backing" type="hidden">');
                          el.onchange = () => el.nextElementSibling.value = el.value;
                        }""")
                    values = await select_bound_calendar_controls(page, criteria)
                    self.assertEqual(values["courtRoom"], "Courtroom 506")
                    await fill_calendar_dates(page, criteria)
                    await validate_bound_calendar_form(page, criteria, values)
                    # Date entry or a late dependency must not invalidate room
                    # silently; rediscover and fail before any Search.
                    await page.locator("#public-room").evaluate("el => el.value = ''")
                    with self.assertRaises(CalendarFormFailure):
                        await validate_bound_calendar_form(page, criteria, values)
                self.assertEqual(outbound, [])
            finally:
                await context.close()
                await browser.close()

    async def test_selectable_criteria_exact_labels_and_unavailable_choices_stop_offline(self):
        # Public-control-only hypothetical fixture. No docket rows, source
        # bodies, source values or network transmission.
        markup = """
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post">
          <div id="SearchBy-Control"><select name="SearchBy"><option value="fixture-mode">Calendar Event</option></select></div>
          <div id="JudicialDistrict-Control"><select name="JudicialDistrict"><option value="fixture-district">Allegheny - 05</option></select></div>
          <div id="CourtOffice-Control"><select name="CourtOffice"><option value="fixture-office">CP-05-02-Crim</option></select></div>
          <select name="CourtRoomID"><option value="" selected></option><option value="fixture-room">Courtroom 506</option></select>
          <div id="CalendarEventType-Control"><select name="CalendarEventType">
            <option value="fixture-bail">Bail Hearing</option>
            <option value="fixture-arraignment">Preliminary Arraignment</option>
          </select></div>
          <input type="date" name="CalendarEventStartDate" min="2026-10-16" max="2999-12-31" required>
          <input type="date" name="CalendarEventEndDate" min="2026-10-16" max="2999-12-31" required>
          <button id="btnSearch" type="submit">Search</button>
        </form>"""
        criteria = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
                    "startDate": "2026-10-16", "endDate": "2026-10-22"}
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--disable-component-update",
                      "--disable-sync", "--no-first-run", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []

            async def block_every_request(route):
                outbound.append(route.request.url)
                await route.abort()

            await context.route("**/*", block_every_request)
            page = await context.new_page()
            try:
                for event in ("Bail Hearing", "Preliminary Arraignment"):
                    await page.set_content(markup)
                    selected = {**criteria, "eventType": event}
                    values = await select_calendar_preview_controls(page, selected)
                    await validate_unfiltered_calendar_room(page)
                    values["courtRoom"] = ""
                    await fill_calendar_dates(page, selected)
                    await validate_calendar_form(page, selected, values)
                    await page.locator('select[name="CourtRoomID"]').select_option("fixture-room")
                    with self.assertRaisesRegex(RuntimeError, "CALENDAR_CONTROL_STATE_MISMATCH"):
                        await validate_unfiltered_calendar_room(page)
                    with self.assertRaisesRegex(RuntimeError, "CALENDAR_CONTROL_STATE_MISMATCH"):
                        await validate_calendar_form(page, selected, values)
                    await page.locator('select[name="CourtRoomID"]').select_option("")
                    self.assertEqual(await page.locator("#CalendarEventType-Control select").input_value(),
                                     "fixture-bail" if event == "Bail Hearing" else "fixture-arraignment")
                for change in ({"courtOffice": "CP-05-02-Fam"},
                               {"eventType": "Preliminary Arraignment"}):
                    await page.set_content(markup)
                    if "eventType" in change:
                        await page.locator('option[value="fixture-arraignment"]').evaluate("(option) => option.disabled = true")
                    with self.assertRaisesRegex(RuntimeError, "^CRITERIA_NOT_AVAILABLE_ON_SOURCE$"):
                        await select_calendar_preview_controls(page, {**criteria, **change})
                for dates in ({"startDate": "2026-10-15"}, {"endDate": "3000-01-01"}):
                    await page.set_content(markup)
                    with self.assertRaisesRegex(RuntimeError, "^CRITERIA_NOT_AVAILABLE_ON_SOURCE$"):
                        await fill_calendar_dates(page, {**criteria, **dates})
                self.assertEqual(outbound, [])
            finally:
                await context.close()
                await browser.close()

    async def test_preview_resolves_exact_labels_and_preserves_form_field_order_offline(self):
        # Local-only fixture. Values are intentionally fixture-specific; no
        # court request, docket row, or source option value is used.
        filler = "".join(
            f'<input type="hidden" name="fixture-field-{index:02d}" value="unchanged">'
            for index in range(1, 26)
        )
        markup = f"""
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post">
          <div id="SearchBy-Control"><select name="SearchBy">
            <option value="fixture-mode">Calendar Event</option></select></div>
          <div id="JudicialDistrict-Control"><select name="JudicialDistrict">
            <option value="fixture-district">Allegheny - 05</option></select></div>
          <div id="CourtOffice-Control"><select name="CourtOffice">
            <option value="fixture-office">CP-05-02-Crim</option></select></div>
          <select name="CourtRoomID"><option value="fixture-room">Courtroom 506</option></select>
          <div id="CalendarEventType-Control"><select name="CalendarEventType">
            <option value="" selected></option><option value="fixture-event">Bail Hearing</option></select></div>
          <input type="date" name="CalendarEventStartDate" value="2026-10-14" required>
          <input type="date" name="CalendarEventEndDate" value="2026-10-14" required>
          {filler}
          <input type="hidden" name="__RequestVerificationToken" value="fixture-only-token">
          <button id="btnSearch" type="submit">Search</button>
        </form>"""
        criteria = {"courtOffice": "CP-05-02-Crim", "courtRoom": "Courtroom 506",
                    "eventType": "ANY", "startDate": "2026-10-14", "endDate": "2026-10-14"}
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--disable-component-update",
                      "--disable-sync", "--no-first-run", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []

            async def block_every_request(route):
                outbound.append(route.request.url)
                await route.abort()

            await context.route("**/*", block_every_request)
            page = await context.new_page()
            try:
                await page.set_content(markup)
                before = await calendar_form_field_count(page)
                values = await select_calendar_preview_controls(page, criteria)
                await fill_calendar_dates(page, criteria)
                after = await calendar_form_field_count(page)
                self.assertEqual(before, 33)
                self.assertEqual(after, before)
                self.assertEqual(values["eventType"], "")
                self.assertEqual(await page.locator("#CalendarEventType-Control select").input_value(), "")
                await validate_calendar_form(page, criteria, values)
                await page.locator("form").evaluate("(form) => form.enctype = 'multipart/form-data'")
                with self.assertRaisesRegex(RuntimeError, "^UNSUPPORTED_CALENDAR_FORM_TARGET$"):
                    await validate_calendar_form(page, criteria, values)
                self.assertEqual(outbound, [])
            finally:
                await context.close()
                await browser.close()

    async def test_search_click_timeout_exceeds_default_and_intercepts_delayed_post(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--disable-component-update",
                      "--disable-sync", "--no-first-run", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            page = await context.new_page()
            requests = []

            async def intercept(route):
                request = route.request
                if (request.method == "POST"
                        and request.url == "https://ujsportal.pacourts.us/CaseSearch"):
                    requests.append((request.method, request.url))
                    await asyncio.sleep(0.1)
                    await route.fulfill(
                        status=200, content_type="text/html",
                        body='<html><body><div id="caseSearchResultGrid">local intercepted response</div></body></html>')
                else:
                    await route.abort()

            await context.route("**/*", intercept)
            await page.set_content("""
              <form method="post" action="https://ujsportal.pacourts.us/CaseSearch">
                <button id="btnSearch" type="submit">Search</button>
              </form>""")
            page.set_default_timeout(20)
            try:
                with patch.object(calendar_protocol, "SEARCH_CLICK_TIMEOUT_MS", 1_000):
                    await submit_calendar_search(page)
                self.assertEqual(requests, [("POST", "https://ujsportal.pacourts.us/CaseSearch")])
                self.assertEqual(await page.locator("body").inner_text(timeout=1_000), "local intercepted response")
            finally:
                await browser.close()

    async def test_optional_abort_errors_are_proven_without_transmission(self):
        blocked = set()
        optional, unknown = [], []
        observed = asyncio.Event()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            async def abort_all(route):
                self.assertEqual(route.request.resource_type, "image")
                blocked.add(route.request.url)
                await route.abort()
            await context.route("**/*", abort_all)
            page = await context.new_page()
            def console(message):
                if message.type != "error":
                    return
                if expected_optional_console_error(message.type, message.text,
                                                   message.location.get("url"), blocked):
                    optional.append(True)
                else:
                    unknown.append(True)
                if len(optional) == 2:
                    observed.set()
            page.on("console", console)
            try:
                await page.set_content('<img src="https://example.invalid/optional-one.png">'
                                       '<img src="https://example.invalid/optional-two.png">')
                await asyncio.wait_for(observed.wait(), timeout=3)
                self.assertEqual(len(blocked), 2)
                self.assertEqual(len(optional), 2)
                self.assertEqual(unknown, [])
                self.assertIsNone(calendar_asset_barrier(set(CALENDAR_ASSETS), 0, 0, 0, 0, len(unknown)))
                await page.evaluate("console.error('offline runtime error')")
                self.assertEqual(len(unknown), 1)
                self.assertEqual(calendar_asset_barrier(set(CALENDAR_ASSETS), 0, 0, 0, 0, len(unknown)),
                                 "CALENDAR_CONSOLE_ERROR")
                url = next(iter(blocked))
                self.assertFalse(expected_optional_console_error("error", "runtime error", url, blocked))
                self.assertFalse(expected_optional_console_error("error", "Failed to load resource: net::ERR_FAILED",
                                                                 "https://example.invalid/unknown.js", blocked))
            finally:
                await context.close()
                await browser.close()

    async def test_actual_browser_form_checks_without_submission(self):
        # Contains only supported public filter controls, not case evidence.
        markup = """
        <form action="https://ujsportal.pacourts.us/CaseSearch" method="post">
          <div id="SearchBy-Control"><select name="SearchBy"><option>CalendarEvent</option></select></div>
          <div id="JudicialDistrict-Control"><select name="JudicialDistrict"><option>05</option></select></div>
          <div id="CourtOffice-Control"><select name="CourtOffice"><option>CP-05-02-Crim</option></select></div>
          <div id="CalendarEventType-Control"><select name="CalendarEventType"><option>Bail Hearing</option></select></div>
          <input type="date" name="CalendarEventStartDate" value="2026-10-06" required>
          <input type="date" name="CalendarEventEndDate" value="2026-10-12" required>
          <button id="btnSearch" type="submit">Search</button>
        </form>"""
        criteria = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
                    "startDate": "2026-10-06", "endDate": "2026-10-12"}
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--disable-background-networking", "--disable-component-update",
                      "--disable-sync", "--no-first-run", "--no-sandbox"])
            context = await browser.new_context(service_workers="block")
            outbound = []

            async def block_every_request(route):
                outbound.append(route.request.url)
                await route.abort()

            await context.route("**/*", block_every_request)
            page = await context.new_page()
            try:
                await page.set_content(markup)
                await validate_calendar_form(page, criteria)
                await page.evaluate("""() => {
                  window.dateChanges = 0;
                  for (const control of document.querySelectorAll('input[type=date]')) {
                    control.value = '';
                    control.addEventListener('change', () => window.dateChanges++);
                  }
                }""")
                await fill_calendar_dates(page, criteria)
                await validate_calendar_form(page, criteria)
                self.assertEqual(await page.evaluate("window.dateChanges"), 2)
                # Resolve the replaced dependent control, never a stale handle.
                await page.evaluate("""() => {
                  document.querySelector('#CalendarEventType-Control select').outerHTML =
                    '<select name=CalendarEventType><option>Bail Hearing</option></select>';
                }""")
                await validate_calendar_form(page, criteria)
                await page.set_content(markup)
                await page.evaluate("""() => {
                  const end = document.querySelector('input[name=CalendarEventEndDate]');
                  end.value = '';
                  end.addEventListener('change', () => {
                    document.querySelector('#CalendarEventType-Control select').innerHTML =
                      '<option>Other public event</option>';
                  });
                }""")
                await fill_calendar_dates(page, criteria)
                with self.assertRaisesRegex(RuntimeError, "CALENDAR_CONTROL_STATE_MISMATCH"):
                    await validate_calendar_form(page, criteria)
                await page.set_content(markup)
                # Dependent option population is allowed to finish before checks.
                await page.evaluate("""() => {
                  const select = document.querySelector("#CourtOffice-Control select");
                  const value = select.value;
                  select.replaceChildren();
                  setTimeout(() => select.add(new Option(value, value)), 25);
                }""")
                await page.wait_for_function(
                    """() => document.querySelector("#CourtOffice-Control select")?.value === "CP-05-02-Crim" """,
                    timeout=1_000)
                await validate_calendar_form(page, criteria)
                # We still explicitly validate forms that delegate validation to JS.
                await page.locator("form").evaluate("(f) => f.noValidate = true")
                await validate_calendar_form(page, criteria)
                scenarios = [
                    ("document.querySelector('form').method = 'get'", "UNSUPPORTED_CALENDAR_FORM_TARGET"),
                    ("document.querySelector('form').action = 'https://example.invalid/'", "UNSUPPORTED_CALENDAR_FORM_TARGET"),
                    ("document.querySelector('#btnSearch').setAttribute('formaction', 'https://example.invalid/')", "UNSUPPORTED_CALENDAR_FORM_TARGET"),
                    ("document.querySelector('#CourtOffice-Control select').disabled = true", "CALENDAR_CONTROL_STATE_MISMATCH"),
                    ("document.querySelector('input[name=CalendarEventStartDate]').value = ''", "SOURCE_FORM_VALIDATION"),
                    ("document.querySelector('#JudicialDistrict-Control select').name = ''", "CALENDAR_CONTROL_STATE_MISMATCH"),
                    ("document.querySelector('form').insertAdjacentHTML('beforeend', '<input name=JudicialDistrict value=other>')", "CALENDAR_SUBMITTED_VALUES_MISMATCH"),
                    ("document.querySelector('#btnSearch').disabled = true", "CALENDAR_CONTROL_STATE_MISMATCH"),
                ]
                metadata = {
                    "document.querySelector('#CourtOffice-Control select').disabled = true": ("COURT_OFFICE", "DISABLED"),
                    "document.querySelector('#JudicialDistrict-Control select').name = ''": ("JUDICIAL_DISTRICT", "BACKING_CONTROL_MISSING"),
                    "document.querySelector('form').insertAdjacentHTML('beforeend', '<input name=JudicialDistrict value=other>')": ("JUDICIAL_DISTRICT", "SUBMITTED_COUNT_MISMATCH"),
                }
                for mutation, barrier in scenarios:
                    with self.subTest(barrier=barrier, mutation=mutation):
                        await page.set_content(markup)
                        await page.evaluate(mutation)
                        with self.assertRaisesRegex(RuntimeError, "^" + barrier + "$") as failure:
                            await validate_calendar_form(page, criteria)
                        if mutation in metadata:
                            self.assertIsInstance(failure.exception, CalendarFormFailure)
                            self.assertEqual((failure.exception.control, failure.exception.reason), metadata[mutation])
                # The approved source-form inspection found one same-form,
                # named text control in each widget container with an exact
                # value/readback/local-POST match. Exercise that shape offline;
                # fixtures retain no source page or field names.
                await page.set_content(markup)
                widget_binding = """() => {
                  for (const id of ['SearchBy-Control', 'JudicialDistrict-Control',
                    'CourtOffice-Control', 'CalendarEventType-Control']) {
                    const group = document.getElementById(id);
                    const select = group.querySelector('select');
                    const backing = document.createElement('input');
                    backing.type = 'hidden';
                    backing.name = 'FixtureBacking-' + id;
                    backing.setAttribute('value', select.value);
                    backing.value = select.value;
                    select.removeAttribute('name');
                    group.append(backing);
                  }
                }"""
                for backing_type in ("hidden", "text", "default_text"):
                    with self.subTest(backing_type=backing_type):
                        await page.set_content(markup)
                        if backing_type == "default_text":
                            binding_fixture = widget_binding.replace(
                                "backing.type = 'hidden';", "backing.removeAttribute('type');")
                        else:
                            binding_fixture = widget_binding.replace(
                                "backing.type = 'hidden';", f"backing.type = '{backing_type}';")
                        await page.evaluate(binding_fixture)
                        if backing_type == "default_text":
                            self.assertIsNone(await page.locator("#SearchBy-Control input").get_attribute("type"))
                            self.assertEqual(
                                await page.locator("#SearchBy-Control input").evaluate("(input) => input.type"),
                                "text")
                        await validate_calendar_form(page, criteria)
                        bound_markup = await page.content()
                        binding_failures = [
                            ("document.querySelector('#SearchBy-Control input').remove()", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_CONTROL_MISSING"),
                            ("document.querySelector('#SearchBy-Control input').value = 'Other public mode'", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_VALUE_MISMATCH"),
                            ("document.querySelector('#SearchBy-Control input').disabled = true", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_CONTROL_MISSING"),
                            ("document.querySelector('form').append(document.querySelector('#SearchBy-Control input'))", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_CONTROL_MISSING"),
                            ("document.querySelector('#SearchBy-Control').append(document.querySelector('#SearchBy-Control input').cloneNode())", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_CONTROL_AMBIGUOUS"),
                            ("document.querySelector('form').append(document.querySelector('#SearchBy-Control input').cloneNode())", "CALENDAR_SUBMITTED_VALUES_MISMATCH", "SUBMITTED_COUNT_MISMATCH"),
                            ("document.querySelector('#SearchBy-Control input').type = 'search'", "CALENDAR_CONTROL_STATE_MISMATCH", "BACKING_CONTROL_MISSING"),
                            ("document.querySelector('#SearchBy-Control select').innerHTML = '<option>Other public mode</option>'", "CALENDAR_CONTROL_STATE_MISMATCH", "VALUE_MISMATCH"),
                        ]
                        for mutation, barrier, reason in binding_failures:
                            with self.subTest(mutation=mutation):
                                await page.set_content(bound_markup)
                                await page.evaluate(mutation)
                                with self.assertRaisesRegex(CalendarFormFailure, "^" + barrier + "$") as failure:
                                    await validate_calendar_form(page, criteria)
                                self.assertEqual((failure.exception.control, failure.exception.reason), ("SEARCH_MODE", reason))
                await page.set_content(markup)
                await page.evaluate("""() => {
                  document.querySelector('#SearchBy-Control select').removeAttribute('name');
                  document.querySelector('#CourtOffice-Control select').disabled = true;
                }""")
                with self.assertRaises(CalendarFormFailure) as failure:
                    await validate_calendar_form(page, criteria)
                self.assertEqual([(item["control"], item["reason"]) for item in failure.exception.failures],
                                 [("SEARCH_MODE", "BACKING_CONTROL_MISSING"), ("COURT_OFFICE", "DISABLED")])
                self.assertEqual(outbound, [], "Offline form checks must never submit or fetch")
            finally:
                await context.close()
                await browser.close()
