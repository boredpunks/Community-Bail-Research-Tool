"""Loopback-only reproduction: public form and header-only table, never cases."""
import asyncio
import io
import json
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.async_api import Route, TimeoutError as BrowserTimeout

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
import calendar_protocol
import worker
from evidence import CalendarResults
from test_form_inspection import CRITERIA, public_fixture


class CalendarLoadTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def run_fixture(self, *, missing_grid=False, changed_version=False):
        # Scale the real completion-to-start pacing and click deadline together:
        # 80 logical seconds per request, a 180-logical-second navigation limit.
        scale = 0.02
        original_fetch = Route.fetch
        original_pause = calendar_protocol.response_pause
        original_submit = worker.submit_calendar_search
        original_feed = CalendarResults.feed
        messages, network, timeouts, parsed = [], [], [], []
        # The shared inspection fixture deliberately has a verification input
        # inside every unnamed widget. That makes each widget's backing model
        # ambiguous to calendar preflight. Keep one normal form-level token,
        # outside the widgets, rather than weakening the production validator.
        initial = public_fixture().replace(
            '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL">', ''
        ).replace('</form>',
                  '<input type="hidden" name="__RequestVerificationToken" value="REDACTION_SENTINEL"></form>')
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
                                      'href="/resource/css/sitemain.min.css?v=fixture_new"')

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
                    body, content_type = "/* offline public fixture */", "application/javascript"
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

        server = await asyncio.start_server(serve, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        config = {"criteria": CRITERIA, "calendarComplete": False, "pendingItems": [],
                  "remainingRecords": 0}
        protocol = []
        for index in range(8):
            protocol.extend([json.dumps({"allow": True, "requestId": f"offline-{index}"}),
                             json.dumps({"continue": True})])
        try:
            with ExitStack() as stack:
                stack.enter_context(patch.object(Route, "fetch", local_fetch))
                stack.enter_context(patch.object(worker.sys, "stdin", io.StringIO('\n'.join(protocol) + '\n')))
                stack.enter_context(patch.object(worker, "emit", lambda kind, **values:
                                                messages.append({"kind": kind, **values})))
                stack.enter_context(patch.object(worker, "response_pause", scaled_pause))
                stack.enter_context(patch.object(worker.random, "uniform", return_value=80))
                stack.enter_context(patch.object(calendar_protocol, "SEARCH_CLICK_TIMEOUT_MS", int(180_000 * scale)))
                # The normal fixture's result deadline is shorter than the
                # 1.6-second pre-POST pause. It must start after that pause.
                stack.enter_context(patch.object(calendar_protocol, "CALENDAR_RESULT_TIMEOUT_MS",
                                                100 if missing_grid else 4_000 if changed_version else 1_000))
                stack.enter_context(patch.object(worker, "submit_calendar_search", observe_submit))
                stack.enter_context(patch.object(CalendarResults, "feed", observe_feed))
                stack.enter_context(patch.object(worker, "download", side_effect=AssertionError("No PDFs")))
                await worker.main(config)
        finally:
            server.close()
            await server.wait_closed()
        states = [row["state"] for row in messages if row["kind"] == "calendar_state"]
        barriers = [row["code"] for row in messages if row["kind"] == "barrier"]
        observations = {
            "network": network, "timeouts": timeouts, "parserReached": bool(parsed),
            "states": states, "barriers": barriers,
            "formDiagnostics": [row for row in messages if row["kind"] == "calendar_form_diagnostic"],
            "requestGrants": sum(row["kind"] == "request" for row in messages),
            "responseAccounts": sum(row["kind"] == "response" for row in messages),
            "diagnostics": [row for row in messages if row["kind"] == "calendar_diagnostics"],
        }
        print("\nOFFLINE_REPRODUCTION", json.dumps(observations), flush=True)
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
        self.assertIn(("GET", "/resource/css/sitemain.min.css?v=fixture_new"), observed["network"])
        self.assertEqual(len(observed["network"]), 5)
        self.assertEqual(observed["requestGrants"], 5)
        self.assertEqual(observed["responseAccounts"], 5)
        self.assertEqual(observed["diagnostics"][-1]["cachedResponses"], 1)
