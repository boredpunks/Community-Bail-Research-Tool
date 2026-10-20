"""Control-only fixtures matching operator-observed public title/model binding."""
import shutil
import sys
import unittest
from pathlib import Path
from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from calendar_protocol import (CalendarFormFailure, validate_unfiltered_room_and_schedule,
                               select_bound_calendar_controls, validate_bound_calendar_form, fill_calendar_dates)
from courtroom_observation import PROBE
from optional_resources import FONT, IMAGE
from calendar_diagnostics import RESPONSE_STRUCTURE

SELECT = '<select title="Room"><option value="" selected></option><option value="fixture-506">506</option></select>'
MODEL = '<input id="CourtRoomID-HiddenField" type="text" name="CourtRoomID" value="" hidden>'
ROOM = '<label for="CourtRoomID">Room</label>' + SELECT + MODEL
SCHEDULE = '<label for="scheduled">Scheduled Events Only</label><input id="scheduled" type="checkbox" name="ScheduledOnly" value="1" checked>'


def fixture(room=ROOM):
    return ('<!-- Synthetic public controls only, not a case or source capture. -->'
            '<form id="other"></form><form id="active" action="https://ujsportal.pacourts.us/CaseSearch" method="post">'
            + room + SCHEDULE + '<button id="btnSearch">Search</button></form>')


class PublicRoomDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            executable_path=shutil.which("chromium"), headless=True,
            args=["--disable-background-networking", "--no-sandbox"])
        self.context = await self.browser.new_context(service_workers="block")
        self.outbound = []
        async def block(route):
            self.outbound.append(route.request.url)
            await route.abort()
        await self.context.route("**/*", block)
        self.page = await self.context.new_page()

    async def asyncTearDown(self):
        await self.context.close()
        await self.browser.close()
        await self.playwright.stop()
        self.assertEqual(self.outbound, [])

    async def test_null_label_association_uses_title_and_exact_hidden_binding(self):
        await self.page.set_content(fixture())
        self.assertTrue(await self.page.locator('label[for="CourtRoomID"]').evaluate("el => el.control === null"))
        self.assertEqual(await validate_unfiltered_room_and_schedule(self.page),
                         (("CourtRoomID", ""), ("ScheduledOnly", "1")))
        observed = await self.page.evaluate(PROBE, {"select506": False, "includeSubmissionField": True})
        self.assertTrue(observed["sameForm"] and observed["nativeMatches"])
        self.assertFalse(observed["room506Selected"])
        self.assertEqual(observed["submittedBinding"], {"name": "CourtRoomID", "value": ""})

    async def test_title_binding_failures_still_stop(self):
        cases = [
            (ROOM.replace('title="Room"', 'title="Unrelated"'), "MISSING"),
            (ROOM.replace('<select ', '<select form="other" '), "WRONG_FORM"),
            (ROOM.replace('<select ', '<select form="absent" '), "WRONG_FORM"),
            (ROOM + SELECT, "CONTROL_AMBIGUOUS"),
            (ROOM + '<div hidden>' + SELECT + '</div>', "CONTROL_AMBIGUOUS"),
            (ROOM.replace('<select ', '<select hidden '), "HIDDEN"),
            (ROOM.replace('<select ', '<select disabled '), "DISABLED"),
            (ROOM.replace('value="" selected', 'value="" selected disabled'), "OPTION_DISABLED"),
            (ROOM.replace('value="" selected', 'value="nonblank" selected'), "OPTION_MISSING"),
            (ROOM.replace('</select>', '<option value="">Another blank</option></select>'), "OPTION_AMBIGUOUS"),
            (ROOM.replace('value="" selected', 'value=""').replace('value="fixture-506"', 'value="fixture-506" selected'), "NO_FILTER_NOT_SELECTED"),
            (ROOM.replace(MODEL, ''), "BACKING_CONTROL_MISSING"),
            (ROOM.replace('<input ', '<input form="other" '), "WRONG_FORM"),
            (ROOM.replace('<input ', '<input disabled '), "DISABLED"),
            (ROOM.replace(MODEL, MODEL.replace('value=""', 'value="nonblank"')), "BACKING_VALUE_MISMATCH"),
            (ROOM + MODEL, "BACKING_CONTROL_AMBIGUOUS"),
            (ROOM.replace('name="CourtRoomID"', 'name="Unrelated"'), "BACKING_CONTROL_MISSING"),
        ]
        for room, reason in cases:
            with self.subTest(reason=reason, markup=room[:80]):
                await self.page.set_content(fixture(room))
                with self.assertRaises(CalendarFormFailure) as failure:
                    await validate_unfiltered_room_and_schedule(self.page)
                self.assertEqual(failure.exception.control, "COURT_ROOM")
                self.assertEqual(failure.exception.reason, reason)

    async def test_missing_submitted_field_is_not_empty_value(self):
        await self.page.set_content(fixture() + """<script>
          document.querySelector("#active").addEventListener("formdata",
            event => event.formData.delete("CourtRoomID"));
        </script>""")
        with self.assertRaises(CalendarFormFailure) as failure:
            await validate_unfiltered_room_and_schedule(self.page)
        self.assertEqual(failure.exception.reason, "SUBMITTED_FIELD_MISSING")
        await self.page.set_content(fixture())
        self.assertIn(("CourtRoomID", ""), await validate_unfiltered_room_and_schedule(self.page))

    async def test_all_five_unnamed_controls_submit_exact_model_values(self):
        markup = ""
        specs = [("SearchBy", "Search By", "CalendarEvent", "Calendar Event"),
                 ("JudicialDistrict", "Judicial District", "05", "Allegheny - 05"),
                 ("CourtOffice", "Court Office", "", ""),
                 ("CourtRoomID", "Room", "", ""),
                 ("CalendarEventType", "Calendar Event Type", "", "")]
        for name, title, value, label in specs:
            markup += (f'<div><label for="{name}">{title}</label><select title="{title}">'
                       f'<option value="{value}" selected>{label}</option></select>'
                       f'<input type="text" hidden id="{name}-HiddenField" name="{name}" value="{value}"></div>')
        markup += '<input type="date" name="CalendarEventStartDate"><input type="date" name="CalendarEventEndDate">'
        await self.page.set_content(fixture(markup))
        self.assertTrue(await self.page.evaluate("""() => [...document.querySelectorAll('select')].every(
          el => !el.name && !el.id) && [...document.querySelectorAll('label:not([for=scheduled])')].every(
          el => el.control === null)"""))
        criteria = {"courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
                    "startDate": "2026-10-19", "endDate": "2026-10-19"}
        selected = await select_bound_calendar_controls(self.page, criteria)
        await fill_calendar_dates(self.page, criteria)
        fields = dict(await validate_bound_calendar_form(self.page, criteria, selected))
        self.assertEqual(len(fields), 8)
        for name, _, value, _ in specs:
            self.assertEqual(fields[name], value)

    async def test_local_font_and_image_placeholders_do_not_cause_browser_errors(self):
        await self.context.unroute("**/*")
        types = []
        async def local(route):
            kind = route.request.resource_type
            types.append(kind)
            self.assertIn(kind, ("image", "font"))
            await route.fulfill(status=200, headers={"Access-Control-Allow-Origin": "*"},
                content_type="font/ttf" if kind == "font" else "image/svg+xml",
                body=FONT if kind == "font" else IMAGE)
        await self.context.route("**/*", local)
        errors = []
        self.page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        await self.page.set_content("""<style>@font-face {font-family: local;src:url(https://example.invalid/a.woff2)}
          body {font-family:local}</style><img src="https://example.invalid/a.png">sample""")
        await self.page.evaluate("document.fonts.ready")
        self.assertIn("font", types)
        self.assertIn("image", types)
        self.assertEqual(errors, [])

    async def test_structural_projection_accepts_1004_rows_and_mdj_links(self):
        # Empty cells test only bounded DOM traversal. They are NOT cases and
        # must never be fed to the case parser or called discovered dockets.
        headers = [""] * 18
        for index, label in [(2, "Docket Number"), (3, "Court Type"), (6, "Filing Date"),
                             (9, "County"), (10, "Court Office"), (14, "Event Type")]:
            headers[index] = label
        markup = '<table id="caseSearchResultGrid"><tr>' + ''.join(
            f"<th>{header}</th>" for header in headers) + "</tr>"
        markup += ("<tr>" + "<td></td>" * 18 + "</tr>") * 1004 + "</table>"
        markup += '<script></script>'
        await self.page.set_content(markup)
        state = await self.page.evaluate(RESPONSE_STRUCTURE)
        self.assertEqual(state["dataRowCount"], 1004)
        self.assertTrue(state["expectedHeaders"])
        self.assertFalse(state["countsCapped"])
        await self.page.locator("td").first.evaluate("""el => {
          const a = document.createElement("a");
          a.href = "/Report/MdjDocketSheet?docketNumber=MJ-05003-CR-0004964-2026";
          el.append(a);
        }""")
        self.assertEqual((await self.page.evaluate(RESPONSE_STRUCTURE))["documentLinkCount"], 1)
