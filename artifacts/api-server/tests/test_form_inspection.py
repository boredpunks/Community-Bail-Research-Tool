"""Network-blocked public-form fixtures. No court traffic or docket/case data."""
import io
import json
import re
import sys
import asyncio
import base64
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from playwright.async_api import Route, async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import worker
import form_inspection
from calendar_protocol import select_calendar_preview_controls
from form_inspection import expected
from inspection_safety import (
    CASE_SEARCH, MAX_RESPONSE_BYTES,
    InspectionRequestGate, InspectionRequestRouter, InspectionBrokerResponse,
    ResponseSizeLimitError, declared_asset_urls, read_bounded_response,
    read_inspection_protocol_line, MAX_BROKER_MESSAGE_CHARS,
)

CRITERIA = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
            "startDate": "2026-10-13", "endDate": "2026-10-17"}
INSPECTION_CRITERIA = {"courtOffice": "CP-05-02-Crim", "courtRoom": "Courtroom 506",
                       "eventType": "ANY", "startDate": "2026-10-15", "endDate": "2026-10-15"}


def public_fixture():
    # Explicitly hypothetical widget/native text layout, not source proof.
    groups = []
    controls = [
        ("SearchBy-Control", "SearchBy", "CalendarEvent", "SEARCH_MODE"),
        ("JudicialDistrict-Control", "JudicialDistrict", "05", "JUDICIAL_DISTRICT"),
        ("CourtOffice-Control", "CourtOffice", CRITERIA["courtOffice"], "COURT_OFFICE"),
    ]
    for container, key, value, label in controls:
        groups.append(f'<div id="{container}"><select><option value="{value}">{label}</option></select>'
                          f'<input type="text" name="{key}" value="{value}" style="display:none">'
                          '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></div>')
    groups.extend([
        f'<input type="date" name="CalendarEventStartDate" value="{CRITERIA["startDate"]}">',
        f'<input type="date" name="CalendarEventEndDate" value="{CRITERIA["endDate"]}">',
        '<div id="CalendarEventType-Control"><select><option value="Bail Hearing">EVENT_TYPE</option></select>'
        '<input type="text" name="CalendarEventType" value="Bail Hearing" style="display:none">'
        '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></div>',
    ])
    from public_title_fixture import titled
    return titled('<!-- hypothetical public form; no case data -->'
            '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
            '<script src="/resource/js/sitemain.min.js"></script>'
            '<form method="post" action="https://ujsportal.pacourts.us/CaseSearch">'
            + "".join(groups) + '<button id="btnSearch">Search</button></form>')


def inspection_scope_fixture():
    # Hypothetical no-case-data form for the saved one-day, no-filter scope.
    groups = []
    for label, _selector, container, key, value in expected(INSPECTION_CRITERIA):
        if label == "COURT_ROOM":
            groups.append('<select name="CourtRoomID"><option value="fixture-room-value">Courtroom 506</option></select>')
        elif label == "EVENT_TYPE":
            groups.append('<div id="CalendarEventType-Control"><select><option value="" selected></option>'
                          '<option value="fixture-event">Bail Hearing</option></select>'
                          '<input type="text" name="CalendarEventType" value="" style="display:none"></div>')
        elif container:
            public_label = {
                "SEARCH_MODE": "Calendar Event",
                "JUDICIAL_DISTRICT": "Allegheny - 05",
                "COURT_OFFICE": value,
            }[label]
            groups.append(f'<div id="{container}"><select><option value="{value}">{public_label}</option></select>'
                          f'<input type="text" name="{key}" value="{value}" style="display:none"></div>')
        else:
            groups.append(f'<input type="date" name="{key}" value="{value}">')
    from public_title_fixture import titled
    return titled('<!-- hypothetical public form; no case data -->'
            '<form method="post" action="https://ujsportal.pacourts.us/CaseSearch">'
            + "".join(groups) + '<button id="btnSearch">Search</button></form>')


