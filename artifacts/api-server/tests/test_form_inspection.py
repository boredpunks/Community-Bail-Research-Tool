"""Network-blocked public-form fixtures. No court traffic or docket/case data."""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode, urlsplit
from playwright.async_api import Route

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import worker
from form_inspection import local_post_metadata, expected

CRITERIA = {"courtOffice": "CP-05-02-Crim", "eventType": "Bail Hearing",
            "startDate": "2026-10-13", "endDate": "2026-10-17"}


def public_fixture():
    # Explicitly hypothetical widget/native text layout, not source proof.
    groups = []
    for label, selector, container, key, value in expected(CRITERIA):
        if container:
            groups.append(f'<div id="{container}"><select><option value="{value}">{label}</option></select>'
                          f'<input type="text" name="{key}" value="{value}" style="display:none">'
                          '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></div>')
        else:
            groups.append(f'<input type="date" name="{key}" value="{value}">')
    return ('<!-- hypothetical public form; no case data -->'
            '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
            '<script src="/resource/js/sitemain.min.js"></script>'
            '<form method="post" action="https://ujsportal.pacourts.us/CaseSearch">'
            + "".join(groups) + '<button id="btnSearch">Search</button></form>')


class InspectionWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def run_fixture(self, script="/* public fixture */", coverage=False, fixture=None, filing=False):
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

        config = {"criteria": CRITERIA, "inspectionOnly": not (coverage or filing), "coverageOnly": coverage,
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
                patch.object(worker, "download", side_effect=AssertionError("PDFs prohibited")):
            await worker.main()
        return messages, fetches

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
        return fixture.replace('<button id="btnSearch">', groups + '<button id="btnSearch">')

    async def test_filing_source_labels_only_and_native_counts_redacted(self):
        script = """document.addEventListener('submit', () => {throw Error('Search prohibited');});
        document.addEventListener('change', () => {
          const type = document.getElementById('fixtureCourt'), county = document.getElementById('fixtureCounty');
          const criminal = document.getElementById('fixtureCase'), office = document.getElementById('fixtureOffice');
          if (type.value || county.value || criminal.value) throw Error('Scope selection prohibited');
        });"""
        messages, fetches = await self.run_fixture(filing=True, fixture=self.filing_fixture(), script=script)
        self.assertEqual(len(fetches), 3)
        metadata = [message for message in messages if message["kind"] == "filing_metadata"]
        self.assertEqual([row["phase"] for row in metadata], ['INITIAL', 'FILING', 'FINAL'])
        final = metadata[-1]
        self.assertTrue(final['modeMatchesFiling'])
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
        self.assertEqual([row['phase'] for row in metadata], ['INITIAL', 'FILING', 'FINAL'])
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
        self.assertEqual(len(fetches), 3)
        self.assertTrue(all(method == "GET" for method, _ in fetches))
        self.assertEqual({path for _, path in fetches},
                         {"/CaseSearch", "/resource/css/sitemain.min.css", "/resource/js/sitemain.min.js"})
        self.assertEqual(sum(message["kind"] == "request" for message in messages), 3)
        snapshots = [message for message in messages if message["kind"] == "inspection_metadata"]
        self.assertEqual([message["phase"] for message in snapshots], ["BEFORE", "LOCAL_POST"])
        self.assertEqual([row["nativePostedMatches"] for row in snapshots[-1]["controls"]], [1] * 6)
        self.assertEqual(snapshots[0]["controls"][0]["types"]["text"], 1)
        self.assertEqual(snapshots[0]["controls"][0]["types"]["hidden"], 0)
        self.assertTrue(any(message["kind"] == "inspection_finished" for message in messages))
        self.assertFalse(any(message["kind"] in {"calendar", "docket", "finished", "barrier"} for message in messages))
        retained = json.dumps(snapshots)
        for forbidden in ["REDACTION_SENTINEL", "__RequestVerificationToken", "CP-05-02-Crim", "2026-10-13"]:
            self.assertNotIn(forbidden, retained)

    async def test_dependent_control_requests_are_aborted_not_fetched(self):
        messages, fetches = await self.run_fixture(
            "document.addEventListener('change', () => fetch('/CaseSearch'));")
        self.assertEqual(len(fetches), 3)
        self.assertFalse(any(message["kind"] == "inspection_finished" for message in messages))
        self.assertTrue(any(message["kind"] == "barrier" for message in messages))

    def test_body_limits_and_known_key_observation_are_not_binding_proof(self):
        before = {"controls": [{"control": item[0], "types": {}} for item in expected(CRITERIA)]}
        bindings = [[] for _ in range(6)]
        body = urlencode({item[3]: item[4] for item in expected(CRITERIA)})
        result = local_post_metadata(before, bindings, CRITERIA,
                                     body + "&__RequestVerificationToken=REDACTION_SENTINEL",
                                     "application/x-www-form-urlencoded")
        self.assertEqual([row["nativePostedMatches"] for row in result["controls"]], [0] * 6)
        self.assertEqual([row["knownKeyPostedMatches"] for row in result["controls"]], [1] * 6)
        self.assertNotIn("REDACTION_SENTINEL", json.dumps(result))
        for bad_body, content_type in [("x" * 131073, "application/x-www-form-urlencoded"),
                                      (body, "application/json"),
                                      ("&".join(["a=x"] * 129), "application/x-www-form-urlencoded")]:
            with self.assertRaisesRegex(RuntimeError, "^INSPECTION_BODY_UNSUPPORTED$"):
                local_post_metadata(before, bindings, CRITERIA, bad_body, content_type)
