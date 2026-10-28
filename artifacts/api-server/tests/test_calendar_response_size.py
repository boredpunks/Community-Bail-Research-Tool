"""Synthetic structures only; loopback-only transport, no docket/case fixtures."""
import asyncio
import base64
import gzip
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from playwright.async_api import async_playwright
from calendar_response import CalendarStream, CalendarResponse, html_byte_limit, DEFAULT_HTML_BYTES, CHUNK_BYTES
from calendar_dom import DOM_PROJECTION, complete_result_framing
from calendar_diagnostics import RESPONSE_STRUCTURE
from evidence import CalendarResults
from source_protocol import classify_response


def empty_grid(empty=True):
    labels = ["Column"] * 19
    for i, name in {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                    9: "County", 10: "Court Office", 14: "Event Type"}.items():
        labels[i] = name
    return ('<table id="caseSearchResultGrid"><tr>' +
            "".join("<th>" + value + "</th>" for value in labels) + "</tr>" +
            ('<tr><td colspan="19">No results found</td></tr>' if empty else '') +
            '</table>')


# Repeated small comments/text blocks, not a giant unfinished parser token.
PADDING = ("<p>" + "x" * 4000 + "</p>") * 1100
CRITERIA = {"courtOffice": "ANY", "courtRoom": "ANY", "eventType": "ANY",
            "startDate": "2026-10-19", "endDate": "2026-10-19"}


