"""Open a captured calendar action in the calendar's browser session.

The caller must already hold a persisted request grant. No URL reconstruction,
cookie export, alternate HTTP client, retries, redirects, or viewer execution.
"""
import asyncio
from pathlib import Path
import re
import tempfile
import uuid
from urllib.parse import urlsplit
from source_protocol import allowed, classify_response

PDF_LIMIT = 4_000_000


class DocumentResponse:
    def __init__(self):
        self.status = 0
        self.headers = {}
        self.outcome = "OK"
        self.content = b""

    async def body(self):
        return self.content

    async def dispose(self):
        self.content = b""


class CalendarDocument:
    def __init__(self, context, calendar_page):
        self.context, self.calendar_page = context, calendar_page
        self.popup = None
        self.url = None
        self.transmitted = False

    async def handle_route(self, route):
        """Consume popup requests before the ordinary calendar route handler."""
        try:
            belongs = self.popup is not None and route.request.frame.page == self.popup
        except Exception:
            belongs = False
        if not belongs:
            return False
        request = route.request
        if (self.transmitted or request.url != self.url or request.method != "GET"
                or request.resource_type != "document" or not request.is_navigation_request()
                or request.redirected_from is not None):
            await route.abort()
        else:
            self.transmitted = True
            await route.continue_()
        return True

    async def open(self, url):
        # The actual source action, including its opaque parameters, stays in
        # memory. Never create a document URL from the docket number.
        origin = urlsplit(self.calendar_page.url)
        target_url = urlsplit(url)
        if (not allowed(url, "GET") or target_url.path not in (
                "/Report/CpDocketSheet", "/Report/MdjDocketSheet")
                or (origin.scheme, origin.netloc) != (target_url.scheme, target_url.netloc)
                or self.popup is not None):
            raise ValueError("CALENDAR_DOCUMENT_CONTEXT_REQUIRED")
        response = DocumentResponse()
        finished = asyncio.get_running_loop().create_future()
        browser_cdp = page_cdp = None
        guid = None
        self.url, self.transmitted = url, False
        target = "calendar-document-" + uuid.uuid4().hex

        def resolve():
            if not finished.done():
                finished.set_result(None)

        async def headers(event):
            request = event.get("request", {})
            if ((request.get("url"), request.get("method")) != (url, "GET")
                    or "responseStatusCode" not in event):
                response.outcome = "NETWORK_ERROR"
            else:
                response.status = event["responseStatusCode"]
                response.headers = {h["name"].lower(): h["value"]
                                    for h in event.get("responseHeaders", [])}
                length = response.headers.get("content-length", "")
                if response.status != 200:
                    response.outcome = classify_response(response.status, response.headers, b"", pdf=True)
                elif length.isdecimal() and int(length) > PDF_LIMIT:
                    response.outcome = "SIZE_LIMIT"
                else:
                    # Change only local display disposition: Chromium receives
                    # the original response body as a download, not a PDF viewer.
                    # Browser download completion validates transport completion.
                    local_headers = [h for h in event.get("responseHeaders", [])
                                     if h["name"].lower() != "content-disposition"]
                    local_headers.append({"name": "Content-Disposition", "value": "attachment"})
                    await page_cdp.send("Fetch.continueResponse", {
                        "requestId": event["requestId"], "responseCode": response.status,
                        "responseHeaders": local_headers})
                    return
            try:
                await page_cdp.send("Fetch.failRequest", {
                    "requestId": event["requestId"], "errorReason": "Aborted"})
            finally:
                resolve()

        async def started(event):
            nonlocal guid
            if event.get("url") == url and guid is None:
                guid = event["guid"]
            else:
                await browser_cdp.send("Browser.cancelDownload", {"guid": event["guid"],
                                       "browserContextId": browser_context_id})
                response.outcome = "NETWORK_ERROR"
                resolve()

        async def progress(event):
            if event.get("guid") != guid:
                return
            if event.get("receivedBytes", 0) > PDF_LIMIT:
                response.outcome = "SIZE_LIMIT"
                await browser_cdp.send("Browser.cancelDownload", {
                    "guid": guid, "browserContextId": browser_context_id})
                resolve()
            elif event.get("state") == "completed":
                resolve()
            elif event.get("state") == "canceled":
                if response.outcome == "OK":
                    response.outcome = "NETWORK_ERROR"
                resolve()

        try:
            with tempfile.TemporaryDirectory(prefix="calendar-pdf-") as directory:
                # Open a blank child first so all interception is installed
                # before its single, parent-granted court navigation.
                async with self.calendar_page.expect_popup() as popup_event:
                    await self.calendar_page.evaluate(
                        "(target) => {window.open('about:blank', target);}", target)
                self.popup = await popup_event.value
                page_cdp = await self.context.new_cdp_session(self.popup)
                browser_cdp = await self.context.browser.new_browser_cdp_session()
                info = await page_cdp.send("Target.getTargetInfo")
                browser_context_id = info["targetInfo"]["browserContextId"]
                browser_cdp.on("Browser.downloadWillBegin", started)
                browser_cdp.on("Browser.downloadProgress", progress)
                await browser_cdp.send("Browser.setDownloadBehavior", {
                    "behavior": "allowAndName", "browserContextId": browser_context_id,
                    "downloadPath": directory, "eventsEnabled": True})
                page_cdp.on("Fetch.requestPaused", headers)
                await page_cdp.send("Fetch.enable", {"patterns": [{
                    "urlPattern": "*", "resourceType": "Document", "requestStage": "Response"}]})
                await self.calendar_page.evaluate(
                    "({url,target}) => {window.open(url,target);}", {"url": url, "target": target})
                async with asyncio.timeout(45):
                    await finished
                if response.outcome == "OK":
                    if not guid or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", guid):
                        response.outcome = "NETWORK_ERROR"
                    else:
                        with (Path(directory) / guid).open("rb") as file:
                            response.content = file.read(PDF_LIMIT + 1)
                        response.outcome = classify_response(
                            response.status, response.headers, response.content, pdf=True)
        except TimeoutError:
            response.outcome = "TIMEOUT"
        except Exception:
            # Browser exceptions can contain URLs or Cookie headers. Never emit.
            response.outcome = "NETWORK_ERROR"
        finally:
            if self.popup is not None:
                try:
                    await self.popup.close()
                except Exception:
                    pass
            for session in (page_cdp, browser_cdp):
                if session is not None:
                    try:
                        await session.detach()
                    except Exception:
                        pass
            self.popup = self.url = None
        return response
