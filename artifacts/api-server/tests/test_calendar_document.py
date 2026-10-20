"""Offline Chromium session/download tests using a genuine supplied PDF.

All HTTP is loopback. No real court source requests, synthetic cases, or secrets.
"""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/ujs"))
from playwright.async_api import async_playwright
from calendar_document import CalendarDocument
from evidence import extract_bail

ROOT = Path(__file__).resolve().parents[3]
DOCKET = "CP-02-CR-0005845-2026"
DOCUMENT_PATH = "/Report/CpDocketSheet?docketNumber=" + DOCKET


class CalendarDocumentTests(unittest.IsolatedAsyncioTestCase):
    async def run_flow(self, mode="pdf"):
        pdf = (ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf").read_bytes()
        observations = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                path = urlsplit(self.path).path
                if path == "/CaseSearch":
                    self.send_response(200)
                    self.send_header("Set-Cookie", "offline_probe=public-marker; Path=/; SameSite=Lax")
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(('<a href="' + DOCUMENT_PATH + '">Document</a>').encode())
                    return
                observations.append({
                    "path": path,
                    "session": "offline_probe=public-marker" in self.headers.get("Cookie", ""),
                    "calendarReferer": urlsplit(self.headers.get("Referer", "")).path == "/CaseSearch",
                    "navigation": self.headers.get("Sec-Fetch-Dest") == "document",
                })
                if mode == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "/must-not-follow")
                    body = b""
                elif mode == "denied" or not all(observations[-1][k] for k in
                                                ("session", "calendarReferer", "navigation")):
                    self.send_response(401)
                    body = b""
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Disposition", "inline")
                    body = pdf
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path=shutil.which("chromium"),
                    args=["--no-sandbox", "--disable-background-networking"])
                context = await browser.new_context(service_workers="block", accept_downloads=False)
                page = await context.new_page()
                document = CalendarDocument(context, page)

                async def route_handler(route):
                    if await document.handle_route(route):
                        return
                    if route.request.url == base + "/CaseSearch":
                        await route.continue_()
                    else:
                        await route.abort()

                await context.route("**/*", route_handler)
                await page.goto(base + "/CaseSearch")
                captured = await page.locator("a").get_attribute("href")
                with patch("calendar_document.allowed",
                           lambda url, method: url == base + captured and method == "GET"):
                    response = await document.open(base + captured)
                body = await response.body()
                result = (response.status, response.outcome, body)
                await response.dispose()
                await browser.close()
                return result, observations
        finally:
            await asyncio.to_thread(server.shutdown)
            server.server_close()

    async def test_captured_link_new_tab_keeps_session_and_calendar_referrer(self):
        (status, outcome, body), observed = await self.run_flow()
        self.assertEqual((status, outcome), (200, "OK"))
        self.assertEqual(len(observed), 1)
        self.assertTrue(all(observed[0][k] for k in ("session", "calendarReferer", "navigation")))
        result = extract_bail(body, DOCKET)
        self.assertEqual(result["extractionOutcome"], "EXTRACTED")
        self.assertEqual(result["entries"][0]["amountCents"], 10000)

    async def test_real_401_is_not_treated_as_a_viewer_error(self):
        (status, outcome, body), observed = await self.run_flow("denied")
        self.assertEqual((status, outcome, body), (401, "ACCESS_DENIED", b""))
        self.assertEqual(len(observed), 1)

    async def test_redirect_is_not_followed_or_retried(self):
        (status, outcome, body), observed = await self.run_flow("redirect")
        self.assertEqual((status, outcome, body), (302, "REDIRECT", b""))
        self.assertEqual(len(observed), 1)
