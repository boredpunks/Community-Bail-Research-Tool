"""Bounded original-browser HTML receipt; no second fetch or HTML fulfillment.

Network.streamResourceContent exposes decoded entity bytes. Only the result
table is later projected from the browser DOM. Original Network loadingFinished
is mandatory: EOF on a Fetch.takeResponseBodyAsStream replacement can hide an
upstream Content-Length mismatch, so that API is deliberately not used.
"""
import asyncio
import base64
from collections import deque
import os
import re
import time
from urllib.parse import urlsplit
from source_protocol import classify_response
from calendar_diagnostics import failure_class

DEFAULT_HTML_BYTES = 16_000_000
MAX_HTML_BYTES = 32_000_000
CHUNK_BYTES = 64 * 1024
CALENDAR_STREAM_TIMEOUT_SECONDS = 180


def html_byte_limit():
    value = os.environ.get("UJS_CALENDAR_HTML_MAX_BYTES", str(DEFAULT_HTML_BYTES))
    if not value.isascii() or not value.isdecimal() or not 4_000_000 <= int(value) <= MAX_HTML_BYTES:
        raise ValueError("CALENDAR_HTML_POLICY_INVALID")
    return int(value)


def safe_response_headers(headers):
    content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    media_type = {
        "text/html": "HTML",
        "application/json": "JSON",
        "application/pdf": "PDF",
        "text/plain": "TEXT",
        "application/octet-stream": "BINARY",
        "": "MISSING",
    }.get(content_type, "OTHER")
    encoding = headers.get("content-encoding", "identity").strip().lower()
    if encoding not in ("identity", "gzip", "br", "deflate"):
        encoding = "OTHER"
    length = headers.get("content-length", "")
    content_length = (int(length) if length.isascii() and length.isdecimal()
                      and len(length) <= 10 and int(length) <= 2_147_483_647 else None)
    date = headers.get("date", "")
    if not re.fullmatch(
            r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT",
            date):
        date = None
    product = r"(?:nginx|cloudflare|envoy|Apache|Microsoft-IIS|Varnish|ATS|awselb)(?:/\d+(?:\.\d+){0,3})?"
    server = headers.get("server", "")
    if not re.fullmatch(product, server, re.IGNORECASE):
        server = None
    via = headers.get("via", "")
    if not re.fullmatch(r"\d(?:\.\d)? " + product, via, re.IGNORECASE):
        via = None
    retry_after = headers.get("retry-after", "")
    if not (re.fullmatch(r"\d{1,10}", retry_after) or re.fullmatch(
            r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT",
            retry_after)):
        retry_after = None
    return {
        "mediaType": media_type,
        "contentLength": content_length,
        "contentEncoding": encoding,
        "date": date,
        "server": server,
        "via": via,
        "retryAfter": retry_after,
    }


