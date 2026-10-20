"""Loopback-only reproduction: public form and header-only table, never cases."""
import asyncio
import gc
import io
import json
import os
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
                          hidden_button=False, selected_room=False, post_case=None, bounded=False,
                          large_page=None):
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
                  '<select title="Room" name="CourtRoomID"><option value="" selected></option>'
                  '<option value="fixture-room">Courtroom 506</option></select>'
                  '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></form>')
        if selected_room:
            initial = initial.replace('<option value="" selected>', '<option value="">').replace(
                '<option value="fixture-room">', '<option value="fixture-room" selected>')
        if bounded:
            initial = initial.replace('<select title="Room" name="CourtRoomID"', '<select title="Room" aria-label="Courtroom" name="CourtRoomID"')
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
        if post_case == "pre_post_console":
            script_body = """document.addEventListener("DOMContentLoaded", () =>
              document.querySelector("#btnSearch").addEventListener("click", () =>
                console.error("REDACTION_SENTINEL")));"""
        elif post_case == "mutated_post":
            script_body = """document.addEventListener("DOMContentLoaded", () =>
              document.querySelector("#btnSearch").addEventListener("click", () => {
                document.querySelector('input[name="CalendarEventStartDate"]').value = "2026-10-05";
              }));"""
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
              if (button) button.style.visibility = "hidden";
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
        if large_page:
            # Only explicit empty/status structures, never synthetic cases.
            from test_calendar_response_size import PADDING, empty_grid
            results = (
                '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
                '<script src="/resource/js/sitemain.min.js"></script>' +
                (empty_grid() + PADDING if large_page == "early" else PADDING + empty_grid()))
            if large_page == "warning":
                results += ('<p>Not all results are shown for Common Pleas. Please narrow your search.</p>'
                            '<a href="?pageIndex=2">Next</a>')
            if large_page == "case_information":
                info_headers = ["Column"] * 12
                for index, label in {0: "Docket Number", 1: "Court Type", 4: "Filing Date",
                                     7: "County", 8: "Court Office"}.items():
                    info_headers[index] = label
                results = (
                    '<link rel="stylesheet" href="/resource/css/sitemain.min.css">'
                    '<script src="/resource/js/sitemain.min.js"></script>'
                    '<table id="caseSearchResultGrid"><thead><tr>'
                    + ''.join('<th>' + label + '</th>' for label in info_headers)
                    + '</tr></thead><tbody></tbody></table>')
            if large_page == "oversized":
                results += PADDING * 3
            if large_page == "malformed":
                results = results.replace("</table>", "")
        if missing_grid:
            results = results.replace('id="caseSearchResultGrid"', 'id="fixtureMissingResult"')
        if post_case == "duplicate_grids":
            results += '<table id="caseSearchResultGrid"><tr><th>Column</th></tr></table>'
        if changed_version:
            results = results.replace('href="/resource/css/sitemain.min.css"',
                                      f'href="/resource/css/sitemain.min.css?v={CHANGED_ASSET_VERSION}"')
            # Exercise a valid changed version, not the policy's invalid-token
            # branch. The production 16–128-character requirement is unchanged.
            self.assertTrue(allowed(
                f"https://ujsportal.pacourts.us/resource/css/sitemain.min.css?v={CHANGED_ASSET_VERSION}",
                "GET"))
        if post_case == "optional_abort":
            results = '<img src="/fixture-optional?token=REDACTION_SENTINEL">' + results
        elif post_case == "required_script":
            results = results.replace('src="/resource/js/sitemain.min.js"',
                'src="/resource/js/sitemain.min.js?v=fixture_required_failure_0001"')
        elif post_case == "runtime_exception":
            results = '<script>throw new Error("REDACTION_SENTINEL");</script>' + results
        elif post_case == "frame_console":
            results = ('<iframe srcdoc="&lt;script&gt;console.error(&quot;'
                       'REDACTION_SENTINEL&quot;)&lt;/script&gt;"></iframe>' + results)
        elif post_case == "other_console":
            results = '<script>console.error("REDACTION_SENTINEL token=private-fixture");</script>' + results
        elif post_case == "unclassified_console":
            results = """<script>eval('console.error("REDACTION_SENTINEL");\\n'
              + '//# sourceURL=https://invalid.test/REDACTION_SENTINEL?token=private-fixture');</script>""" + results
        elif post_case == "post_stop_fetch":
            results = '<script>console.error("REDACTION_SENTINEL"); fetch("/CaseSearch").catch(() => {});</script>' + results
        elif post_case == "returned_form":
            results = initial
        elif post_case == "malformed_headers":
            results = results.replace("Docket Number", "Unrecognized public header")
        elif post_case == "pre_post_wait_error":
            initial += """<script>
              document.querySelector("#btnSearch").form.addEventListener("submit", () => {
                setTimeout(() => console.error("REDACTION_SENTINEL"), 50);
              });
            </script>"""

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
                status = "503 Service Unavailable" if post_case == "required_script" and "fixture_required_failure" in target else "200 OK"
                writer.write((f"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\n"
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

        async def fixture_calendar_fetch(stream, route):
            # Only this local worker fixture replaces transport; the real CDP
            # bounded stream is separately exercised against a loopback server.
            return await local_fetch(route, max_redirects=0, max_retries=0, timeout=45_000)

        async def fixture_calendar_start(stream):
            pass  # Real response interception is covered by loopback stream tests.

        def scaled_pause(last_completed, now, interval):
            return original_pause(None if last_completed is None else last_completed / scale,
                                  now / scale, interval) * scale

        async def observe_submit(page):
            try:
                await original_submit(page)
                if post_case:
                    await page.wait_for_load_state("load")
            except BrowserTimeout:
                timeouts.append("BrowserTimeout")
                raise

        def observe_feed(parser, html):
            parsed.append(True)
            if post_case == "projection_extra_row":
                html = html.replace("</table>", "<tr><td></td></tr></table>")
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
        if bounded:
            config.update(calendarPreviewOnly=False, boundedEngineObservation=True)
            config["criteria"] = {**CRITERIA, "courtRoom": "Courtroom 506",
                                  "recordCap": 5, "requestCap": 12}
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
        class ParentPacedProtocol(io.StringIO):
            reads = 0

            def readline(self, *args, **kwargs):
                # Simulate the shared parent's pre-POST pacing wait, rather
                # than relying on the retired child-side 60–90-second floor.
                if post_case == "pre_post_wait_error" and self.reads == 6:
                    import time
                    time.sleep(0.15)
                self.reads += 1
                return super().readline(*args, **kwargs)

        try:
            with ExitStack() as stack:
                stack.enter_context(patch.object(Route, "fetch", local_fetch))
                stack.enter_context(patch.object(worker.CalendarStream, "fetch", fixture_calendar_fetch))
                stack.enter_context(patch.object(worker.CalendarStream, "start", fixture_calendar_start))
                stack.enter_context(patch.object(worker.sys, "stdin", ParentPacedProtocol('\n'.join(protocol) + '\n')))
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
                                                100 if missing_grid or post_case == "returned_form" else 4_000 if changed_version or post_case == "required_script" else 1_000))
                stack.enter_context(patch.object(worker, "submit_calendar_search", observe_submit))
                stack.enter_context(patch.object(CalendarResults, "feed", observe_feed))
                stack.enter_context(patch.object(Response, "finished",
                                                side_effect=AssertionError("Use the public requestfinished waiter")))
                document_open = stack.enter_context(patch.object(
                    worker.public_http, "download", side_effect=AssertionError("No PDFs")))
                await worker.main(config)
                document_open.assert_not_awaited()
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
            "responseDiagnostics": [row for row in messages if row["kind"] == "calendar_response_diagnostic"],
            "layoutDiagnostics": [row for row in messages if row["kind"] == "calendar_layout"],
            "checkpointEmitted": any(row["kind"] in ("calendar", "docket", "calendar_preview_finished") for row in messages),
            "calendars": [row for row in messages if row["kind"] == "calendar"],
            "sizes": [row for row in messages if row["kind"] == "calendar_response_size"],
        }
        capture = os.environ.get("CALENDAR_DIAGNOSTIC_CAPTURE")
        if capture:
            with open(capture, "a") as output:
                for row in observations["responseDiagnostics"]:
                    output.write(json.dumps(row) + "\n")
        for row in observations["responseDiagnostics"]:
            self.assertEqual(row["version"], 4)
            serialized = json.dumps(row)
            for private in ("REDACTION_SENTINEL", "private-fixture", "invalid.test", "?token", "CourtRoomID", "fixture-room"):
                self.assertNotIn(private, serialized)
        print("\nOFFLINE_REPRODUCTION", json.dumps(observations), flush=True)
        self.assertEqual(shutdown_errors, [], "Unhandled asynchronous shutdown errors")
        return observations

    async def test_large_response_validates_explicit_empty_early_and_late(self):
        for position in ("early", "late"):
            o = await self.run_fixture(large_page=position)
            self.assertEqual(o["requestGrants"], 4)
            self.assertEqual(o["responseAccounts"], 4)
            self.assertEqual(o["barriers"], [])
            self.assertEqual(o["calendars"][0]["rows"], [])
            self.assertTrue(o["calendars"][0]["paginationComplete"])
            self.assertFalse(o["calendars"][0]["resultCapReached"])
            self.assertIn("EMPTY_RESULTS_VALIDATED", o["states"])

    async def test_large_warning_preserves_incomplete_coverage(self):
        o = await self.run_fixture(large_page="warning")
        self.assertFalse(o["calendars"][0]["paginationComplete"])
        self.assertTrue(o["calendars"][0]["resultCapReached"])

    async def test_case_information_headers_flow_through_production_diagnostics_and_parser(self):
        # Header-only is deliberately not empty-result evidence; no synthetic
        # docket or personal row is added to exercise this production path.
        o = await self.run_fixture(large_page="case_information")
        self.assertEqual(o["calendars"], [])
        self.assertTrue(o["responseDiagnostics"][-1]["structure"]["expectedHeaders"])
        self.assertEqual(o["responseDiagnostics"][-1]["structure"]["headerCellCount"], 12)
        self.assertEqual(o["responseDiagnostics"][-1]["parserOutcome"], "UNSUPPORTED_LAYOUT")
        self.assertEqual(o["responseDiagnostics"][-1]["resultValidation"]["outcome"], "UNSUPPORTED_LAYOUT")
        self.assertEqual(o["responseDiagnostics"][-1]["documentEligibility"], "BLOCKED_RESULT")
        self.assertIn("UNSUPPORTED_LAYOUT", o["barriers"])

    async def test_large_malformed_grid_is_not_repaired_into_acceptance(self):
        o = await self.run_fixture(large_page="malformed")
        self.assertEqual(o["calendars"], [])
        self.assertIn("UNSUPPORTED_LAYOUT", o["barriers"])
        self.assertEqual(o["responseDiagnostics"][-1]["parserOutcome"], "UNSUPPORTED_LAYOUT")
        self.assertEqual(o["responseDiagnostics"][-1]["resultValidation"]["validatedRows"], 0)
        layout = o["layoutDiagnostics"][-1]
        self.assertEqual(layout["version"], 2)
        self.assertIn("SOURCE_FRAMING_REJECTED", layout["rejectionReasons"])
        self.assertIn("UNCLOSED_RESULT_CONTENT", layout["rejectionReasons"])

    async def test_projection_table_count_rejection_is_attributable(self):
        o = await self.run_fixture(post_case="duplicate_grids")
        self.assertEqual(o["calendars"], [])
        layout = o["layoutDiagnostics"][-1]
        self.assertIn("RESULT_TABLE_COUNT", layout["rejectionReasons"])
        self.assertEqual(o["responseDiagnostics"][-1]["resultValidation"]["validatedRows"], 0)

    async def test_projection_row_count_disagreement_is_attributable(self):
        o = await self.run_fixture(post_case="projection_extra_row")
        self.assertEqual(o["calendars"], [])
        self.assertIn("SOURCE_STRUCTURE_MISMATCH", o["layoutDiagnostics"][-1]["rejectionReasons"])
        self.assertEqual(o["responseDiagnostics"][-1]["resultValidation"]["validatedRows"], 0)

    async def test_oversized_response_stops_without_empty_proof(self):
        o = await self.run_fixture(large_page="oversized")
        self.assertEqual(o["calendars"], [])
        self.assertIn("SIZE_LIMIT", o["barriers"])
        self.assertEqual(o["requestGrants"], 4)

    async def test_before_post_error_is_not_reported_as_after_response_and_prevents_transmission(self):
        o = await self.run_fixture(post_case="pre_post_console")
        d = o["responseDiagnostics"][-1]
        self.assertEqual(o["requestGrants"], 3)
        self.assertFalse(d["submissionObserved"])
        self.assertFalse(d["responseCompleted"])
        self.assertFalse(d["parserAttempted"])
        self.assertNotIn("POST_ATTEMPT", [m["name"] for m in d["milestones"]])
        self.assertTrue(any(r["stage"] == "SEARCH_ARMED" and r["requestStage"] == "BEFORE_SEARCH"
                            for r in d["classifications"]))
        self.assertFalse(o["checkpointEmitted"])

    async def test_mutated_post_payload_is_aborted_before_source_transmission(self):
        o = await self.run_fixture(post_case="mutated_post")
        self.assertNotIn(("POST", "/CaseSearch"), o["network"])
        self.assertFalse(o["checkpointEmitted"])
        self.assertTrue(o["responseDiagnostics"])
        diagnostic = o["responseDiagnostics"][-1]
        self.assertFalse(diagnostic["submissionObserved"])
        self.assertEqual(diagnostic["criteriaValidation"], "NOT_VERIFIED")
        self.assertEqual(diagnostic["documentEligibility"], "BLOCKED_INTEGRITY")
        self.assertTrue(any(row["code"] == "CALENDAR_SUBMITTED_VALUES_MISMATCH"
                            for row in o["formDiagnostics"]))

    async def test_bounded_local_image_never_transmits_or_weakens_console_gate(self):
        o = await self.run_fixture(post_case="optional_abort", selected_room=True, bounded=True)
        d = o["responseDiagnostics"][-1]
        self.assertEqual(o["requestGrants"], 4)
        self.assertEqual(d["consoleDiagnostics"]["status"], "CLEAN")
        self.assertEqual(d["transportIntegrity"]["status"], "COMPLETE")
        self.assertEqual(d["documentEligibility"], "BLOCKED_RESULT")
        self.assertEqual(d["parserOutcome"], "NO_EMPTY_PROOF")
        self.assertEqual(len(o["layoutDiagnostics"]), 1)
        self.assertFalse(o["checkpointEmitted"])

    async def test_post_optional_image_is_local_and_causes_no_console_failure(self):
        o = await self.run_fixture(post_case="optional_abort")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertEqual(d["parserOutcome"], "NO_EMPTY_PROOF")
        self.assertEqual(d["stopGate"], "NONE")
        self.assertEqual(d["consoleDiagnostics"]["status"], "CLEAN")
        self.assertFalse(any(r["category"] == "BLOCKED_OPTIONAL_RESOURCE_ERROR" for r in d["classifications"]))
        self.assertFalse(any(r["category"] == "REQUIRED_RESOURCE_FAILURE" for r in d["classifications"]))
        self.assertEqual(o["requestGrants"], 4)
        self.assertFalse(o["checkpointEmitted"])
        lifecycle = d["lifecycle"]
        self.assertEqual(lifecycle["browserRequestStartState"], "BEFORE_POST_ATTEMPT")
        for milestone in (
            "browserRequestStarted", "postAttemptStarted", "responseAcknowledged",
            "browserFulfilled", "readOnlyInspection",
        ):
            self.assertTrue(lifecycle[milestone])
        self.assertFalse(lifecycle["orderOverflow"])
        orders = [
            lifecycle["browserRequestStartOrder"],
            lifecycle["postAttemptOrder"],
            lifecycle["responseAcknowledgedOrder"],
            lifecycle["browserFulfilledOrder"],
            lifecycle["readOnlyInspectionOrder"],
        ]
        self.assertTrue(all(type(order) is int for order in orders))
        self.assertEqual(orders, sorted(orders))

    async def test_console_error_during_protected_pre_post_wait_is_marked_before_attempt(self):
        o = await self.run_fixture(post_case="pre_post_wait_error")
        d = o["responseDiagnostics"][-1]
        row = next(r for r in d["classifications"]
                   if r["signal"] == "CONSOLE_ERROR")
        lifecycle = d["lifecycle"]
        self.assertEqual(row["phase"], "RESULT")
        self.assertEqual(row["eventState"], "BEFORE_POST_ATTEMPT")
        self.assertEqual(row["requestStartState"], "NOT_ASSOCIATED")
        self.assertTrue(lifecycle["browserRequestStarted"])
        self.assertEqual(lifecycle["browserRequestStartState"], "BEFORE_POST_ATTEMPT")
        self.assertFalse(lifecycle["postAttemptStarted"])
        self.assertIsNone(lifecycle["postAttemptOrder"])
        self.assertFalse(lifecycle["responseAcknowledged"])
        self.assertFalse(lifecycle["browserFulfilled"])
        self.assertFalse(lifecycle["readOnlyInspection"])
        self.assertFalse(d["submissionObserved"])
        # The parent's granted-but-untransmitted slot is conservatively
        # consumed and accounted uncertain; it cannot be silently reused.
        self.assertEqual(o["requestGrants"], 4)
        self.assertFalse(any(method == "POST" for method, _path in o["network"]))
        self.assertGreater(row["firstEventOrder"], lifecycle["browserRequestStartOrder"])

    async def test_post_required_script_failure_is_not_optional_or_safe_to_inspect(self):
        o = await self.run_fixture(post_case="required_script")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertTrue(any(r["category"] == "REQUIRED_RESOURCE_FAILURE" and r["alias"] == "MAIN_SCRIPT"
                            for r in d["classifications"]))
        self.assertEqual(d["inspectionStatus"], "OBSERVED")
        self.assertEqual(d["resultValidation"]["outcome"], "EMPTY_NOT_PROVEN")
        self.assertEqual(d["documentEligibility"], "BLOCKED_TRANSPORT")
        self.assertEqual(d["stopGate"], "SOURCE_STOPPED")
        self.assertFalse(o["checkpointEmitted"])

    async def test_post_runtime_exception_still_collects_passive_structure_then_stops(self):
        o = await self.run_fixture(post_case="runtime_exception")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertEqual(d["stopGate"], "CALENDAR_SCRIPT_ERROR")
        self.assertEqual(d["inspectionStatus"], "OBSERVED")
        self.assertTrue(d["structure"]["expectedHeaders"])
        self.assertEqual(d["resultValidation"]["outcome"], "EMPTY_NOT_PROVEN")
        self.assertEqual(d["documentEligibility"], "BLOCKED_CONSOLE")
        self.assertTrue(any(r["category"] == "JAVASCRIPT_EXCEPTION" for r in d["classifications"]))
        self.assertEqual(o["requestGrants"], 4)
        self.assertFalse(o["checkpointEmitted"])

    async def test_post_other_console_still_validates_only_bounded_result_facts(self):
        o = await self.run_fixture(post_case="other_console")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertEqual(d["stopGate"], "CALENDAR_CONSOLE_ERROR")
        self.assertEqual(d["inspectionStatus"], "OBSERVED")
        self.assertEqual(d["criteriaValidation"], "INTERCEPTED_POST_BODY_MATCHED")
        self.assertEqual(d["transportIntegrity"]["status"], "COMPLETE")
        self.assertEqual(d["consoleDiagnostics"]["status"], "UNCLASSIFIED_CONSOLE_ERRORS")
        self.assertEqual(d["resultValidation"]["outcome"], "EMPTY_NOT_PROVEN")
        self.assertEqual(d["resultValidation"]["explicitEmptyResult"], "NOT_CAPTURED")
        self.assertEqual(d["documentEligibility"], "BLOCKED_CONSOLE")
        self.assertTrue(any(r["category"] == "OTHER_CONSOLE_ERROR" and r["phase"] == "RESULT"
                            for r in d["classifications"]))
        self.assertEqual(o["requestGrants"], 4)
        self.assertFalse(o["checkpointEmitted"])
        marks = {m["name"]: m["sequence"] for m in d["milestones"]}
        self.assertLess(marks["POST_ATTEMPT"], marks["RESPONSE_RECEIVED"])
        self.assertLess(marks["RESPONSE_RECEIVED"], marks["RESPONSE_BODY_READ"])
        self.assertLess(marks["RESPONSE_BODY_READ"], marks["POST_ACKNOWLEDGED"])
        self.assertLess(marks["PARSER_STARTED"], marks["PARSER_REJECTED"])
        self.assertTrue(any(r["firstSequence"] > marks["POST_ACKNOWLEDGED"]
                            for r in d["classifications"] if r["category"] == "OTHER_CONSOLE_ERROR"))

    async def test_post_unknown_origin_is_redacted_not_a_result_proof(self):
        o = await self.run_fixture(post_case="unclassified_console")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertEqual(d["stopGate"], "CALENDAR_CONSOLE_ERROR")
        self.assertEqual(d["documentEligibility"], "BLOCKED_CONSOLE")
        self.assertTrue(any(r["category"] == "UNKNOWN_OR_UNSAFE" for r in d["classifications"]))
        self.assertFalse(o["checkpointEmitted"])

    async def test_result_frame_console_error_is_observed_without_unblocking_documents(self):
        o = await self.run_fixture(post_case="frame_console")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertEqual(d["consoleDiagnostics"]["status"], "UNCLASSIFIED_CONSOLE_ERRORS")
        self.assertEqual(d["resultValidation"]["outcome"], "EMPTY_NOT_PROVEN")
        self.assertEqual(d["documentEligibility"], "BLOCKED_CONSOLE")
        self.assertFalse(o["checkpointEmitted"])

    async def test_console_stop_aborts_new_browser_data_requests_without_another_grant(self):
        o = await self.run_fixture(post_case="post_stop_fetch")
        d = o["responseDiagnostics"][-1]
        self.assertEqual(o["requestGrants"], 4)
        self.assertEqual(len(o["network"]), 4)
        self.assertGreaterEqual(d["blockedDuringInspection"], 1)
        self.assertFalse(o["checkpointEmitted"])

    async def test_returned_form_has_structural_diagnostics_without_claiming_zero(self):
        o = await self.run_fixture(post_case="returned_form")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertTrue(d["responseCompleted"])
        self.assertTrue(d["structure"]["searchFormPresent"])
        self.assertEqual(d["structure"]["resultTableCount"], 0)
        self.assertEqual(d["parserOutcome"], "MISSING_TABLE")
        self.assertEqual(d["resultValidation"]["outcome"], "MISSING_TABLE")
        self.assertFalse(o["checkpointEmitted"])
        self.assertNotIn("EMPTY_RESULTS_VALIDATED", o["states"])

    async def test_malformed_result_header_has_safe_parser_and_structure_outcomes(self):
        o = await self.run_fixture(post_case="malformed_headers")
        d = o["responseDiagnostics"][-1]
        self.assertTrue(o["parserReached"])
        self.assertFalse(d["structure"]["expectedHeaders"])
        self.assertEqual(d["parserOutcome"], "UNSUPPORTED_LAYOUT")
        self.assertFalse(o["checkpointEmitted"])

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
        self.assertTrue(observed["parserReached"])
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
