"""Loopback-only reproduction: public form and header-only table, never cases."""
import asyncio
import gc
import io
import json
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.async_api import Response, Route, TimeoutError as BrowserTimeout

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import calendar_protocol
import worker
from evidence import CalendarResults
from test_form_inspection import CRITERIA, public_fixture
from source_protocol import allowed


CHANGED_ASSET_VERSION = "fixture_new_version_0001"


class CalendarLoadTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def run_fixture(self, *, missing_grid=False, changed_version=False,
                          dependent_replacement=False, initialize_button=False,
                          hidden_button=False, selected_room=False):
        # Scale the real completion-to-start pacing and click deadline together:
        # 80 logical seconds per request, a 180-logical-second navigation limit.
        scale = 0.02
        original_fetch = Route.fetch
        original_pause = calendar_protocol.response_pause
        original_submit = worker.submit_calendar_search
        original_feed = CalendarResults.feed
        original_field_count = worker.calendar_form_field_count
        field_shapes = []
        container_visibility = []
        messages, network, timeouts, parsed = [], [], [], []
        # The shared inspection fixture deliberately has a verification input
        # inside every unnamed widget. That makes each widget's backing model
        # ambiguous to calendar preflight. Keep one normal form-level token,
        # outside the widgets, rather than weakening the production validator.
        initial = public_fixture().replace(
            '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL">', ''
        ).replace('</form>',
                  '<select name="CourtRoomID"><option value="" selected></option>'
                  '<option value="fixture-room">Courtroom 506</option></select>'
                  '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></form>')
        if selected_room:
            initial = initial.replace('<option value="" selected>', '<option value="">').replace(
                '<option value="fixture-room">', '<option value="fixture-room" selected>')
        # This shared fixture originally displayed internal diagnostic tokens
        # instead of public labels. Exact-label selection must remain strict;
        # use the already documented public labels in this local fixture only.
        for value, token, label in (
            ("CalendarEvent", "SEARCH_MODE", "Calendar Event"),
            ("05", "JUDICIAL_DISTRICT", "Allegheny - 05"),
            (CRITERIA["courtOffice"], "COURT_OFFICE", CRITERIA["courtOffice"]),
            ("Bail Hearing", "EVENT_TYPE", "Bail Hearing"),
        ):
            initial = initial.replace(
                f'<option value="{value}">{token}</option>',
                f'<option value="{value}">{label}</option>')
        if dependent_replacement:
            # Hypothetical public widget replacement, not a claim about live DOM.
            initial = initial.replace('<form method=', '<form style="display:contents" method=')
            initial = initial.replace(
                f'<option value="{CRITERIA["courtOffice"]}">{CRITERIA["courtOffice"]}</option>',
                '<option value="CP-05-02-Fam" selected>CP-05-02-Fam</option>'
                '<option value="CP-05-02-Crim">CP-05-02-Crim</option>')
            initial = initial.replace(
                'name="CourtOffice" value="CP-05-02-Crim"',
                'name="CourtOffice" value="CP-05-02-Fam"')
            initial = initial.replace('</form>',
                '<input type="hidden" name="OfficeContextBefore" value="public-fixture"></form>')
            initial += """<script>
              document.querySelector("#CourtOffice-Control select").addEventListener("change", event => {
                const old = document.querySelector("#CourtOffice-Control");
                const replacement = old.cloneNode(true);
                replacement.querySelector("select").value = event.target.value;
                replacement.querySelector("input[name=CourtOffice]").value = event.target.value;
                old.replaceWith(replacement);
                const context = document.querySelector("input[name=OfficeContextBefore]");
                context.name = "OfficeContextAfter";
              });
            </script>"""
        script_body = "/* offline public fixture */"
        if initialize_button:
            script_body = """document.addEventListener("DOMContentLoaded", () => {
              const button = document.querySelector("#btnSearch");
              if (!button) return;
              const form = button.form; button.remove();
              setTimeout(() => form.append(button), 100);
            });"""
        elif hidden_button:
            script_body = """document.addEventListener("DOMContentLoaded", () => {
              const button = document.querySelector("#btnSearch");
              if (button) button.hidden = true;
            });"""
        headers = ["Column"] * 18
        for index, label in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                             9: "County", 10: "Court Office", 14: "Event Type"}.items():
            headers[index] = label
        results = (
            '<!-- offline header-only result; not a validated empty result -->'
            '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
            '<script src="/resource/js/sitemain.min.js"></script>'
            '<table id="caseSearchResultGrid"><thead><tr>'
            + ''.join('<th>' + text + '</th>' for text in headers)
            + '</tr></thead><tbody></tbody></table>')
        if missing_grid:
            results = results.replace('id="caseSearchResultGrid"', 'id="fixtureMissingResult"')
        if changed_version:
            results = results.replace('href="/resource/css/sitemain.min.css"',
                                      f'href="/resource/css/sitemain.min.css?v={CHANGED_ASSET_VERSION}"')
            # Exercise a valid changed version, not the policy's invalid-token
            # branch. The production 16–128-character requirement is unchanged.
            self.assertTrue(allowed(
                f"https://ujsportal.pacourts.us/resource/css/sitemain.min.css?v={CHANGED_ASSET_VERSION}",
                "GET"))

        async def serve(reader, writer):
            try:
                head = await reader.readuntil(b"\r\n\r\n")
                lines = head.decode("ascii").split("\r\n")
                method, target, _ = lines[0].split()
                length = next((int(line.split(":", 1)[1]) for line in lines[1:]
                               if line.lower().startswith("content-length:")), 0)
                if length:
                    await reader.readexactly(length)  # Ephemeral; never retained.
                network.append((method, target))
                path = urlsplit(target).path
                if path == "/CaseSearch":
                    body = results if method == "POST" else initial
                    content_type = "text/html"
                elif path == "/resource/js/sitemain.min.js":
                    body, content_type = script_body, "application/javascript"
                elif path == "/resource/css/sitemain.min.css":
                    body, content_type = "/* offline public fixture */", "text/css"
                else:
                    raise AssertionError("Unexpected loopback fixture request")
                body = body.encode()
                writer.write((f"HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n"
                              f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body)
                await writer.drain()
            finally:
                writer.close()
                await writer.wait_closed()

        async def local_fetch(route, **kwargs):
            # The production route policy still sees the exact source URL.
            # The transport is replaced before DNS/network access and can only
            # reach this ephemeral loopback listener.
            parsed_url = urlsplit(route.request.url)
            target = parsed_url.path + ("?" + parsed_url.query if parsed_url.query else "")
            return await original_fetch(route, url=f"http://127.0.0.1:{port}{target}", **kwargs)

        def scaled_pause(last_completed, now, interval):
            return original_pause(None if last_completed is None else last_completed / scale,
                                  now / scale, interval) * scale

        async def observe_submit(page):
            try:
                await original_submit(page)
            except BrowserTimeout:
                timeouts.append("BrowserTimeout")
                raise

        def observe_feed(parser, html):
            parsed.append(True)
            return original_feed(parser, html)

        async def observe_field_count(page):
            # Fixture-only comparison proves the old whole-form equality would
            # reject this otherwise valid dependent-control replacement.
            field_shapes.append(await page.evaluate("""() =>
              [...new FormData(document.querySelector("#btnSearch").form).keys()]"""))
            container_visibility.append(await page.locator("form").evaluate("""el => {
              const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0;
            }"""))
            return await original_field_count(page)

        server = await asyncio.start_server(serve, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        config = {"criteria": CRITERIA, "calendarComplete": False, "pendingItems": [],
                  "remainingRecords": 0, "calendarPreviewOnly": True}
        protocol = []
        for index in range(8):
            protocol.extend([json.dumps({"allow": True, "requestId": f"offline-{index}"}),
                             json.dumps({"continue": True})])
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()
        shutdown_errors = []

        def capture_unhandled(loop, context):
            shutdown_errors.append(type(context.get("exception")).__name__)
            # Assert on warnings without hiding them from the real test output.
            if previous_handler:
                previous_handler(loop, context)
            else:
                loop.default_exception_handler(context)

        loop.set_exception_handler(capture_unhandled)
        try:
            with ExitStack() as stack:
                stack.enter_context(patch.object(Route, "fetch", local_fetch))
                stack.enter_context(patch.object(worker.sys, "stdin", io.StringIO('\n'.join(protocol) + '\n')))
                stack.enter_context(patch.object(worker, "emit", lambda kind, **values:
                                                messages.append({"kind": kind, **values})))
                stack.enter_context(patch.object(worker, "response_pause", scaled_pause))
                stack.enter_context(patch.object(worker.random, "uniform", return_value=80))
                stack.enter_context(patch.object(calendar_protocol, "SEARCH_CLICK_TIMEOUT_MS", int(180_000 * scale)))
                stack.enter_context(patch.object(calendar_protocol, "CALENDAR_FORM_READY_TIMEOUT_MS", 1_000))
                stack.enter_context(patch.object(worker, "calendar_form_field_count", observe_field_count))
                # The normal fixture's result deadline is shorter than the
                # 1.6-second pre-POST pause. It must start after that pause.
                stack.enter_context(patch.object(calendar_protocol, "CALENDAR_RESULT_TIMEOUT_MS",
                                                100 if missing_grid else 4_000 if changed_version else 1_000))
                stack.enter_context(patch.object(worker, "submit_calendar_search", observe_submit))
                stack.enter_context(patch.object(CalendarResults, "feed", observe_feed))
                stack.enter_context(patch.object(Response, "finished",
                                                side_effect=AssertionError("Use the public requestfinished waiter")))
                stack.enter_context(patch.object(worker, "download", side_effect=AssertionError("No PDFs")))
                await worker.main(config)
        finally:
            server.close()
            await server.wait_closed()
            # Surface any abandoned library tasks after browser/context close,
            # while our asserting handler is still installed.
            gc.collect()
            await asyncio.sleep(0)
            loop.set_exception_handler(previous_handler)
        states = [row["state"] for row in messages if row["kind"] == "calendar_state"]
        barriers = [row["code"] for row in messages if row["kind"] == "barrier"]
        observations = {
            "network": network, "timeouts": timeouts, "parserReached": bool(parsed),
            "states": states, "barriers": barriers,
            "formDiagnostics": [row for row in messages if row["kind"] == "calendar_form_diagnostic"],
            "requestGrants": sum(row["kind"] == "request" for row in messages),
            "responseAccounts": sum(row["kind"] == "response" for row in messages),
            "diagnostics": [row for row in messages if row["kind"] == "calendar_diagnostics"],
            "shutdownErrors": shutdown_errors,
            "formShapeChanged": len(field_shapes) == 2 and field_shapes[0] != field_shapes[1],
            "formContainerHasBox": container_visibility,
            "formStates": [row for row in messages if row["kind"] == "calendar_state"],
        }
        print("\nOFFLINE_REPRODUCTION", json.dumps(observations), flush=True)
        self.assertEqual(shutdown_errors, [], "Unhandled asynchronous shutdown errors")
        return observations

    async def test_search_reaches_parser_without_repeated_asset_network_calls(self):
        observed = await self.run_fixture()
        self.assertFalse(observed["timeouts"], "Full-load wait timed out before the result parser")
        self.assertTrue(observed["parserReached"], "Result parser must be reached")
        # A header-only fixture must remain unvalidated; never invent empty proof.
        self.assertIn("RESULTS_NOT_VALIDATED", observed["states"])
        self.assertEqual(observed["barriers"], ["RESULTS_NOT_VALIDATED"])
        self.assertEqual(sum(path == "/resource/js/sitemain.min.js" for _, path in observed["network"]), 1)
        self.assertEqual(sum(path == "/resource/css/sitemain.min.css" for _, path in observed["network"]), 1)
        self.assertEqual(sum(method == "POST" for method, _ in observed["network"]), 1)
        self.assertEqual(len(observed["network"]), 4)
        self.assertEqual(observed["requestGrants"], 4)
        self.assertEqual(observed["responseAccounts"], 4)
        self.assertEqual(observed["diagnostics"][-1]["networkRequests"], 4)
        self.assertEqual(observed["diagnostics"][-1]["cachedResponses"], 2)

    async def test_missing_result_grid_reports_honest_post_search_timeout(self):
        observed = await self.run_fixture(missing_grid=True)
        self.assertEqual(observed["timeouts"], ["BrowserTimeout"])
        self.assertFalse(observed["parserReached"])
        self.assertIn("RESULTS_NOT_VALIDATED", observed["states"])
        self.assertEqual(observed["barriers"], ["CALENDAR_RESULT_LOAD_TIMEOUT"])
        self.assertEqual(observed["requestGrants"], 4)
        self.assertEqual(observed["responseAccounts"], 4)

    async def test_changed_asset_version_does_not_reuse_bootstrap_bytes(self):
        observed = await self.run_fixture(changed_version=True)
        self.assertFalse(observed["timeouts"])
        self.assertTrue(observed["parserReached"])
        self.assertEqual(observed["barriers"], ["RESULTS_NOT_VALIDATED"])
        self.assertIn(("GET", f"/resource/css/sitemain.min.css?v={CHANGED_ASSET_VERSION}"), observed["network"])
        self.assertEqual(len(observed["network"]), 5)
        self.assertEqual(observed["requestGrants"], 5)
        self.assertEqual(observed["responseAccounts"], 5)
        self.assertEqual(observed["diagnostics"][-1]["cachedResponses"], 1)

    async def test_dependent_control_replacement_reaches_final_validation_and_parser(self):
        observed = await self.run_fixture(dependent_replacement=True)
        self.assertTrue(observed["formShapeChanged"])
        self.assertEqual(observed["formContainerHasBox"], [False, False])
        self.assertTrue(observed["parserReached"])
        self.assertEqual(observed["formDiagnostics"], [])
        self.assertEqual(observed["barriers"], ["RESULTS_NOT_VALIDATED"])
        self.assertEqual(observed["requestGrants"], 4)
        self.assertEqual(observed["responseAccounts"], 4)
        self.assertEqual(sum(method == "POST" for method, _ in observed["network"]), 1)

    async def test_delayed_search_button_initialization_is_awaited(self):
        observed = await self.run_fixture(initialize_button=True)
        self.assertTrue(observed["parserReached"])
        self.assertEqual(observed["barriers"], ["RESULTS_NOT_VALIDATED"])
        self.assertEqual(observed["formDiagnostics"], [])

    async def test_hidden_search_button_stops_before_post_with_phase_and_reason(self):
        observed = await self.run_fixture(hidden_button=True)
        self.assertFalse(observed["parserReached"])
        self.assertEqual(observed["barriers"], ["CALENDAR_FORM_INITIALIZATION_TIMEOUT"])
        self.assertEqual(observed["formDiagnostics"], [{
            "kind": "calendar_form_diagnostic",
            "code": "CALENDAR_FORM_INITIALIZATION_TIMEOUT", "control": "SEARCH_BUTTON",
            "reason": "HIDDEN", "phase": "INITIALIZATION",
        }])
        self.assertFalse(observed["formStates"][-1]["formVisible"])
        self.assertEqual(observed["requestGrants"], 3)
        self.assertFalse(any(method == "POST" for method, _ in observed["network"]))

    async def test_no_room_scope_never_silently_uses_source_selected_room(self):
        observed = await self.run_fixture(selected_room=True)
        self.assertFalse(observed["parserReached"])
        self.assertEqual(observed["formDiagnostics"], [{
            "kind": "calendar_form_diagnostic",
            "code": "CALENDAR_CONTROL_STATE_MISMATCH", "control": "COURT_ROOM",
            "reason": "NO_FILTER_NOT_SELECTED", "phase": "CONTROL_SELECTION",
        }])
        self.assertFalse(any(method == "POST" for method, _ in observed["network"]))
