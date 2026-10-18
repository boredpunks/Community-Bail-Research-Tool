"""Synthetic public-filter fixtures only; all browser requests abort locally.

These fixtures prove supported association rules, not the live source's markup.
"""
import shutil
import sys
import unittest
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from calendar_protocol import CalendarFormFailure, validate_unfiltered_room_and_schedule
from courtroom_observation import PROBE


SELECT = '<select id="room" name="PublicRoom"><option value="" selected>Any</option><option value="fixture-506">506</option></select>'
DIRECT = '<label for="room">Room</label>' + SELECT
GROUP = '<div><label>Room</label>' + SELECT + '</div>'
UI_GROUP = '<div><label>Room</label>' + SELECT.replace(' name="PublicRoom"', '') + '<input type="hidden" name="NativeRoom" value=""></div>'
SCHEDULE = '<label for="scheduled">Scheduled Events Only</label><input id="scheduled" type="checkbox" name="ScheduledOnly" value="1" checked>'


def fixture(room, outside="", schedule=SCHEDULE):
    return (
        '<!-- Synthetic control fixture; not a source capture. -->'
        '<form id="other"></form>'
        '<form id="active" action="https://ujsportal.pacourts.us/CaseSearch" method="post">'
        + room + schedule + '<button id="btnSearch">Search</button></form>' + outside
    )


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
        self.assertEqual(self.outbound, [], "Fixture validation must not send any request")

    async def test_supported_public_associations_and_blank_submission(self):
        cases = [
            ("direct", DIRECT, "", "PublicRoom"),
            ("bounded unassociated label", GROUP, "", "PublicRoom"),
            ("label for nonlabelable wrapper",
             GROUP.replace('<div>', '<div id="wrapper">').replace('<label>', '<label for="wrapper">'), "", "PublicRoom"),
            ("wrapped select", '<label>Room' + SELECT + '</label>', "", "PublicRoom"),
            ("aria label", SELECT.replace('<select ', '<select aria-label="Room" '), "", "PublicRoom"),
            ("aria labelledby", '<span id="caption">Courtroom:</span>'
             + SELECT.replace('<select ', '<select aria-labelledby="caption" '), "", "PublicRoom"),
            ("external control", '<label for="room">Room</label>',
             SELECT.replace('<select ', '<select form="active" '), "PublicRoom"),
            ("external label and control", "",
             '<label for="room">Room</label>' + SELECT.replace('<select ', '<select form="active" '), "PublicRoom"),
            ("UI and blank backing", UI_GROUP, "", "NativeRoom"),
            ("external UI group", "",
             UI_GROUP.replace('<select ', '<select form="active" aria-label="Room" ')
             .replace('<input ', '<input form="active" '), "NativeRoom"),
        ]
        for name, room, outside, field in cases:
            with self.subTest(name=name):
                await self.page.set_content(fixture(room, outside))
                bindings = await validate_unfiltered_room_and_schedule(self.page)
                self.assertEqual(bindings, ((field, ""), ("ScheduledOnly", "1")))
                # The specific-room observer consumes the very same discovery
                # and backing proof, but does not select 506 in read-only mode.
                observed = await self.page.evaluate(PROBE, {"select506": False, "includeSubmissionField": True})
                self.assertEqual((observed["labels"], observed["controls"]), (1, 1))
                self.assertTrue(observed["sameForm"] and observed["nativeMatches"])
                self.assertEqual(observed["submittedBinding"], {"name": field, "value": ""})
                self.assertFalse(observed["room506Selected"])

    async def test_rejects_unproven_wrong_hidden_or_missing_bindings(self):
        cases = [
            ("unresolved label", '<div><label for="absent">Room</label></div>', "", "ASSOCIATION_UNPROVEN"),
            ("unrelated select beyond group", '<div><label>Room</label></div><div>' + SELECT + '</div>', "", "ASSOCIATION_UNPROVEN"),
            ("different kind of explicit control", '<label for="text">Room</label><input id="text">' + SELECT, "", "ASSOCIATION_UNPROVEN"),
            ("explicit wrong owner", DIRECT.replace('<select ', '<select form="other" '), "", "WRONG_FORM"),
            ("orphan owner", DIRECT.replace('<select ', '<select form="absent" '), "", "WRONG_FORM"),
            ("wrong owner outside", '<label for="room">Room</label>',
             SELECT.replace('<select ', '<select form="other" '), "WRONG_FORM"),
            ("duplicate public controls", DIRECT + DIRECT.replace('room', 'duplicate'), "", "CONTROL_AMBIGUOUS"),
            ("hidden duplicate", DIRECT + '<div hidden>' + DIRECT.replace('room', 'duplicate') + '</div>', "", "CONTROL_AMBIGUOUS"),
            ("two unassociated candidates", '<div><label>Room</label>' + SELECT + SELECT.replace('room', 'duplicate') + '</div>', "", "CONTROL_AMBIGUOUS"),
            ("hidden only control", DIRECT.replace('<select ', '<select hidden '), "", "HIDDEN"),
            ("disabled control", DIRECT.replace('<select ', '<select disabled '), "", "DISABLED"),
            ("disabled blank option", DIRECT.replace('value="" selected', 'value="" selected disabled'), "", "OPTION_DISABLED"),
            ("disabled blank optgroup", DIRECT.replace('<option value="" selected>Any</option>',
             '<optgroup disabled><option value="" selected>Any</option></optgroup>'), "", "OPTION_DISABLED"),
            ("missing blank option", DIRECT.replace('value=""', 'value="not-blank"'), "", "OPTION_MISSING"),
            ("duplicate blank options", DIRECT.replace('</select>', '<option value="">Another</option></select>'), "", "OPTION_AMBIGUOUS"),
            ("nonblank selection", DIRECT.replace('value="" selected', 'value=""').replace('value="fixture-506"', 'value="fixture-506" selected'), "", "NO_FILTER_NOT_SELECTED"),
            ("multiple selection", DIRECT.replace('<select ', '<select multiple '), "", "NO_FILTER_NOT_SELECTED"),
            ("no backing", UI_GROUP.replace('<input type="hidden" name="NativeRoom" value="">', ''), "", "BACKING_CONTROL_MISSING"),
            ("wrong form backing", UI_GROUP.replace('<input ', '<input form="other" '), "", "WRONG_FORM"),
            ("disabled backing", UI_GROUP.replace('<input ', '<input disabled '), "", "DISABLED"),
            ("nonblank backing", UI_GROUP.replace('name="NativeRoom" value=""', 'name="NativeRoom" value="unrelated"'), "", "BACKING_VALUE_MISMATCH"),
            ("ambiguous backing", UI_GROUP.replace('</div>', '<input type="hidden" name="Another" value=""></div>'), "", "BACKING_CONTROL_AMBIGUOUS"),
            ("wrong-owner second backing", UI_GROUP.replace('</div>', '<input type="hidden" form="other" name="Another" value=""></div>'), "", "BACKING_CONTROL_AMBIGUOUS"),
            ("duplicate submitted name", DIRECT, '<input form="active" type="hidden" name="PublicRoom" value="">', "BACKING_VALUE_MISMATCH"),
            ("secret backing identity", UI_GROUP.replace('NativeRoom', 'SessionSecret'), "", "UNNAMED"),
            ("unrelated outside backing", '<div><label>Room</label>'
             + SELECT.replace(' name="PublicRoom"', '') + '</div><input type="hidden" name="Unrelated" value="">', "", "BACKING_CONTROL_MISSING"),
            ("too many form elements", DIRECT + '<input>' * 257, "", "DISCOVERY_LIMIT"),
        ]
        for name, room, outside, reason in cases:
            with self.subTest(name=name):
                await self.page.set_content(fixture(room, outside))
                with self.assertRaises(CalendarFormFailure) as failure:
                    await validate_unfiltered_room_and_schedule(self.page)
                self.assertEqual(failure.exception.control, "COURT_ROOM")
                self.assertEqual(failure.exception.reason, reason)

    async def test_missing_submitted_field_is_not_a_blank_submission(self):
        # Exercise the browser's standard formdata event: a field can retain
        # its owner/value while source script removes its submitted entry.
        await self.page.set_content(fixture(UI_GROUP) + """<script>
          document.querySelector("#active").addEventListener("formdata",
            event => event.formData.delete("NativeRoom"));
        </script>""")
        self.assertTrue(await self.page.locator('input[name="NativeRoom"]').evaluate(
            'el => el.form === document.querySelector("#btnSearch").form'))
        with self.assertRaises(CalendarFormFailure) as failure:
            await validate_unfiltered_room_and_schedule(self.page)
        self.assertEqual(failure.exception.reason, "SUBMITTED_FIELD_MISSING")
        await self.page.set_content(fixture(UI_GROUP))
        self.assertIn(("NativeRoom", ""), await validate_unfiltered_room_and_schedule(self.page))

    async def test_schedule_association_failures_remain_distinct(self):
        for schedule, reason in [
            (SCHEDULE.replace('for="scheduled"', 'for="missing"'), "ASSOCIATION_UNPROVEN"),
            (SCHEDULE.replace('<input ', '<input form="other" '), "WRONG_FORM"),
            (SCHEDULE.replace(' checked>', '>'), "VALUE_MISMATCH"),
        ]:
            with self.subTest(reason=reason):
                await self.page.set_content(fixture(DIRECT, schedule=schedule))
                with self.assertRaises(CalendarFormFailure) as failure:
                    await validate_unfiltered_room_and_schedule(self.page)
                self.assertEqual(failure.exception.control, "SCHEDULED_EVENTS_ONLY")
                self.assertEqual(failure.exception.reason, reason)