class CalendarResponse:
    def __init__(self, limit):
        self.limit = limit
        self.status = 0
        self.headers = {}
        self.buffer = bytearray()
        self.tail = deque()
        self.received = 0
        self.retained = 0
        self.complete = False
        self.outcome = "OK"
        self.network_id = None
        self.setup = None
        self.streaming = False
        self.browser_request = None
        self.grant_started_at = None
        self.request_started_at = None
        self.headers_received_at = None
        self.network_ended_at = None
        self.network_completion = "NOT_OBSERVED"
        self.network_failure_class = "UNKNOWN"
        self.browser_failure_class = "NOT_OBSERVED"
        self.timer = "NONE"
        self.network_terminal = asyncio.Event()

    def metadata(self):
        media = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        encoding = self.headers.get("content-encoding", "identity").strip().lower()
        return dict(version=1, measurement="CHROMIUM_DECODED_ENTITY_BYTES",
                    limitBytes=self.limit, observedBytes=self.received,
                    complete=self.complete, statusCode=self.status or None,
                    mediaType=media if media in ("text/html", "") else "OTHER",
                    contentEncoding=encoding if encoding in
                    ("identity", "gzip", "br", "deflate") else "OTHER")

    def transport_trace(self, *, outcome, timer=None, now=None):
        now = time.monotonic() if now is None else now
        terminal_at = self.network_ended_at or now

        def elapsed(start, end):
            if start is None or end is None:
                return None
            return min(2_147_483_647, max(0, round((end - start) * 1000)))

        return {
            "version": 1,
            "outcome": outcome,
            "timer": timer or self.timer,
            "statusCode": self.status or None,
            "responseHeaders": safe_response_headers(self.headers),
            "networkCompletion": self.network_completion,
            "networkFailureClass": self.network_failure_class,
            "browserFailureClass": self.browser_failure_class,
            "stages": {
                "grantToRequestMs": elapsed(self.grant_started_at, self.request_started_at),
                "requestToHeadersMs": elapsed(self.request_started_at, self.headers_received_at),
                "headersToNetworkEndMs": elapsed(self.headers_received_at, self.network_ended_at),
                "grantToTerminalMs": elapsed(self.grant_started_at, terminal_at),
            },
        }

    def add_data(self, data):
        if self.outcome != "OK":
            return
        if not isinstance(data, str):
            raise ValueError("CALENDAR_RESPONSE_CHUNK_INVALID")
        # Bound base64 before decoding. The initial buffered prefix and the
        # concurrent streamed tail share this single aggregate byte allowance.
        if len(data) > ((self.limit - self.retained + 2) // 3) * 4:
            self.outcome = "SIZE_LIMIT"
            return
        # CDP may return the already-buffered response prefix as one large
        # base64 string. Decode that prefix in bounded pieces instead of
        # creating a second full-response bytes object before extending buffer.
        for offset in range(0, len(data), CHUNK_BYTES):
            chunk = base64.b64decode(data[offset:offset + CHUNK_BYTES], validate=True)
            self.retained += len(chunk)
            if self.retained > self.limit:
                self.outcome = "SIZE_LIMIT"
                return
            if self.streaming:
                self.buffer.extend(chunk)
            else:
                self.tail.append(chunk)

    async def body(self):
        return self.buffer  # No additional bytes(buffer) full-page copy.

    async def fulfill(self):
        # The original browser response is already loaded. Never transfer the
        # entire body back into Chromium or overwrite upstream failure evidence.
        if self.outcome != "OK" or not self.complete:
            raise ValueError("CALENDAR_RESPONSE_NOT_COMPLETE")

    async def dispose(self):
        self.buffer.clear()
        self.tail.clear()


class CalendarStream:
    """One parent-granted browser document; other requests remain intercepted."""
    def __init__(self, cdp, limit, document_url="https://ujsportal.pacourts.us/CaseSearch"):
        self.cdp, self.limit, self.document_url = cdp, limit, document_url
        self.response = self.pending = self.expected = None
        self.last_request = None
        self.last_trace = None
        self.last_browser_request = None
        self.grant_started_at = None
        self.last_trace_network_id = None
        self.last_trace_headers_at = None

    async def start(self):
        self.cdp.on("Fetch.requestPaused", self._headers)
        self.cdp.on("Network.requestWillBeSent", self._request)
        self.cdp.on("Network.responseReceived", self._response)
        self.cdp.on("Network.dataReceived", self._data)
        self.cdp.on("Network.loadingFinished", self._finished)
        self.cdp.on("Network.loadingFailed", self._failed)
        # Chromium retains at most the policy size before streaming is armed.
        # A buffer eviction/missing prefix fails the exact byte-count check.
        await self.cdp.send("Network.enable", {
            "maxTotalBufferSize": self.limit, "maxResourceBufferSize": self.limit})
        # Playwright continue_ alone allows redirects to skip its route handler.
        # Hold response headers until status/media are checked, before Chromium
        # may follow a Location or run a denied/unsupported document.
        await self.cdp.send("Fetch.enable", {"patterns": [{
            "urlPattern": self.document_url, "resourceType": "Document",
            "requestStage": "Response"}]})

    async def _headers(self, event):
        response = self.response
        request = event.get("request", {})
        matches = (response and (request.get("url"), request.get("method")) == self.expected
                   and event.get("resourceType") == "Document"
                   and "responseStatusCode" in event)
        if matches:
            response.network_id = event.get("networkId") or response.network_id
            response.status = event["responseStatusCode"]
            response.headers = {h["name"].lower(): h["value"]
                                for h in event.get("responseHeaders", [])}
            response.headers_received_at = response.headers_received_at or time.monotonic()
            media = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if response.status == 200 and media == "text/html":
                await self.cdp.send("Fetch.continueResponse", {"requestId": event["requestId"]})
                return
            response.outcome = (classify_response(response.status, response.headers, b"")
                                if response.status != 200 else "UNSUPPORTED_RESPONSE")
        elif response:
            response.outcome = "NETWORK_ERROR"
        try:
            if not event.get("responseErrorReason"):
                await self.cdp.send("Fetch.failRequest", {
                    "requestId": event["requestId"], "errorReason": "Aborted"})
        except Exception:
            if response:
                response.outcome = "NETWORK_ERROR"
        finally:
            self._resolve()

    def _resolve(self):
        if self.pending and not self.pending.done():
            self.pending.set_result(None)

    async def _stop(self):
        try:
            await self.cdp.send("Page.stopLoading")
        except Exception:
            pass
        self._resolve()

    def _request(self, event):
        response = self.response
        request = event.get("request", {})
        if not response:
            if request.get("url") == self.document_url:
                self.last_request = (
                    request.get("url"), request.get("method"), event["requestId"], time.monotonic())
            return
        if event.get("redirectResponse") and response.network_id == event.get("requestId"):
            old = event["redirectResponse"]
            response.status, response.outcome = int(old["status"]), "REDIRECT"
            response.headers = {k.lower(): str(v) for k, v in old.get("headers", {}).items()}
            asyncio.create_task(self._stop())
        elif (request.get("url"), request.get("method")) == self.expected:
            if response.network_id is not None:
                response.outcome = "NETWORK_ERROR"
                asyncio.create_task(self._stop())
            else:
                response.network_id = event["requestId"]
                response.request_started_at = time.monotonic()

    def _response(self, event):
        response = self.response
        if not response or event.get("requestId") != response.network_id:
            return
        raw = event["response"]
        response.status = int(raw["status"])
        response.headers = {k.lower(): str(v) for k, v in raw.get("headers", {}).items()}
        response.headers_received_at = response.headers_received_at or time.monotonic()
        if response.status != 200:
            # classify_response retains precise HTTP/denial/rate-limit labels.
            asyncio.create_task(self._stop())
        elif response.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "text/html":
            response.outcome = "UNSUPPORTED_RESPONSE"
            asyncio.create_task(self._stop())
        else:
            response.setup = asyncio.create_task(self._begin_stream(response))

    async def _begin_stream(self, response):
        try:
            value = await self.cdp.send("Network.streamResourceContent", {
                "requestId": response.network_id})
            # dataReceived can race the command reply. Prefix must precede
            # the tail, and both must be retained only within the same cap.
            prefix = value.get("bufferedData", "")
            tail, response.tail = response.tail, deque()
            response.streaming = True
            response.add_data(prefix)
            if response.outcome == "OK":
                while tail:
                    response.buffer.extend(tail.popleft())
            else:
                tail.clear()
                response.buffer.clear()
            if response.outcome != "OK":
                await self._stop()
        except Exception:
            response.outcome = "NETWORK_ERROR"
            await self._stop()

    def _data(self, event):
        response = self.response
        if not response or event.get("requestId") != response.network_id:
            return
        response.received = min(self.limit + 1, response.received + event["dataLength"])
        if response.received > self.limit:
            response.outcome = "SIZE_LIMIT"
            asyncio.create_task(self._stop())
        elif event.get("data") and response.outcome == "OK":
            try:
                response.add_data(event["data"])
            except Exception:
                response.outcome = "NETWORK_ERROR"
                asyncio.create_task(self._stop())

    def _finished(self, event):
        if self.response and event.get("requestId") == self.response.network_id:
            self.response.complete = True
            self.response.network_completion = "COMPLETED"
            self.response.network_ended_at = time.monotonic()
            self.response.network_terminal.set()
            self._resolve()
        elif self.last_trace and event.get("requestId") == self.last_trace_network_id:
            ended_at = time.monotonic()
            self.last_trace["networkCompletion"] = "COMPLETED"
            if self.last_trace_headers_at is not None:
                self.last_trace["stages"]["headersToNetworkEndMs"] = max(
                    0, round((ended_at - self.last_trace_headers_at) * 1000))

    def _failed(self, event):
        if self.response and event.get("requestId") == self.response.network_id:
            self.response.network_completion = "FAILED"
            self.response.network_failure_class = failure_class(event.get("errorText"))
            self.response.network_ended_at = time.monotonic()
            self.response.network_terminal.set()
            if self.response.outcome == "OK":
                self.response.outcome = "NETWORK_ERROR"
            self._resolve()
        elif self.last_trace and event.get("requestId") == self.last_trace_network_id:
            ended_at = time.monotonic()
            self.last_trace["networkCompletion"] = "FAILED"
            self.last_trace["networkFailureClass"] = failure_class(event.get("errorText"))
            if self.last_trace_headers_at is not None:
                self.last_trace["stages"]["headersToNetworkEndMs"] = max(
                    0, round((ended_at - self.last_trace_headers_at) * 1000))

    def note_browser_failure(self, request, failure):
        if self.response and self.response.browser_request is request:
            self.response.browser_failure_class = failure_class(failure)
        elif self.last_browser_request is request and self.last_trace:
            self.last_trace["browserFailureClass"] = failure_class(failure)

    def stop_for_timer(self, timer):
        if self.response and self.pending:
            self.response.timer = timer
            self.response.outcome = "TIMEOUT"
            asyncio.create_task(self._stop())

    async def fetch(self, route, grant_started_at=None):
        request = route.request
        if (self.pending is not None or request.url != self.document_url
                or urlsplit(request.url).path != "/CaseSearch" or request.resource_type != "document"):
            raise ValueError("CALENDAR_STREAM_REQUEST_INVALID")
        self.expected = (request.url, request.method)
        self.pending = asyncio.get_running_loop().create_future()
        response = self.response = CalendarResponse(self.limit)
        response.browser_request = request
        response.grant_started_at = (
            grant_started_at if grant_started_at is not None else self.grant_started_at)
        if self.last_request and self.last_request[:2] == self.expected:
            response.network_id = self.last_request[2]
            response.request_started_at = self.last_request[3]
            self.last_request = None
        try:
            async with asyncio.timeout(CALENDAR_STREAM_TIMEOUT_SECONDS):
                # The parent grant and pacing precede this method. Continue
                # the original Chromium request with its form/cookies intact.
                await route.continue_()
                await self.pending
                if response.network_id and response.network_completion == "NOT_OBSERVED":
                    try:
                        async with asyncio.timeout(0.2):
                            await response.network_terminal.wait()
                    except TimeoutError:
                        pass
                if response.setup:
                    await response.setup
                if response.status == 200 and response.outcome == "OK":
                    if (not response.complete or not response.streaming
                            or response.received != len(response.buffer)):
                        response.outcome = "NETWORK_ERROR"
                if (response.outcome == "NETWORK_ERROR"
                        and response.network_completion == "NOT_OBSERVED"):
                    # The browser stream failed or ended without the required
                    # original-network completion signal; keep the failure
                    # explicit while leaving its lower-level cause unknown.
                    response.network_completion = "FAILED"
                    response.network_failure_class = "OTHER"
                    response.network_ended_at = time.monotonic()
                if response.outcome != "OK" or response.status != 200:
                    response.complete = False
                    await response.dispose()
                return response
        except TimeoutError:
            response.timer = "CALENDAR_STREAM_180S"
            if response.setup:
                response.setup.cancel()
                await asyncio.gather(response.setup, return_exceptions=True)
            await self._stop()
            await asyncio.sleep(0)
            await response.dispose()
            raise
        except BaseException:
            if response.setup:
                response.setup.cancel()
                await asyncio.gather(response.setup, return_exceptions=True)
            await self._stop()
            await asyncio.sleep(0)
            await response.dispose()
            raise
        finally:
            self.last_browser_request = response.browser_request
            self.last_trace_network_id = response.network_id
            self.last_trace_headers_at = response.headers_received_at
            self.last_trace = response.transport_trace(
                outcome=response.outcome if response.status else "NETWORK_ERROR")
            self.pending = self.expected = self.response = None
