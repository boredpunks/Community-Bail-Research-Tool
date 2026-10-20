"""Real downloader, loopback-only connector, genuine supplied PDFs. No source IO."""
import asyncio
import io
import json
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib import request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "artifacts/api-server/src/ujs"))
import public_http
from source_protocol import allowed, classify_response
from evidence import extract_bail
from document_diagnostics import denial_evidence, link_elapsed_seconds

CP = "CP-02-CR-0005845-2026"
MDJ = "MJ-05317-CR-0000264-2026"
NO_BAIL = "MJ-05310-NT-0000228-2026"
ORIGIN = "https://ujsportal.pacourts.us"


class PublicHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.received = []
        cls.status, cls.response_headers, cls.response_body = 200, {}, b""

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                cls.received.append((self.path, dict(self.headers)))
                self.send_response(cls.status)
                for name, value in cls.response_headers.items():
                    self.send_header(name, value)
                self.end_headers()
                try:
                    self.wfile.write(cls.response_body)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Size-limit client intentionally stops at 4,000,001.

            def log_message(self, *_):
                pass  # Never print action values, headers, or fixture content.

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        type(self).received.clear()
        self.respond(200, b"%PDF-invalid-fixture", {"Content-Type": "application/pdf"})

    def respond(self, status, body, headers=None):
        type(self).status = status
        type(self).response_body = body
        type(self).response_headers = headers or {}

    def url(self, docket=CP):
        return ORIGIN + ("/Report/CpDocketSheet" if docket.startswith("CP") else
                         "/Report/MdjDocketSheet") + "?docketNumber=" + docket

    def get(self, url=None):
        port = self.server.server_port

        class LoopbackOnly(request.HTTPSHandler):
            def https_open(self, req):
                # Leave the real allowlist and original raw selector intact.
                # Only the TCP connector is substituted, to an explicit loopback
                # address. Even an erroneous original host cannot be contacted.
                return self.do_open(
                    lambda _host, timeout=45, **_kw: HTTPConnection("127.0.0.1", port, timeout=timeout), req)

        original = request.build_opener
        with patch.object(public_http.request, "build_opener",
                          side_effect=lambda *handlers: original(*handlers, LoopbackOnly())):
            return public_http._download(url or self.url())

    def outcome(self, response):
        return classify_response(response.status, response.headers, response._body, pdf=True)

    def genuine(self, file, docket):
        self.respond(200, (ROOT / "attached_assets" / file).read_bytes(), {"Content-Type": "application/pdf"})
        response = self.get(self.url(docket))
        self.assertEqual(self.outcome(response), "OK")
        self.assertEqual(len(self.received), 1)
        self.assertTrue(response._body.startswith(b"%PDF-"))
        result = extract_bail(response._body, docket)
        self.assertRegex(result["documentSha256"], r"^[a-f0-9]{64}$")
        self.assertGreater(result["documentPageCount"], 0)
        asyncio.run(response.dispose())
        self.assertIsNone(response._body)
        return result

    def test_01_genuine_cp_100_percentage_10_page_1(self):
        result = self.genuine("CpDocketSheet_1792451669525.pdf", CP)
        entry = result["entries"][0]
        self.assertEqual((entry["amountCents"], entry["percentageCondition"], entry["sourcePages"]),
                         (10000, "10.00%", [1]))
        self.assertEqual(entry["financialBasis"], "RECORDED_BAIL_AMOUNT")
        self.assertTrue(entry["excerpt"])

    def test_02_genuine_mdj_1000_posted_page_2(self):
        result = self.genuine("MdjDocketSheet_1792451676271.pdf", MDJ)
        self.assertEqual(result["postedEntryState"], "SHOWN_POSTED")
        self.assertEqual((result["entries"][0]["amountCents"], result["entries"][0]["sourcePages"]), (100000, [2]))

    def test_03_genuine_mdj_without_monetary_bail(self):
        result = self.genuine("MdjDocketSheet_(1)_1792451673387.pdf", NO_BAIL)
        self.assertEqual(result["entries"], [])
        self.assertEqual(result["extractionOutcome"], "MISSING_BAIL_SECTION")

    def test_04_identity_mismatch_yields_no_amount(self):
        self.respond(200, (ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf").read_bytes(),
                     {"Content-Type": "application/pdf"})
        result = extract_bail(self.get(self.url(MDJ))._body, MDJ)
        self.assertEqual(result["extractionOutcome"], "IDENTITY_MISMATCH")
        self.assertEqual(result["entries"], [])
        self.assertEqual(len(self.received), 1)

    def test_05_401_safe_evidence_no_cookies_or_url(self):
        self.respond(401, b"Unauthorized request", {"Content-Type": "text/plain; charset=utf-8",
                     "Set-Cookie": "private=not-retained", "Content-Length": "20"})
        response = self.get()
        self.assertEqual(self.outcome(response), "ACCESS_DENIED")
        evidence = denial_evidence(response.status, response.headers, response._body)
        self.assertEqual(evidence["excerpt"], "Unauthorized request")
        self.assertEqual(evidence["mediaType"], "text/plain")
        self.assertEqual((evidence["contentLength"], evidence["byteCount"]), (20, 20))
        self.assertNotIn("set-cookie", evidence["headers"])
        self.assertNotIn("url", evidence)
        self.assertNotIn("requestHeaders", evidence)
        self.assertEqual(len(self.received), 1)

    def test_06_429_retry_after_120_one_request(self):
        self.respond(429, b"Too many requests", {"Content-Type": "text/plain", "Retry-After": "120"})
        response = self.get()
        self.assertEqual(self.outcome(response), "RATE_LIMIT")
        self.assertEqual(denial_evidence(429, response.headers, response._body)["headers"]["retry-after"], "120")
        self.assertEqual(len(self.received), 1)

    def test_07_302_no_redirect_followup(self):
        self.respond(302, b"", {"Location": ORIGIN + "/CaseSearch"})
        self.assertEqual(self.outcome(self.get()), "REDIRECT")
        self.assertEqual(len(self.received), 1)

    def test_08_html_human_verification_is_challenge(self):
        self.respond(200, b"<html>verify you are human</html>", {"Content-Type": "text/html"})
        self.assertEqual(self.outcome(self.get()), "CHALLENGE")
        self.assertEqual(len(self.received), 1)

    def test_09_over_4mb_is_size_limit(self):
        self.respond(200, b"%PDF-" + b"x" * (4_000_002 - 5), {"Content-Type": "application/pdf"})
        response = self.get()
        self.assertEqual(len(response._body), 4_000_001)
        self.assertEqual(self.outcome(response), "SIZE_LIMIT")
        self.assertEqual(len(self.received), 1)

    def test_10_html_without_signature_invalid_pdf(self):
        self.respond(200, b"<html>not a PDF</html>", {"Content-Type": "text/html"})
        self.assertEqual(self.outcome(self.get()), "INVALID_PDF")
        self.assertEqual(len(self.received), 1)

    def rejected(self, url):
        with self.assertRaisesRegex(ValueError, "^REQUEST_NOT_PERMITTED$"):
            self.get(url)
        self.assertEqual(len(self.received), 0)

    def test_11a_disallowed_path_zero_requests(self):
        self.rejected(self.url().replace("/Report/CpDocketSheet", "/Report/Other"))

    def test_11b_disallowed_host_zero_requests(self):
        self.rejected(self.url().replace("ujsportal.pacourts.us", "example.invalid"))

    def test_11c_extra_query_key_zero_requests(self):
        self.rejected(self.url() + "&extra=forbidden")

    def test_11d_docket_pattern_mismatch_zero_requests(self):
        self.rejected(self.url(MDJ).replace("MdjDocketSheet", "CpDocketSheet"))

    def test_12_exact_ua_no_cookie_referer_authorization(self):
        self.get()
        headers = {k.lower(): v for k, v in self.received[0][1].items()}
        self.assertEqual(headers["user-agent"], "CommunityBailResearch-SourceAssessment/1.0")
        for name in ("cookie", "referer", "authorization"):
            self.assertNotIn(name, headers)

    def test_13_all_http_failures_exactly_one_request_no_retry(self):
        for status in (401, 403, 429, 302, 404, 500):
            with self.subTest(status=status):
                type(self).received.clear()
                self.respond(status, b"")
                response = self.get()
                self.assertNotEqual(self.outcome(response), "OK")
                self.assertEqual(len(self.received), 1)

    def test_14_opaque_action_raw_target_byte_identical(self):
        action = self.url() + "&dnh=offline%2Bencoded%2Fopaque%3D=="
        self.assertTrue(allowed(action, "GET"))
        self.get(action)
        # assertTrue intentionally avoids printing opaque action on failure.
        self.assertTrue(self.received[0][0].encode("ascii") ==
                        (urlsplit(action).path + "?" + urlsplit(action).query).encode("ascii"),
                        "Opaque action target changed in transit")
        self.assertEqual(len(self.received), 1)


class DenialDiagnosticTests(unittest.TestCase):
    def test_tags_whitespace_and_unknown_personal_prose_removed(self):
        e = denial_evidence(403, {"content-type": "text/html"},
                            b"<p>Access  denied</p> PRIVATE PERSON")
        self.assertEqual(e["excerpt"], "Access denied")
        self.assertNotIn("PRIVATE", str(e))

    def test_credentials_queries_cookies_email_tokens_and_personal_content(self):
        for body in (b"Unauthorized request ?secret=value", b"Access denied cookie: secret",
                     b"Access denied a@b.invalid", b"Access denied https://example.invalid/path",
                     b"Access denied dnh opaque", b"Access denied token opaque",
                     b"PRIVATE PERSON and arbitrary prose"):
            with self.subTest():
                self.assertEqual(denial_evidence(401, {"content-type": "text/plain"}, body)["excerpt"],
                                 "[redacted]")

    def test_truncation_headers_allowlist_and_unknown_values(self):
        e = denial_evidence(401, {"content-type": "text/plain", "server": "PRIVATE PERSON",
                            "via": "1.1 nginx", "retry-after": "120",
                            "www-authenticate": 'Bearer realm="private"',
                            "date": "Wed, 21 Oct 2026 12:00:00 GMT", "set-cookie": "never"},
                            b"Unauthorized request " * 100)
        self.assertLessEqual(len(e["excerpt"]), 200)
        self.assertEqual(e["headers"], {"server": "[redacted]", "via": "1.1 nginx",
                         "retry-after": "120", "www-authenticate": "Bearer",
                         "date": "Wed, 21 Oct 2026 12:00:00 GMT"})
        self.assertTrue(all(len(value) <= 200 for value in e["headers"].values()))

    def test_pdf_body_never_retained_and_non_refusal_has_no_evidence(self):
        e = denial_evidence(401, {"content-type": "application/pdf"}, b"%PDF-private text")
        self.assertNotIn("excerpt", e)
        self.assertIsNone(denial_evidence(200, {}, b"anything"))

    def test_elapsed_is_capture_to_get_not_post_start_and_unknown_resume(self):
        self.assertEqual(link_elapsed_seconds(100.0, 105.25), 5.25)
        self.assertIsNone(link_elapsed_seconds(None, 105.25))
        for end in (99, float("nan"), float("inf")):
            with self.assertRaisesRegex(ValueError, "INVALID_LINK_CAPTURE_TIMING"):
                link_elapsed_seconds(100, end)


class NormalWorkerDocumentTests(unittest.IsolatedAsyncioTestCase):
    async def run_document(self, *, allow=True, status=200):
        import worker
        import calendar_document
        messages = []
        source_url = ORIGIN + "/Report/CpDocketSheet?docketNumber=" + CP + "&dnh=offline"
        response = public_http.Response(status, {"content-type": "application/pdf" if status == 200 else "text/plain"},
            (ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf").read_bytes()
            if status == 200 else b"Unauthorized request")
        stdin = io.StringIO("\n".join(json.dumps(v) for v in (
            {"allow": allow, "requestId": "00000000-0000-0000-0000-000000000000"},
            {"continue": status == 200}, {"continue": False},
        )) + "\n")

        async def fetch(exact_url):
            self.assertTrue(exact_url == source_url, "Captured action changed")
            self.assertGreater(stdin.tell(), 0, "Transmission before parent grant")
            self.assertEqual(messages[-1]["kind"], "request")
            return response

        config = {"criteria": {"courtOffice": "CP-05-02-Crim", "courtRoom": "ANY",
                  "eventType": "Bail Hearing", "startDate": "2026-10-20", "endDate": "2026-10-20",
                  "recordCap": 1, "requestCap": 8},
                  "calendarComplete": True, "pendingItems": [{"docketNumber": CP, "sourceUrl": source_url}],
                  "remainingRecords": 1}
        with patch.object(worker.sys, "stdin", stdin), \
                patch.object(worker, "emit", lambda kind, **values: messages.append({"kind": kind, **values})), \
                patch.object(worker.public_http, "download", side_effect=fetch) as download, \
                patch.object(calendar_document.CalendarDocument, "__init__",
                             side_effect=AssertionError("v15 object instantiated")):
            await worker.main(config)
            self.assertEqual(download.await_count, 1 if allow else 0)
        return messages, response

    async def test_parent_grant_precedes_exact_public_download_extraction_and_disposal(self):
        messages, response = await self.run_document()
        result = next(v for v in messages if v["kind"] == "docket")
        self.assertEqual(result["entries"][0]["amountCents"], 10000)
        self.assertEqual(result["extractionOutcome"], "EXTRACTED")
        self.assertIsNone(response._body)
        self.assertIsNone(next(v for v in messages if v["kind"] == "response")["linkCaptureToGetSeconds"])

    async def test_refusal_has_safe_response_unknown_capture_no_next_request(self):
        messages, response = await self.run_document(status=401)
        account = next(v for v in messages if v["kind"] == "response")
        self.assertEqual(account["outcome"], "ACCESS_DENIED")
        self.assertEqual(account["denialEvidence"]["excerpt"], "Unauthorized request")
        self.assertIsNone(account["linkCaptureToGetSeconds"])
        self.assertEqual(sum(v["kind"] == "request" for v in messages), 1)
        self.assertEqual(next(v for v in messages if v["kind"] == "docket")["entries"], [])
        self.assertIsNone(response._body)

    async def test_refused_grant_never_calls_downloader(self):
        messages, _ = await self.run_document(allow=False)
        self.assertFalse(any(v["kind"] == "response" for v in messages))