class InspectionWorkerTests(unittest.IsolatedAsyncioTestCase):
    def test_python_and_parent_diagnostic_contracts_match(self):
        parent_path = Path(__file__).resolve().parents[1] / "src" / "lib" / "form-inspection.ts"
        parent = parent_path.read_text()
        labels = re.search(r"const labels = \[(.*?)\];", parent, re.DOTALL)
        self.assertIsNotNone(labels)
        self.assertEqual(json.loads(f"[{labels.group(1)}]"), list(form_inspection.CONTROLS))
        self.assertIn(f'formInspectionMethod = "{form_inspection.METHOD}"', parent)

    async def run_fixture(self, script="/* public fixture */", coverage=False, fixture=None, filing=False, courtroom=False):
        messages, fetches = [], []
        html = fixture if fixture is not None else public_fixture()
        original_fulfill = Route.fulfill

        class Response:
            status = 200
            def __init__(self, body, content_type):
                self.content = body.encode()
                self.headers = {"content-type": content_type}
            async def body(self):
                return self.content
            async def dispose(self):
                pass

        async def fake_fetch(route, **_kwargs):
            path = urlsplit(route.request.url).path
            fetches.append((route.request.method, path))
            if path == "/CaseSearch":
                return Response(html, "text/html")
            if path == "/resource/css/sitemain.min.css":
                return Response("/* public fixture */", "text/css")
            if path == "/resource/js/sitemain.min.js":
                return Response(script, "application/javascript")
            raise AssertionError("Unexpected fixture fetch; real network is disabled")

        async def fake_fulfill(route, *, response=None, **kwargs):
            if response is not None:
                return await original_fulfill(route, status=response.status,
                                              headers=response.headers, body=response.content)
            return await original_fulfill(route, **kwargs)

        scope = {**CRITERIA, "courtRoom": "Courtroom 506", "requestCap": 3, "recordCap": 1} if courtroom else CRITERIA
        config = {"criteria": scope, "inspectionOnly": not (coverage or filing or courtroom), "coverageOnly": coverage or courtroom,
                  "courtroomObservationOnly": courtroom,
                  "filingInspectionOnly": filing, "calendarComplete": False,
                  "pendingItems": [], "remainingRecords": 1}
        lines = [json.dumps(config)]
        for index in range(3):
            lines.extend([json.dumps({"allow": True, "requestId": f"fixture-{index}"}),
                          json.dumps({"continue": True})])
        with patch.object(Route, "fetch", fake_fetch), patch.object(Route, "fulfill", fake_fulfill), \
                patch.object(worker.sys, "stdin", io.StringIO("\n".join(lines) + "\n")), \
                patch.object(worker, "emit", lambda kind, **values: messages.append({"kind": kind, **values})), \
                patch.object(worker, "response_pause", return_value=0), \
                patch("courtroom_observation.LOCAL_TIMEOUT_SECONDS", 0.65), \
                patch("courtroom_observation.STABLE_SECONDS", 0.05), \
                patch.object(worker.CalendarDocument, "open",
                             side_effect=AssertionError("PDFs prohibited")) as document_open:
            await worker.main()
            document_open.assert_not_awaited()
        return messages, fetches

    def courtroom_fixture(self, room=""):
        room = room.replace("<select", '<select title="Room"')
        room = room.replace('name="unpredictableNative"', 'name="CourtRoomID"')
        html = public_fixture()
        for value, token, label in (
            ("CalendarEvent", "SEARCH_MODE", "Calendar Event"),
            ("05", "JUDICIAL_DISTRICT", "Allegheny - 05"),
            ("CP-05-02-Crim", "COURT_OFFICE", "CP-05-02-Crim"),
            ("Bail Hearing", "EVENT_TYPE", "Bail Hearing"),
        ):
            html = html.replace(f'<option value="{value}">{token}</option>',
                                f'<option value="{value}">{label}</option>')
        return html.replace("</form>", room + "</form>")

    async def courtroom_result(self, room="", script="/* public fixture */"):
        messages, fetches = await self.run_fixture(
            courtroom=True, fixture=self.courtroom_fixture(room), script=script)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(all(method == "GET" for method, _ in fetches))
        self.assertFalse(any(m["kind"] in {"calendar", "docket", "finished"} for m in messages))
        retained = json.dumps(messages)
        for forbidden in ("REDACTION_SENTINEL", "unpredictableNative", "private-value-506", "private-value-507"):
            self.assertNotIn(forbidden, retained)
        rows = [m for m in messages if m["kind"] == "courtroom_metadata"]
        return rows, messages

    async def test_public_room_label_discovers_unpredicted_named_binding_without_post(self):
        rows, messages = await self.courtroom_result("""
          <label for="unpredictableNative">Courtroom:</label>
          <select id="unpredictableNative" name="unpredictableNative">
            <option value="private-value-507">Courtroom 507</option>
            <option value="private-value-506">Courtroom 506</option>
          </select>""")
        self.assertEqual(rows[0]["outcome"], "BOUND_506")
        self.assertFalse(rows[0]["afterCriteria"]["room506Selected"])
        self.assertTrue(rows[0]["afterSelection"]["nativeMatches"])
        self.assertTrue(any(m["kind"] == "coverage_finished" for m in messages))

    async def test_public_room_label_waits_for_replaced_unnamed_widget_binding(self):
        room = """<div id="roomGroup"><label>Court room</label>
          <select disabled></select><input type="hidden" name="unpredictableNative" value=""></div>"""
        script = """document.addEventListener("DOMContentLoaded", () => {
          document.querySelector("#CourtOffice-Control select").addEventListener("change", () => {
            setTimeout(() => {
              const old = document.querySelector("#roomGroup select");
              const select = document.createElement("select");
              select.title = "Room";
              select.innerHTML = '<option value="private-value-507">507</option><option value="private-value-506">506</option>';
              const model = document.querySelector("#roomGroup input");
              model.value = select.value;
              select.addEventListener("change", () => { model.value = select.value; });
              old.replaceWith(select);
            }, 100);
          });
        });"""
        rows, _ = await self.courtroom_result(room, script)
        self.assertFalse(rows[0]["initial"]["enabled"])
        self.assertEqual(rows[0]["outcome"], "BOUND_506")
        self.assertEqual(rows[0]["afterSelection"]["namedBindings"], 1)

    async def test_room_absent_is_observed_nonexposure_not_no_filter_permission(self):
        rows, _ = await self.courtroom_result()
        self.assertEqual(rows[0]["outcome"], "CONTROL_NOT_EXPOSED")
        self.assertEqual(rows[0]["afterCriteria"]["labels"], 0)
        self.assertTrue(rows[0]["stable"])
        self.assertIsNone(rows[0]["afterSelection"])

    async def test_room_disabled_dependency_is_not_forced_or_substituted(self):
        rows, _ = await self.courtroom_result("""<label for="room">Courtroom</label>
          <select id="room" disabled><option>506</option></select>""")
        self.assertEqual(rows[0]["outcome"], "DEPENDENCY_UNRESOLVED")
        self.assertIsNone(rows[0]["afterSelection"])

    async def test_room_506_unavailable_is_not_another_room(self):
        rows, _ = await self.courtroom_result("""<label for="room">Courtroom</label>
          <select id="room" name="unpredictableNative"><option value="private-value-507">507</option></select>""")
        self.assertEqual(rows[0]["outcome"], "ROOM_506_UNAVAILABLE")
        self.assertIsNone(rows[0]["afterSelection"])

    async def test_room_ambiguous_backing_does_not_claim_binding(self):
        rows, _ = await self.courtroom_result("""<div><label>Courtroom</label>
          <select><option value="private-value-506">506</option></select>
          <input type="hidden" name="CourtRoomID" value="private-value-506">
          <input type="hidden" name="CourtRoomID" value="private-value-506"></div>""")
        self.assertEqual(rows[0]["outcome"], "BINDING_UNPROVEN")
        self.assertEqual(rows[0]["afterSelection"]["namedBindings"], 2)

    async def test_room_observation_dependency_fetch_never_transmits(self):
        _, messages = await self.courtroom_result(
            script="document.addEventListener('change', () => fetch('/CaseSearch'));")
        self.assertFalse(any(m["kind"] == "coverage_finished" for m in messages))
        self.assertTrue(any(m["kind"] == "barrier" and m["code"] == "COVERAGE_UNEXPECTED_LOCAL_REQUEST" for m in messages))

    async def test_missing_courtroom_plugin_stops_before_browser_or_network(self):
        import builtins
        real_import = builtins.__import__
        messages = []

        def blocked_import(name, *args, **kwargs):
            if name == "courtroom_observation":
                raise ModuleNotFoundError("Offline packaging test")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=blocked_import), \
                patch.object(worker, "async_playwright", side_effect=AssertionError("Browser must not start")), \
                patch.object(worker, "emit", side_effect=lambda kind, **values: messages.append({"kind": kind, **values})):
            await worker.main({"criteria": {**CRITERIA, "courtRoom": "Courtroom 506", "requestCap": 3, "recordCap": 1},
                               "courtroomObservationOnly": True, "coverageOnly": True})
        self.assertEqual(messages, [{"kind": "barrier", "code": "COURTROOM_OBSERVATION_UNAVAILABLE"}])

    def filing_fixture(self):
        # Hypothetical public filter controls, NOT portal evidence or case data.
        fixture = public_fixture().replace('value="CalendarEvent">SEARCH_MODE', 'value="fixture_filing">Date Filed')
        groups = ''
        for role, label, options in [
            ('fixtureCourt', 'Court Type', [('', 'Choose'), ('fixture_mdj', 'Magisterial District Court')]),
            ('fixtureCounty', 'County', [('', 'Choose'), ('fixture_county', 'Allegheny')]),
            ('fixtureCase', 'Case Type', [('', 'Choose'), ('fixture_criminal', 'Criminal')]),
            ('fixtureOffice', 'Court Office', [('', 'Choose')]),
        ]:
            groups += f'<label for="{role}">{label}:</label><select id="{role}" name="{role}">'
            groups += ''.join(f'<option value="{value}">{text}</option>' for value, text in options) + '</select>'
        groups += '<input type="date" name="fixtureFilingStart" min="1899-01-01" max="2026-10-12">'
        groups += '<input type="date" name="fixtureFilingEnd" min="1899-01-01" max="2026-10-12">'
        groups += ('<label for="fixtureAdvancedFlag">Advanced Search</label>'
                   '<div id="fixtureAdvancedFlag-Control"><input type="checkbox" id="fixtureAdvanced" '
                   'name="fixtureAdvanced" value="PRIVATE_VALUE_SENTINEL"></div>')
        return fixture.replace('<button id="btnSearch">', groups + '<button id="btnSearch">')

    async def test_filing_source_labels_only_and_native_counts_redacted(self):
        script = """document.addEventListener('submit', () => {throw Error('Search prohibited');});
        document.addEventListener('change', () => {
          const type = document.getElementById('fixtureCourt'), county = document.getElementById('fixtureCounty');
          const criminal = document.getElementById('fixtureCase'), office = document.getElementById('fixtureOffice');
          if (type.value || criminal.value) throw Error('Other scope selection prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=self.filing_fixture(), script=script)
        self.assertEqual(len(fetches), 3)
        metadata = [message for message in messages if message["kind"] == "filing_metadata"]
        self.assertEqual([row["phase"] for row in metadata], ['INITIAL', 'FILING', 'ADVANCED', 'COUNTY', 'FINAL'])
        final = metadata[-1]
        self.assertTrue(final['modeMatchesFiling'])
        self.assertEqual(final['advancedSearch'], {'candidates': 1, 'eligible': True, 'checked': True})
        self.assertEqual(final['county'], {'candidates': 1, 'eligible': True, 'selected': True})
        self.assertNotIn('scopeReady', final)
        self.assertNotIn('officeCodes', final)
        court = next(row for row in final['controls'] if 'Court Type' in row['labels'])
        self.assertEqual(court['publicChoices']['MDJ'], 1)
        self.assertEqual(court['selectedPublicChoices']['MDJ'], 0)
        self.assertTrue(court['nativeSuccessful'])
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertFalse(any(row['kind'] in ['barrier', 'docket', 'calendar', 'finished'] for row in messages))
        for forbidden in ['fixture_mdj', 'fixtureCounty', 'fixtureFilingStart', 'fixture_criminal', 'REDACTION_SENTINEL']:
            self.assertNotIn(forbidden, json.dumps(metadata))

    async def test_filing_missing_court_labels_not_substituted(self):
        fixture = self.filing_fixture().replace('Court Type:', 'Unrecognized filter:')
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        metadata = [message for message in messages if message['kind'] == 'filing_metadata']
        court = next(row for row in metadata[-1]['controls'] if row['publicChoices']['MDJ'])
        self.assertEqual(court['labels'], [])
        self.assertTrue(court['hasPublicLabel'])
        self.assertEqual(court['selectedPublicChoices']['MDJ'], 0)
        self.assertNotIn('Unrecognized filter', json.dumps(metadata))

    async def test_filing_multiple_mdj_options_observed_never_selected(self):
        fixture = self.filing_fixture().replace(
            '<option value="fixture_mdj">Magisterial District Court</option>',
            '<option value="fixture_mdj">Magisterial District Court</option><option value="other">MDJ</option>')
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        court = next(row for row in metadata[-1]['controls'] if row['publicChoices']['MDJ'])
        self.assertEqual(court['publicChoices']['MDJ'], 2)
        self.assertEqual(court['selectedPublicChoices']['MDJ'], 0)
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))

    async def test_filing_ambiguous_mode_fails_without_selection(self):
        fixture = self.filing_fixture().replace('>Date Filed</option>',
            '>Date Filed</option><option value="other">Filing Date</option>')
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertTrue(any(row.get('code') == 'FILING_MODE_NOT_ESTABLISHED' for row in messages))

    async def test_filing_inventory_outside_form_radio_tabs_and_custom_dropdown(self):
        fixture = self.filing_fixture() + """
        <fieldset><legend>Court Level</legend>
          <label><input type="radio" name="fixtureScope" value="private">MDJ</label>
        </fieldset>
        <button role="tab" aria-selected="false">Magisterial District Courts</button>
        <input role="combobox" aria-label="Court System" aria-controls="fixtureOptions" value="PRIVATE_VALUE_SENTINEL">
        <div id="fixtureOptions" role="listbox"><div role="option">Magisterial District Court</div></div>
        <form><label for="outside">Court Selection</label><select id="outside" name="privateField">
          <option>Choose</option><option value="private">MDJ</option></select></form>
        <label for="sensitiveName">Court</label><select id="sensitiveName" name="defendant">
          <option>PRIVATE_LABEL_SENTINEL</option></select>
        <input type="hidden" name="privateToken" value="PRIVATE_VALUE_SENTINEL">
        """
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        final = metadata[-1]
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        for widget in ['RADIO', 'TAB', 'COMBOBOX']:
            row = next(row for row in final['controls'] if row['widget'] == widget)
            self.assertEqual(row['ownership'], 'NONE')
            self.assertEqual(row['publicChoices']['MDJ'], 1)
            self.assertEqual(row['selectedPublicChoices']['MDJ'], 0)
            self.assertFalse(row['nativeSuccessful'])
        radio = next(row for row in final['controls'] if row['widget'] == 'RADIO')
        self.assertIn('Court Level', radio['labels'])
        self.assertIn('GROUP', radio['associations'])
        outside = next(row for row in final['controls'] if 'Court Selection' in row['labels'])
        self.assertEqual(outside['ownership'], 'OTHER')
        self.assertFalse(outside['nativeSuccessful'])
        self.assertEqual(final['omittedSensitiveControls'], 1)
        for forbidden in ['PRIVATE_LABEL_SENTINEL', 'PRIVATE_VALUE_SENTINEL', 'fixtureScope',
                          'privateField', 'defendant', 'fixtureOptions', 'privateToken']:
            self.assertNotIn(forbidden, json.dumps(metadata))

    async def test_filing_inventory_observes_hidden_disabled_and_local_activation(self):
        fixture = self.filing_fixture().replace('id="fixtureCourt" name="fixtureCourt"',
            'id="fixtureCourt" name="fixtureCourt" disabled style="display:none"')
        script = """document.addEventListener('change', event => {
          if (event.target.closest('#SearchBy-Control')) {
            const court = document.getElementById('fixtureCourt');
            court.disabled = false; court.style.display = '';
          }
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        court = lambda phase: next(row for row in phase['controls'] if 'Court Type' in row['labels'])
        self.assertFalse(court(metadata[0])['enabled'])
        self.assertFalse(court(metadata[0])['visible'])
        self.assertTrue(court(metadata[1])['enabled'])
        self.assertTrue(court(metadata[1])['visible'])
        self.assertEqual(court(metadata[1])['selectedPublicChoices']['MDJ'], 0)

    async def test_filing_inventory_overflow_fails_closed(self):
        fixture = self.filing_fixture() + '<select><option>Choose</option></select>' * 129
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row.get('code') == 'FILING_WIDGET_LIMIT' for row in messages))
        self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))

    async def test_filing_inventory_guard_reasons_are_closed_and_redacted(self):
        refs = ' '.join(f'PRIVATE_REFERENCE_SENTINEL_{index}' for index in range(9))
        for code, fixture in [
            ('FILING_FORM_ELEMENT_LIMIT', self.filing_fixture().replace(
                '<button id="btnSearch">', '<input type="hidden" value="PRIVATE_VALUE_SENTINEL">' * 513
                + '<button id="btnSearch">')),
            ('FILING_ARIA_REFERENCE_LIMIT', self.filing_fixture()
                + f'<input role="combobox" aria-labelledby="{refs}">'),
            ('FILING_GROUP_REFERENCE_LIMIT', self.filing_fixture()
                + f'<fieldset aria-labelledby="{refs}"><label><input type="radio">MDJ</label></fieldset>'),
        ]:
            with self.subTest(code=code):
                messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
                self.assertEqual(len(fetches), 3)
                self.assertTrue(all(method == 'GET' for method, _ in fetches))
                self.assertEqual([row['code'] for row in messages if row['kind'] == 'barrier'], [code])
                self.assertFalse(any(row['kind'] in ['filing_metadata', 'filing_finished', 'docket', 'calendar']
                                     for row in messages))
                self.assertNotIn('SENTINEL', json.dumps(messages))

    async def test_filing_oversized_options_are_unknown_not_empty_and_do_not_abort_inventory(self):
        fixture = self.filing_fixture() + """
          <label for="oversized">Court</label><select id="oversized">
        """ + '<option>PRIVATE_LABEL_SENTINEL</option>' * 2001 + """</select>
          <input role="combobox" aria-label="Court Level" aria-controls="oversizedOptions">
          <div id="oversizedOptions">
        """ + '<div role="option">PRIVATE_LABEL_SENTINEL</div>' * 2001 + '</div>'
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertEqual([row['phase'] for row in metadata], ['INITIAL', 'FILING', 'ADVANCED', 'COUNTY', 'FINAL'])
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertFalse(any(row['kind'] == 'barrier' for row in messages))
        for phase in metadata:
            uninspected = [row for row in phase['controls'] if row['optionState'] == 'OVER_LIMIT']
            self.assertEqual(len(uninspected), 2)
            self.assertEqual({row['widget'] for row in uninspected}, {'SELECT', 'COMBOBOX'})
            for row in uninspected:
                self.assertIsNone(row['optionCount'])
                self.assertIsNone(row['publicChoices'])
                self.assertIsNone(row['selectedPublicChoices'])
            court = next(row for row in phase['controls'] if 'Court Type' in row['labels'])
            self.assertEqual(court['optionState'], 'OBSERVED')
            self.assertEqual(court['publicChoices']['MDJ'], 1)
            self.assertEqual(court['selectedPublicChoices']['MDJ'], 0)
        self.assertNotIn('SENTINEL', json.dumps(metadata))
        self.assertNotIn('oversized', json.dumps(metadata))

    async def test_filing_dependent_request_is_aborted_not_transmitted(self):
        messages, fetches = await self.run_fixture(filing=True, fixture=self.filing_fixture(),
                                                 script="document.addEventListener('change', () => fetch('/CaseSearch'));")
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row.get('code') == 'FILING_UNEXPECTED_LOCAL_REQUEST' for row in messages))
        self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))

    async def test_filing_public_links_and_generic_words_are_observed_never_activated(self):
        fixture = self.filing_fixture() + """
          <a href="/CaseSearch?PRIVATE_VALUE_SENTINEL">Magisterial District Courts</a>
          <a href="/PRIVATE_URL_SENTINEL">Court of Common Pleas</a>
          <label><input type="checkbox">Search All Courts</label>
          <label><input type="checkbox">PRIVATE_LABEL_SENTINEL cases by county</label>
          <label for="fixtureCp">CP Court</label><select id="fixtureCp" disabled><option>Choose</option></select>
          <label for="fixtureMdj">MDJ County</label><select id="fixtureMdj" disabled><option>Choose</option></select>
          <label for="fixtureNumber">Court Number</label><select id="fixtureNumber" disabled><option>Choose</option></select>
          <label for="fixtureOptional">Court (Optional)</label><select id="fixtureOptional" disabled><option>Choose</option></select>
          <button>PRIVATE_LABEL_SENTINEL</button>
        """
        script = """document.addEventListener('click', event => {
            if (event.target.id !== 'fixtureAdvanced') throw Error('Navigation prohibited');
          });
          document.addEventListener('change', event => {
            if (!event.target.closest('#SearchBy-Control') && !['fixtureAdvanced', 'fixtureCounty'].includes(event.target.id))
              throw Error('Other selection prohibited');
          });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertFalse(any(row['kind'] == 'barrier' for row in messages))
        final = metadata[-1]
        links = [row for row in final['controls'] if row['widget'] == 'LINK']
        self.assertEqual(len(links), 2)
        self.assertTrue(any(row['publicChoices']['MDJ'] == 1 for row in links))
        self.assertTrue(any(row['publicChoices']['COMMON_PLEAS'] == 1 for row in links))
        checkbox = next(row for row in final['controls'] if 'Search All Courts' in row['labels'])
        self.assertEqual(checkbox['labelWords'], ['all', 'courts', 'search'])
        unknown = next(row for row in final['controls'] if row['labelWords'] == ['cases', 'county', 'by'])
        self.assertEqual(unknown['labels'], [])
        advanced = next(row for row in final['controls'] if 'Advanced Search' in row['labels'])
        self.assertEqual(advanced['labelWords'], ['search', 'advanced'])
        self.assertTrue(advanced['nativeSuccessful'])
        self.assertTrue(final['advancedSearch']['checked'])
        cp = next(row for row in final['controls'] if 'CP Court' in row['labels'])
        self.assertEqual(cp['labelWords'], ['court', 'cp'])
        self.assertFalse(cp['enabled'])
        mdj = next(row for row in final['controls'] if 'MDJ County' in row['labels'])
        self.assertEqual(mdj['labelWords'], ['county', 'mdj'])
        self.assertFalse(mdj['enabled'])
        number = next(row for row in final['controls'] if 'Court Number' in row['labels'])
        self.assertEqual(number['labelWords'], ['court', 'number'])
        self.assertFalse(number['enabled'])
        optional = next(row for row in final['controls'] if 'Court (Optional)' in row['labels'])
        self.assertEqual(optional['labelWords'], ['court', 'optional'])
        self.assertFalse(optional['enabled'])
        self.assertNotIn('SENTINEL', json.dumps(metadata))

    async def test_advanced_search_reveals_controls_without_selecting_them(self):
        fixture = self.filing_fixture().replace('id="fixtureCourt" name="fixtureCourt"',
            'id="fixtureCourt" name="fixtureCourt" disabled style="display:none"')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureAdvanced' && event.target.checked) {
            const court = document.getElementById('fixtureCourt');
            court.disabled = false; court.style.display = '';
          }
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        phases = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertEqual([row['phase'] for row in phases], ['INITIAL', 'FILING', 'ADVANCED', 'COUNTY', 'FINAL'])
        court = lambda phase: next(row for row in phase['controls'] if 'Court Type' in row['labels'])
        self.assertFalse(court(phases[1])['enabled'])
        self.assertTrue(court(phases[2])['enabled'])
        self.assertTrue(court(phases[2])['visible'])
        self.assertEqual(court(phases[2])['selectedPublicChoices']['MDJ'], 0)
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))

    async def test_advanced_search_missing_ambiguous_hidden_or_wrong_form_never_activated(self):
        base = self.filing_fixture()
        for fixture in [
            base.replace('Advanced Search</label>', 'Unrecognized public filter</label>'),
            base + '<label><input type="checkbox">Advanced Search</label>',
            base.replace('id="fixtureAdvanced" ', 'id="fixtureAdvanced" disabled '),
            base.replace('id="fixtureAdvanced" ', 'id="fixtureAdvanced" style="display:none" '),
            base.replace('id="fixtureAdvanced" ', 'id="fixtureAdvanced" form="missing" '),
        ]:
            with self.subTest(fixture=fixture[:30]):
                messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
                self.assertEqual(len(fetches), 3)
                self.assertTrue(any(row.get('code') == 'FILING_ADVANCED_NOT_ESTABLISHED' for row in messages))
                self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
                self.assertFalse(any(row.get('phase') in ['ADVANCED', 'FINAL'] for row in messages))

    async def test_advanced_search_dependent_request_aborted_and_no_later_phase(self):
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureAdvanced') fetch('/CaseSearch', {method:'POST', body:'PRIVATE_VALUE_SENTINEL'});
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=self.filing_fixture(), script=script)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(all(method == 'GET' for method, _ in fetches))
        self.assertTrue(any(row.get('code') == 'FILING_UNEXPECTED_LOCAL_REQUEST' for row in messages))
        self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertFalse(any(row.get('phase') in ['ADVANCED', 'FINAL'] for row in messages))
        self.assertNotIn('SENTINEL', json.dumps(messages))

    async def test_advanced_search_already_checked_is_not_toggled(self):
        fixture = self.filing_fixture().replace('id="fixtureAdvanced" ', 'id="fixtureAdvanced" checked ')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureAdvanced') throw Error('Repeated activation prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertTrue(all(row['advancedSearch']['checked'] for row in messages if row['kind'] == 'filing_metadata'))

    async def test_county_missing_ambiguous_inactive_unknown_or_wrong_form_never_selected(self):
        base = self.filing_fixture()
        for fixture in [
            base.replace('County:</label>', 'Unknown public county filter:</label>'),
            base + '<label for="duplicateCounty">County</label><select id="duplicateCounty"><option>Allegheny</option></select>',
            base.replace('id="fixtureCounty" ', 'id="fixtureCounty" disabled '),
            base.replace('id="fixtureCounty" ', 'id="fixtureCounty" style="display:none" '),
            base.replace('id="fixtureCounty" ', 'id="fixtureCounty" form="missing" '),
            base.replace('>Allegheny</option>', '>Another County</option>'),
            base.replace('>Allegheny</option>', '>Allegheny</option><option>Allegheny</option>'),
            base.replace('value="fixture_county"', 'disabled value="fixture_county"'),
            base.replace('>Allegheny</option>', '>Allegheny</option>' + '<option>PRIVATE_SENTINEL</option>' * 2001),
        ]:
            with self.subTest(fixture=fixture[:30]):
                messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
                self.assertEqual(len(fetches), 3)
                self.assertTrue(any(row.get('code') == 'FILING_COUNTY_NOT_ESTABLISHED' for row in messages))
                self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
                self.assertFalse(any(row.get('phase') in ['COUNTY', 'FINAL'] for row in messages))
                self.assertNotIn('SENTINEL', json.dumps(messages))

    async def test_county_selection_reveals_local_controls_without_selecting_them(self):
        fixture = self.filing_fixture().replace('id="fixtureCourt" name="fixtureCourt"',
            'id="fixtureCourt" name="fixtureCourt" disabled')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureCounty') document.getElementById('fixtureCourt').disabled = false;
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        phases = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertEqual(len(fetches), 3)
        self.assertEqual([row['phase'] for row in phases], ['INITIAL', 'FILING', 'ADVANCED', 'COUNTY', 'FINAL'])
        self.assertFalse(phases[2]['county']['selected'])
        self.assertTrue(phases[3]['county']['selected'])
        for phase in phases:
            court = next(row for row in phase['controls'] if 'Court Type' in row['labels'])
            self.assertEqual(court['selectedPublicChoices']['MDJ'], 0)
            self.assertEqual(court['enabled'], phase['phase'] in ['COUNTY', 'FINAL'])
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))

    async def test_county_dependent_request_aborted_and_no_later_phase(self):
        for method in ['GET', 'POST']:
            script = """document.addEventListener('change', event => {
              if (event.target.id === 'fixtureCounty') fetch('/CaseSearch', {method:'""" + method + """'});
            });"""
            messages, fetches = await self.run_fixture(filing=True, fixture=self.filing_fixture(), script=script)
            self.assertEqual(len(fetches), 3)
            self.assertTrue(all(method == 'GET' for method, _ in fetches))
            self.assertTrue(any(row.get('code') == 'FILING_UNEXPECTED_LOCAL_REQUEST' for row in messages))
            self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
            self.assertFalse(any(row.get('phase') in ['COUNTY', 'FINAL'] for row in messages))

    async def test_county_already_selected_is_not_changed(self):
        fixture = self.filing_fixture().replace('value="fixture_county"', 'selected value="fixture_county"')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureCounty') throw Error('Repeated county activation prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        self.assertTrue(all(row['county']['selected'] for row in messages if row['kind'] == 'filing_metadata'))

    async def test_public_office_codes_are_displayed_only_bounded_and_not_selected(self):
        fixture = self.filing_fixture().replace('Court Office:</label>', 'Court Office*: *</label>').replace(
            '<select id="fixtureOffice" name="fixtureOffice"><option value="">Choose</option></select>',
            '<select id="fixtureOffice" name="fixtureOffice"><option value="">Choose</option>'
            '<option value="PRIVATE_VALUE_SENTINEL">05-2-99 - PRIVATE_NAME_SENTINEL</option>'
            '<option value="PRIVATE_VALUE_SENTINEL">MJ-05-1-99</option>'
            '<option value="PRIVATE_VALUE_SENTINEL">MDJ-05-2-90-PRIVATE_NAME_SENTINEL, Fixture</option>'
            '<option value="PRIVATE_VALUE_SENTINEL">Magisterial District Court 05-3-99</option>'
            '<option value="05-2-98">PRIVATE_LABEL_SENTINEL</option>'
            '<option>PRIVATE_NAME_SENTINEL (MJ-05297)</option>'
            '<option>PRIVATE_NAME_SENTINEL 05-2-96</option>'
            '<option>05-2-95 and 05-2-94 PRIVATE_NAME_SENTINEL</option>'
            '<option label="MJ-05293">PRIVATE_HIDDEN_TEXT_SENTINEL</option>'
            '<option label="PRIVATE_DISPLAY_LABEL_SENTINEL">05-2-91</option>'
            '<option>05-2-99-CR-PRIVATE_DOCKET_SENTINEL</option></select>')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureOffice') throw Error('Office selection prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertEqual(len(metadata), 5)
        for phase in metadata[:3]:
            self.assertEqual(phase['officeIdentification']['state'], 'NOT_READY')
            self.assertIsNone(phase['officeIdentification']['codes'])
        final = metadata[-1]['officeIdentification']
        self.assertEqual(final['state'], 'OBSERVED')
        self.assertEqual(final['unrecognizedOptions'], 5)
        self.assertEqual(final['codes'], [
            {'code': '05-2-99', 'kind': 'DISTRICT_CODE_UNVERIFIED', 'enabled': True, 'selected': False},
            {'code': '05-1-99', 'kind': 'EXPLICIT_MDJ', 'enabled': True, 'selected': False},
            {'code': '05-2-90', 'kind': 'EXPLICIT_MDJ', 'enabled': True, 'selected': False},
            {'code': '05-3-99', 'kind': 'EXPLICIT_MDJ', 'enabled': True, 'selected': False},
            {'code': '05-2-97', 'kind': 'EXPLICIT_MDJ', 'enabled': True, 'selected': False},
            {'code': '05-2-96', 'kind': 'DISTRICT_CODE_UNVERIFIED', 'enabled': True, 'selected': False},
            {'code': '05-2-93', 'kind': 'EXPLICIT_MDJ', 'enabled': True, 'selected': False},
        ])
        self.assertTrue(any('Court Office' in row['labels'] for row in metadata[-1]['controls']))
        self.assertNotIn('SENTINEL', json.dumps(messages))
        self.assertNotIn('05-2-98', json.dumps(metadata))
        self.assertNotIn('05-2-91', json.dumps(metadata))

    async def test_hyphenated_office_names_are_redacted_and_case_suffixes_rejected(self):
        # Public option-label format only; no case records or source access.
        accepted = [
            ('MDJ-05-2-01-PRIVATE_NAME_SENTINEL', '05-2-01', 'EXPLICIT_MDJ'),
            ('MDJ-05-3-17-PRIVATE_NAME_SENTINEL', '05-3-17', 'EXPLICIT_MDJ'),
            ('MJ-05297-PRIVATE_NAME_SENTINEL', '05-2-97', 'EXPLICIT_MDJ'),
            ('05-2-96-PRIVATE_NAME_SENTINEL', '05-2-96', 'DISTRICT_CODE_UNVERIFIED'),
        ]
        rejected = ['MDJ-05-2-99-' + suffix + '-PRIVATE_DOCKET_SENTINEL'
                    for suffix in ['CR', 'MD', 'CV', 'TR', 'NT', 'SA', 'SU', 'DP', 'ZZ']]
        rejected += ['MDJ-05-2-99-', 'MDJ-05-2-99-123', 'MDJ-05-2-99--PRIVATE_NAME_SENTINEL',
                     'MDJ-05-2-99-PRIVATE_NAME_SENTINEL MJ-05-1-99']
        options = '<option value="">Choose</option>' + ''.join(
            '<option value="PRIVATE_VALUE_SENTINEL">' + label + '</option>'
            for label in [row[0] for row in accepted] + rejected)
        fixture = self.filing_fixture().replace(
            '<select id="fixtureOffice" name="fixtureOffice"><option value="">Choose</option></select>',
            '<select id="fixtureOffice" name="fixtureOffice">' + options + '</select>')
        script = """document.addEventListener('change', event => {
          if (event.target.id === 'fixtureOffice') throw Error('Office selection prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture, script=script)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row['kind'] == 'filing_finished' for row in messages))
        metadata = [row for row in messages if row['kind'] == 'filing_metadata']
        self.assertEqual(len(metadata), 5)
        self.assertTrue(all(row['method'] == 'playwright-filing-control-inventory-v8' for row in metadata))
        for phase in metadata[:3]:
            self.assertEqual(phase['officeIdentification']['state'], 'NOT_READY')
            self.assertIsNone(phase['officeIdentification']['codes'])
        for phase in metadata[3:]:
            self.assertEqual(phase['officeIdentification']['state'], 'OBSERVED')
            self.assertEqual(phase['officeIdentification']['unrecognizedOptions'], len(rejected) + 1)
            self.assertEqual(phase['officeIdentification']['codes'], [
                {'code': code, 'kind': kind, 'enabled': True, 'selected': False}
                for _, code, kind in accepted])
        self.assertNotIn('SENTINEL', json.dumps(messages))

    async def test_office_code_limit_unknown_and_ambiguous_candidates_fail_closed(self):
        base = self.filing_fixture()
        replacement = '<select id="fixtureOffice" name="fixtureOffice">' + '<option>05-2-99</option>' * 251 + '</select>'
        fixture = base.replace('<select id="fixtureOffice" name="fixtureOffice"><option value="">Choose</option></select>', replacement)
        messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(any(row.get('code') == 'FILING_OFFICE_CODE_LIMIT' for row in messages))
        self.assertFalse(any(row['kind'] == 'filing_finished' for row in messages))
        for fixture, state in [
            (base.replace('<button id="btnSearch">',
                '<label for="anotherOffice">Court Office</label><select id="anotherOffice"><option>05-2-99</option></select><button id="btnSearch">'), 'AMBIGUOUS'),
            (base.replace('<select id="fixtureOffice" name="fixtureOffice"><option value="">Choose</option></select>',
                '<select id="fixtureOffice" name="fixtureOffice">' + '<option>05-2-99</option>' * 2001 + '</select>'), 'OVER_LIMIT'),
        ]:
            # The unknown candidate's oversized options remain uninspected.
            messages, fetches = await self.run_fixture(filing=True, fixture=fixture)
            metadata = [row for row in messages if row['kind'] == 'filing_metadata']
            self.assertEqual(metadata[-1]['officeIdentification']['state'], state)
            self.assertIsNone(metadata[-1]['officeIdentification']['codes'])

    async def test_coverage_inventory_without_search_or_pdf(self):
        # Hypothetical public filter options ONLY, not source support or cases.
        fixture = public_fixture().replace('value="CalendarEvent">SEARCH_MODE',
            'value="CalendarEvent">Calendar Event').replace(
            '</select><input type="text" name="SearchBy"',
            '<option value="fixture_only_filing">Date Filed</option></select><input type="text" name="SearchBy"')
        fixture = fixture.replace('>EVENT_TYPE</option>', '>Bail Hearing</option><option>Preliminary Arraignment</option>')
        fixture += '<input type="date" form="absent" name="birth" value="2000-01-01">'
        messages, fetches = await self.run_fixture(coverage=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        self.assertTrue(all(method == "GET" for method, _ in fetches))
        metadata = [message for message in messages if message["kind"] == "coverage_metadata"]
        self.assertEqual([message["phase"] for message in metadata], ["INITIAL", "CALENDAR", "FILING"])
        self.assertTrue(all(message["modeAvailable"] for message in metadata))
        self.assertTrue(metadata[1]["bailHearingPresent"])
        self.assertTrue(metadata[1]["preliminarySingularPresent"])
        self.assertFalse(metadata[1]["preliminaryPluralPresent"])
        self.assertTrue(any(message["kind"] == "coverage_finished" for message in messages))
        self.assertFalse(any(message["kind"] in {"docket", "calendar", "inspection_metadata", "finished", "barrier"} for message in messages))
        retained = json.dumps(metadata)
        for forbidden in ["REDACTION_SENTINEL", "__RequestVerificationToken", "fixture_only_filing", "2026-10-13", "birth"]:
            self.assertNotIn(forbidden, retained)

    async def test_coverage_dependent_fetch_stops_without_transmission(self):
        fixture = public_fixture().replace('value="CalendarEvent">SEARCH_MODE', 'value="CalendarEvent">Calendar Event')
        messages, fetches = await self.run_fixture(
            script="document.addEventListener('change', () => fetch('/CaseSearch'));",
            coverage=True, fixture=fixture)
        self.assertEqual(len(fetches), 3)
        self.assertFalse(any(message["kind"] == "coverage_finished" for message in messages))
        self.assertTrue(any(message["kind"] == "barrier" for message in messages))

    async def test_unknown_coverage_labels_not_claimed_or_retained(self):
        messages, fetches = await self.run_fixture(coverage=True)
        self.assertEqual(len(fetches), 3)
        metadata = [message for message in messages if message["kind"] == "coverage_metadata"]
        self.assertEqual([message["modeAvailable"] for message in metadata], [True, False, False])
        self.assertEqual(metadata[2]["dates"], [])
        self.assertEqual(metadata[2]["officeCodes"], [])
        self.assertNotIn("SEARCH_MODE", json.dumps(metadata))

    async def test_actual_worker_intercepts_post_and_retains_only_metadata(self):
        messages, fetches = await self.run_fixture()
        self.assertEqual(fetches, [])
        self.assertEqual(messages, [{"kind": "barrier", "code": "FORM_INSPECTION_LIVE_DISABLED"}])

class InspectionRequestGateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.gate = InspectionRequestGate()
        self.js = "https://ujsportal.pacourts.us/resource/js/sitemain.min.js?v=abcdefghijklmnop"
        self.css = "https://ujsportal.pacourts.us/resource/css/sitemain.min.css?v=qrstuvwxyzABCDEF"
        self.html = (f'<script src="{self.js}"></script>'
                     f'<link rel="stylesheet" href="{self.css}">').encode()

    async def bootstrap(self):
        self.assertTrue(await self.gate.reserve(CASE_SEARCH, "GET", "document"))
        self.gate.declare_document(CASE_SEARCH, self.html)

    def test_only_exact_bounded_declared_assets_are_extracted(self):
        declared = declared_asset_urls(CASE_SEARCH, self.html)
        self.assertEqual(declared, frozenset({self.js, self.css}))
        for html in (
            b'<script src="https://evil.invalid/resource/js/sitemain.min.js?v=abcdefghijklmnop"></script>',
            b'<script src="/resource/js/sitemain.min.js?v=short"></script>',
            b'<script src="/resource/js/sitemain.min.js?v=abcdefghijklmnop&x=1"></script>',
            b'<link rel="stylesheet" href="/resource/css/other.css">',
            b'<script src="/resource/js/sitemain.min.js#fragment"></script>',
        ):
            self.assertFalse(declared_asset_urls(CASE_SEARCH, html))
        self.assertFalse(declared_asset_urls(CASE_SEARCH + "?x=1", self.html))
        self.assertFalse(declared_asset_urls(CASE_SEARCH, b"x" * 4_000_001))

    async def test_allowlist_method_resource_type_and_version_exactness(self):
        await self.bootstrap()
        self.assertTrue(await self.gate.reserve(self.js, "GET", "script"))
        self.assertTrue(await self.gate.reserve(self.css, "GET", "stylesheet"))
        self.assertEqual(self.gate.reserved_count, 3)
        for url, method, kind in (
            (self.js, "GET", "script"), (self.css, "GET", "stylesheet"),
            (CASE_SEARCH, "POST", "document"),
            (CASE_SEARCH, "GET", "fetch"),
            ("https://evil.invalid/CaseSearch", "GET", "document"),
            (CASE_SEARCH + "?query=1", "GET", "document"),
            (self.js.replace("abcdefghijklmnop", "ponmlkjihgfedcba"), "GET", "script"),
            (self.css.replace("?v=qrstuvwxyzABCDEF", ""), "GET", "stylesheet"),
            ("https://ujsportal.pacourts.us/other.js", "GET", "script"),
        ):
            self.assertFalse(await self.gate.reserve(url, method, kind))
        self.assertEqual(self.gate.reserved_count, 3)

    async def test_duplicate_concurrent_requests_reserve_one_transmission(self):
        await self.bootstrap()
        results = await asyncio.gather(*[
            self.gate.reserve(self.js, "GET", "script") for _ in range(20)
        ])
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.gate.reserved_count, 2)
        self.assertEqual(self.gate.reserved_paths, frozenset({"/CaseSearch", "/resource/js/sitemain.min.js"}))

    async def test_failed_timeout_and_uncertain_attempts_still_consume_the_path(self):
        await self.bootstrap()

        self.assertTrue(await self.gate.reserve(self.js, "GET", "script"))
        self.assertEqual(self.gate.reserved_count, 2)
        self.assertFalse(await self.gate.reserve(self.js, "GET", "script"))

    async def test_redirect_target_is_denied_by_the_request_gate(self):
        await self.bootstrap()
        self.assertFalse(await self.gate.reserve("https://evil.invalid/next", "GET", "document"))
        self.assertEqual(self.gate.reserved_count, 1)

    async def test_session_deadline_is_global_and_has_no_expired_fetch(self):
        clock = [100.0]
        gate = InspectionRequestGate(clock=lambda: clock[0])
        self.assertTrue(await gate.reserve(CASE_SEARCH, "GET", "document"))
        gate.declare_document(CASE_SEARCH, b"")

        clock[0] += 601
        self.assertFalse(await gate.reserve(
            "https://ujsportal.pacourts.us/resource/js/sitemain.min.js",
            "GET", "script",
        ))
        self.assertEqual(gate.remaining_timeout_ms(), 0)

    def test_submission_path_is_removed_and_inspector_is_hard_disabled(self):
        worker_source = Path(worker.__file__).read_text()
        inspect_source = (Path(__file__).resolve().parents[1] / "src/ujs/form_inspection.py").read_text()
        self.assertNotIn("local_post_metadata", worker_source + inspect_source)
        self.assertNotIn("inspection_armed", worker_source)
        self.assertNotIn("requestSubmit", worker_source + inspect_source)
        self.assertNotIn("locator(\"#btnSearch\").click", worker_source)

    async def test_missing_size_limit_fails_before_reading_any_chunk(self):
        reads = []

        async def read_chunk(_size):
            reads.append(True)
            return b"fixture"

        with self.assertRaisesRegex(ValueError, "INSPECTION_RESPONSE_SIZE_LIMIT_REQUIRED"):
            await read_bounded_response(read_chunk, max_bytes=None)
        self.assertEqual(reads, [])

    async def test_chunk_reader_accepts_exact_limit_and_stops_on_first_excess(self):
        chunks = [b"1234", b"5678"]
        exact_reads = []

        async def read_exact(_size):
            exact_reads.append(True)
            return chunks.pop(0) if chunks else b""

        self.assertEqual(await read_bounded_response(read_exact, max_bytes=8), b"12345678")

        oversized_chunks = [b"1234", b"5678", b"9"]
        oversized_reads = []

        async def read_oversized(_size):
            oversized_reads.append(True)
            return oversized_chunks.pop(0) if oversized_chunks else b""

        with self.assertRaises(ResponseSizeLimitError):
            await read_bounded_response(read_oversized, max_bytes=8)
        self.assertEqual(len(exact_reads), 3)
        self.assertEqual(len(oversized_reads), 3)

    def broker_message(self, body=b"fixture", headers=None):
        return {
            "allow": True, "requestId": "00000000-0000-4000-8000-000000000001",
            "status": 200, "headers": headers or [["Content-Type", "text/html"]],
            "body": base64.b64encode(body).decode("ascii"),
        }

    def test_broker_response_rejects_malformed_and_oversized_messages(self):
        message = self.broker_message()
        for invalid in (
            {**message, "body": "!invalid"},
            {**message, "status": True},
            {**message, "requestId": "not-a-reservation"},
            {**message, "headers": [["x", "bad\r\nheader"]]},
            {**message, "unexpected": "not-permitted"},
            self.broker_message(b"x" * (MAX_RESPONSE_BYTES + 1)),
        ):
            with self.assertRaisesRegex(RuntimeError, "INSPECTION_BROKER_RESPONSE_INVALID"):
                InspectionBrokerResponse(invalid)

    def test_broker_protocol_rejects_eof_interruption_and_oversized_lines(self):
        self.assertEqual(read_inspection_protocol_line(io.StringIO('{"allow":false}\n')),
                         '{"allow":false}\n')
        for invalid in ("", '{"allow":', "x" * (MAX_BROKER_MESSAGE_CHARS + 1)):
            with self.assertRaisesRegex(RuntimeError, "INSPECTION_BROKER_MESSAGE_INVALID"):
                read_inspection_protocol_line(io.StringIO(invalid))

    async def test_request_stage_router_preserves_duplicate_cookies_without_network(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"), headless=True,
                args=["--no-sandbox", "--disable-background-networking",
                      "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND"],
            )
            try:
                context = await browser.new_context(service_workers="block")
                page = await context.new_page()
                cdp = await context.new_cdp_session(page)
                router = InspectionRequestRouter(cdp)
                observed = []
                asset_headers = []

                async def fulfill(route):
                    observed.append(route.request.url)
                    if route.request.url == "https://broker-fixture.invalid/asset.js":
                        asset_headers.append(await route.request.all_headers())
                        response = InspectionBrokerResponse(self.broker_message(
                            b"window.offlineAssetLoaded=true;",
                            [["Content-Type", "application/javascript"]],
                        ))
                        await route.fulfill(response=response)
                        return
                    if route.request.url != "https://broker-fixture.invalid/CaseSearch":
                        await route.abort()
                        return
                    response = InspectionBrokerResponse(self.broker_message(
                        b'<html><body>offline broker fixture<script src="/asset.js"></script></body></html>',
                        [["Content-Type", "text/html"],
                         ["Set-Cookie", "first=one; Path=/; Secure"],
                         ["Set-Cookie", "second=two; Path=/; Secure"]],
                    ))
                    await route.fulfill(response=response)
                    await response.dispose()

                await router.start(fulfill)
                response = await page.goto(
                    "https://broker-fixture.invalid/CaseSearch", wait_until="load", timeout=15_000,
                )
                self.assertEqual(response.status, 200)
                self.assertIn("offline broker fixture", await page.content())
                cookies = {cookie["name"]: cookie["value"] for cookie in await context.cookies()}
                self.assertEqual(cookies, {"first": "one", "second": "two"})
                self.assertEqual(observed[0], "https://broker-fixture.invalid/CaseSearch")
                self.assertTrue(await page.evaluate("window.offlineAssetLoaded"))
                self.assertEqual(len(asset_headers), 1)
                self.assertIn("first=one", asset_headers[0].get("cookie", ""))
                self.assertIn("second=two", asset_headers[0].get("cookie", ""))
            finally:
                await browser.close()

    async def test_local_form_snapshot_never_invokes_click_or_submission(self):
        from form_inspection import snapshot

        html = inspection_scope_fixture()
        html = html.replace(
            '<form method="post" action="https://ujsportal.pacourts.us/CaseSearch">',
            '<script>window.attempts={click:0,submit:0,requestSubmit:0};'
            'document.addEventListener("click",()=>window.attempts.click++);'
            'document.addEventListener("submit",()=>window.attempts.submit++);'
            'HTMLFormElement.prototype.submit=function(){window.attempts.submit++};'
            'HTMLFormElement.prototype.requestSubmit=function(){window.attempts.requestSubmit++};'
            '</script><form method="post" action="https://ujsportal.pacourts.us/CaseSearch">',
        )
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=shutil.which("chromium"),
                headless=True,
                args=["--disable-background-networking", "--disable-component-update",
                      "--disable-sync", "--no-first-run", "--no-sandbox"],
            )
            page = await browser.new_page()
            requests = []
            page.on("request", lambda request: requests.append(request.url))
            await page.set_content(html, wait_until="load", timeout=5_000)
            await select_calendar_preview_controls(page, INSPECTION_CRITERIA)
            metadata = await snapshot(page, INSPECTION_CRITERIA)
            attempts = await page.evaluate("window.attempts")
            await browser.close()
        self.assertEqual(attempts, {"click": 0, "submit": 0, "requestSubmit": 0})
        self.assertEqual(requests, [])
        self.assertEqual(metadata["phase"], "BEFORE")
        self.assertEqual([row["control"] for row in metadata["controls"]], [
            "SEARCH_MODE", "JUDICIAL_DISTRICT", "COURT_OFFICE", "COURT_ROOM",
            "START_DATE", "END_DATE", "EVENT_TYPE",
        ])
        self.assertTrue(all(row["uiMatches"] and row["uiEnabled"] and row["uiSameForm"]
                            for row in metadata["controls"]))
        self.assertTrue(
            all(row["nativeMatches"] == 1 for row in metadata["controls"]),
            json.dumps(metadata["controls"]),
        )
        self.assertNotIn("fixture-room-value", json.dumps(metadata))
        self.assertEqual(metadata["controls"][3]["types"]["select"], 1)
