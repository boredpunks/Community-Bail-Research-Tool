"""Non-case HTTP/protocol tests. No generated court documents or docket rows."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "ujs"))
from source_protocol import allowed, classify_response


class ResponseTests(unittest.TestCase):
    def test_failures(self):
        for status, outcome in [(429, "RATE_LIMIT"), (403, "ACCESS_DENIED"),
                                (302, "REDIRECT"), (500, "HTTP_ERROR")]:
            self.assertEqual(classify_response(status, {}, b""), outcome)

    def test_success_is_not_always_access(self):
        self.assertEqual(classify_response(200, {"content-type": "text/html"},
                                          b"<html>verify you are human</html>"), "CHALLENGE")
        self.assertEqual(classify_response(200, {}, b"<html>access denied</html>"), "ACCESS_DENIED")
        self.assertEqual(classify_response(200, {}, b"<html>too many requests</html>"), "RATE_LIMIT")

    def test_calendar_content_types_are_explicit_and_fail_closed(self):
        self.assertEqual(classify_response(
            200, {"Content-Type": "text/html; charset=utf-8"}, b"<html></html>",
            path="/CaseSearch"), "OK")
        self.assertEqual(classify_response(
            200, {"content-type": "text/javascript"}, b"/* script */",
            path="/resource/js/sitemain.min.js"), "OK")
        self.assertEqual(classify_response(
            200, {"content-type": "application/javascript"}, b"/* script */",
            path="/resource/js/sitemain.min.js"), "OK")
        self.assertEqual(classify_response(
            200, {"content-type": "text/css; charset=utf-8"}, b"/* styles */",
            path="/resource/css/sitemain.min.css"), "OK")
        for path, headers, body in [
            ("/CaseSearch", {}, b"<html></html>"),
            ("/CaseSearch", {"content-type": "application/json"}, b"{}"),
            ("/resource/js/sitemain.min.js", {"content-type": "text/html"}, b"<html></html>"),
            ("/resource/css/sitemain.min.css", {"content-type": "text/plain"}, b"styles"),
        ]:
            self.assertEqual(
                classify_response(200, headers, body, path=path),
                "UNSUPPORTED_RESPONSE",
            )

    def test_calendar_login_prompts_stop_without_retaining_page_content(self):
        body = b"""<!doctype html><html><title>Sign In</title>
        <form action="/account/login"><input name="password" type="password"></form></html>"""
        self.assertEqual(classify_response(
            200, {"content-type": "text/html"}, body, path="/CaseSearch"),
            "LOGIN_PROMPT")

    def test_pdf_validation(self):
        self.assertEqual(classify_response(200, {}, b"non-document HTTP payload", pdf=True), "INVALID_PDF")
        self.assertEqual(classify_response(200, {}, b"x" * 4_000_001), "SIZE_LIMIT")

    def test_request_scope(self):
        self.assertTrue(allowed("https://ujsportal.pacourts.us/CaseSearch", "GET"))
        self.assertFalse(allowed("https://example.invalid/CaseSearch", "GET"))
        self.assertFalse(allowed("https://ujsportal.pacourts.us/CaseSearch?unexpected=1", "POST"))
        self.assertFalse(allowed("https://ujsportal.pacourts.us/resource/js/sitemain.min.js?v=unapproved", "GET"))
        self.assertFalse(allowed("https://ujsportal.pacourts.us/Report/CpDocketSheet?docketNumber=not-a-docket", "GET"))

    def test_bounded_bundle_versions(self):
        version = "offlineVersionHash_1234567890"
        for path in ("/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css"):
            url = "https://ujsportal.pacourts.us" + path
            self.assertTrue(allowed(url, "GET"))
            self.assertTrue(allowed(url + "?v=" + version, "GET"))
            for query in ("v=", "v=short", "v=" + "a" * 129,
                          "v=" + version + "&", "v=" + version + "&unexpected=1",
                          "v=" + version + "&v=" + version, "v=" + version + "%0A",
                          "other=" + version, "v=../../unapproved"):
                self.assertFalse(allowed(url + "?" + query, "GET"), query)
            self.assertFalse(allowed(url + "?v=" + version, "POST"))
            self.assertFalse(allowed(url + "?v=" + version + "#fragment", "GET"))
        self.assertFalse(allowed("https://ujsportal.pacourts.us/resource/js/other.js?v=" + version, "GET"))