class CalendarPolicyTests(unittest.TestCase):
    def test_policy_is_explicit_bounded_and_pdf_assets_unchanged(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(html_byte_limit(), 16_000_000)
        for value in ("0", "-1", "NaN", "32000001", "3999999", "1.6e7"):
            with patch.dict(os.environ, {"UJS_CALENDAR_HTML_MAX_BYTES": value}):
                with self.assertRaises(ValueError):
                    html_byte_limit()
        for value in ("4000000", "8000000", "32000000"):
            with patch.dict(os.environ, {"UJS_CALENDAR_HTML_MAX_BYTES": value}):
                self.assertEqual(html_byte_limit(), int(value))
        body = b" " * 4_000_001
        self.assertEqual(classify_response(200, {"content-type": "text/html"}, body,
                                          path="/CaseSearch", calendar_limit=16_000_000), "OK")
        self.assertEqual(classify_response(200, {}, body, pdf=True,
                                          calendar_limit=16_000_000), "SIZE_LIMIT")
        self.assertEqual(classify_response(200, {}, body, path="/resource/js/sitemain.min.js",
                                          calendar_limit=16_000_000), "SIZE_LIMIT")
        self.assertEqual(classify_response(
            200, {"content-type": "application/pdf"}, b"%PDF-test",
            pdf=True, path="/Report/CpDocketSheet"), "OK")
        self.assertEqual(classify_response(
            200, {"content-type": "text/html"}, b"%PDF-test",
            pdf=True, path="/Report/CpDocketSheet"), "UNSUPPORTED_RESPONSE")
        self.assertEqual(classify_response(
            200, {"content-type": "application/pdf"}, b"not-pdf",
            pdf=True, path="/Report/CpDocketSheet"), "INVALID_PDF")

    def test_incremental_framing_rejects_truncated_or_repaired_grid_and_bad_encoding(self):
        self.assertTrue(complete_result_framing((PADDING + empty_grid()).encode(), "text/html"))
        self.assertFalse(complete_result_framing(empty_grid()[:-8].encode(), "text/html"))
        self.assertFalse(complete_result_framing(
            empty_grid().replace("</td>", "</th>").encode(), "text/html"))
        self.assertFalse(complete_result_framing(b"\xff", "text/html; charset=utf-8"))
        self.assertFalse(complete_result_framing(b"abc", "text/html; charset=utf-16"))

    def test_no_full_page_serialization_remains(self):
        root = Path(__file__).resolve().parents[1] / "src/ujs"
        worker = (root / "worker.py").read_text()
        self.assertNotIn("await page.content()", worker)
        self.assertNotIn("document.documentElement?.outerHTML", RESPONSE_STRUCTURE)
        # Only the bounded grid, not documentElement, may be serialized.
        self.assertIn("const html=projected.outerHTML", DOM_PROJECTION)
        self.assertIn("projected=table.cloneNode(true)", DOM_PROJECTION)
        self.assertIn("api.rows().nodes().toArray()", DOM_PROJECTION)

    def test_buffered_cdp_prefix_decodes_in_bounded_chunks_without_a_second_body_copy(self):
        raw = b"x" * 5_000_000
        encoded = base64.b64encode(raw).decode("ascii")
        response = CalendarResponse(8_000_000)
        response.streaming = True
        sizes = []
        original_decode = base64.b64decode

        def bounded_decode(part, *, validate):
            sizes.append(len(part))
            return original_decode(part, validate=validate)

        with patch("calendar_response.base64.b64decode", side_effect=bounded_decode):
            response.add_data(encoded)
        self.assertEqual(response.outcome, "OK")
        self.assertEqual(response.retained, len(raw))
        self.assertEqual(len(response.buffer), len(raw))
        self.assertLessEqual(max(sizes), CHUNK_BYTES)
        self.assertIs(asyncio.run(response.body()), response.buffer)


class BrowserStreamTests(unittest.IsolatedAsyncioTestCase):
    async def run_stream(self, markup, *, limit=DEFAULT_HTML_BYTES, compress=False,
                         status=200, content_type="text/html; charset=utf-8", interrupted=False):
        body = markup.encode() if isinstance(markup, str) else markup
        wire = gzip.compress(body) if compress else body
        records, requests, handlers = [], [], []

        async def serve(reader, writer):
            try:
                head = await reader.readuntil(b"\r\n\r\n")
                requests.append(head.split(b"\r\n", 1)[0].decode())
                declared = len(wire) + (100 if interrupted else 0)
                headers = (f"HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\n"
                           f"Content-Length: {declared}\r\nConnection: close\r\n"
                           + ("Content-Encoding: gzip\r\n" if compress else "")
                           + ("Location: /must-not-follow\r\n" if status == 302 else "") + "\r\n")
                writer.write(headers.encode())
                # Chunked server writes ensure the receiver doesn't rely on a
                # single read or on compressed Content-Length as its size cap.
                for i in range(0, len(wire), 32 * 1024):
                    writer.write(wire[i:i + 32 * 1024])
                    await writer.drain()
            except (ConnectionError, asyncio.IncompleteReadError):
                pass  # Expected when client stops at its bound.
            finally:
                writer.close()
                try:
                    await writer.wait_closed()
                except ConnectionError:
                    pass

        server = await asyncio.start_server(serve, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        url = f"http://127.0.0.1:{port}/CaseSearch"
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=shutil.which("chromium"),
                args=["--no-sandbox", "--no-proxy-server", "--disable-background-networking",
                      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"])
            context = await browser.new_context(service_workers="block", accept_downloads=False)
            page = await context.new_page()
            stream = CalendarStream(await context.new_cdp_session(page), limit, document_url=url)
            await stream.start()

            async def route_handler(route):
                if route.request.url != url:
                    await route.abort()
                    return
                response = await stream.fetch(route)
                try:
                    body_ref = await response.body()
                    self.assertIs(body_ref, response.buffer)
                    self.assertIs(await response.body(), body_ref)
                    record = response.metadata()
                    record["outcome"] = (response.outcome if response.outcome != "OK" else
                        classify_response(response.status, response.headers, body_ref,
                                          path="/CaseSearch", calendar_limit=limit))
                    record["retainedBytes"] = len(body_ref)
                    record["framing"] = (complete_result_framing(
                        body_ref, response.headers.get("content-type", ""))
                        if response.complete else False)
                    records.append(record)
                    if record["outcome"] == "OK":
                        await response.fulfill()
                finally:
                    await response.dispose()
                    self.assertEqual(len(response.buffer), 0)
            async def guarded_route(route):
                task = asyncio.create_task(route_handler(route))
                handlers.append(task)
                await task
            await context.route("**/*", guarded_route)
            navigation_error = False
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            except Exception:
                navigation_error = True
            await asyncio.gather(*handlers)
            if navigation_error:
                self.assertTrue(records, "Stream failed without an accounted response")
                self.assertNotEqual(records[-1]["outcome"], "OK")
            projection = None
            if records and records[-1]["outcome"] == "OK":
                projection = await page.evaluate(DOM_PROJECTION, {"limit": limit})
                structure = await page.evaluate(RESPONSE_STRUCTURE)
                self.assertFalse(structure["countsCapped"])
            await context.close()
            await browser.close()
            await asyncio.gather(*handlers)
        server.close()
        await server.wait_closed()
        self.assertEqual(len(requests), 1, "No redirects, automatic retries, or second fetch")
        self.assertEqual(len(records), 1)
        return records[0], projection, len(body), len(wire)

    async def test_large_supported_empty_state_early_and_late_gzip_decoded_bytes(self):
        for early in (True, False):
            with self.subTest(early=early):
                grid = empty_grid()
                markup = "<html><body>" + (grid + PADDING if early else PADDING + grid) + "</body></html>"
                record, projection, decoded, wire = await self.run_stream(markup, compress=True)
                self.assertGreater(decoded, 4_000_000)
                self.assertLess(wire, 4_000_000)
                self.assertEqual(record["observedBytes"], decoded)
                self.assertTrue(record["complete"])
                self.assertTrue(record["framing"])
                self.assertEqual(record["outcome"], "OK")
                self.assertLess(len(projection["html"]), 2000)
                parser = CalendarResults()
                parser.feed(projection["html"])
                self.assertEqual(parser.validated(CRITERIA), [])
                self.assertTrue(parser.explicit_empty_state)

    async def test_new_limit_exceeded_is_unvalidated_not_truncated_success(self):
        record, projection, _, _ = await self.run_stream(
            "<html><body>" + empty_grid() + PADDING * 4 + "</body></html>")
        self.assertEqual(record["outcome"], "SIZE_LIMIT")
        self.assertFalse(record["complete"])
        self.assertIsNone(projection)
        self.assertEqual(record["retainedBytes"], 0)
        self.assertGreater(record["observedBytes"], DEFAULT_HTML_BYTES)
        self.assertLessEqual(record["observedBytes"], DEFAULT_HTML_BYTES + CHUNK_BYTES)

    async def test_interrupted_body_never_fulfills_or_parses_partial_grid(self):
        record, projection, _, _ = await self.run_stream(empty_grid(), interrupted=True)
        self.assertEqual(record["outcome"], "NETWORK_ERROR")
        self.assertFalse(record["complete"])
        self.assertIsNone(projection)

    async def test_large_header_only_is_not_empty_proof(self):
        record, projection, _, _ = await self.run_stream(PADDING + empty_grid(empty=False))
        self.assertEqual(record["outcome"], "OK")
        parser = CalendarResults()
        parser.feed(projection["html"])
        self.assertEqual(parser.validated(CRITERIA), [])
        self.assertFalse(parser.explicit_empty_state)

    async def test_late_pagination_warning_and_opaque_noncase_action_are_preserved(self):
        # Deliberately NOT a docket identifier. Assert preservation only, never
        # claim a valid case/action or insert it into the application's database.
        action = "/Report/CpDocketSheet?docketNumber=NOT_A_CASE&amp;dnh=OFFLINE_SENTINEL"
        grid = empty_grid(empty=False).replace("</table>",
            '<tr><td><a href="' + action + '">Source action</a></td></tr></table>')
        record, projection, _, _ = await self.run_stream(
            "<html><body>" + grid + PADDING +
            '<p>Not all results are shown for Common Pleas. Please narrow your search.</p>'
            '<a href="?pageIndex=2">Next</a></body></html>')
        self.assertEqual(record["outcome"], "OK")
        self.assertIn(action, projection["html"])
        self.assertTrue(projection["pagination"])
        self.assertTrue(projection["resultLimit"])
        self.assertNotIn("OFFLINE_SENTINEL", json.dumps(record))

    async def test_denials_challenges_and_redirects_never_become_results(self):
        for status, markup, outcome in (
            (401, "denied", "ACCESS_DENIED"),
            (403, "denied", "ACCESS_DENIED"),
            (429, "wait", "RATE_LIMIT"),
            (302, "redirect", "REDIRECT"),
            (200, PADDING + "verify you are human", "CHALLENGE"),
            (200, PADDING + '<input type="password">', "LOGIN_PROMPT"),
            (200, PADDING + "access denied", "ACCESS_DENIED"),
        ):
            with self.subTest(status=status, outcome=outcome):
                record, projection, _, _ = await self.run_stream(markup, status=status)
                self.assertEqual(record["outcome"], outcome)
                self.assertIsNone(projection)


if __name__ == "__main__":
    unittest.main()
