"""Offline-testable, fail-closed request gate for the public-form inspector.

The inspector is intentionally disabled for live use pending an enforcement
review. Every permitted request must be reserved before the browser can send it.
"""
import asyncio
import base64
from html.parser import HTMLParser
import re
import time
from urllib.parse import urljoin, urlsplit


ORIGIN = "https://ujsportal.pacourts.us"
CASE_SEARCH = f"{ORIGIN}/CaseSearch"
ASSET_PATHS = frozenset({
    "/resource/js/sitemain.min.js",
    "/resource/css/sitemain.min.css",
})
MAX_REQUESTS = 3
MAX_SESSION_SECONDS = 10 * 60
MAX_RESPONSE_BYTES = 4_000_000
RESPONSE_READ_CHUNK_BYTES = 64 * 1024
FETCH_TIMEOUT_MS = 45_000
_VERSION = re.compile(r"v=([A-Za-z0-9_-]{16,128})\Z")


class ResponseSizeLimitError(ValueError):
    """The response exceeded the inspection's bounded streaming allowance."""


async def read_bounded_response(read_chunk, *, max_bytes):
    """Read a response stream without retaining more than its explicit limit."""
    if type(max_bytes) is not int or max_bytes <= 0:
        raise ValueError("INSPECTION_RESPONSE_SIZE_LIMIT_REQUIRED")
    body = bytearray()
    while True:
        chunk = await read_chunk(RESPONSE_READ_CHUNK_BYTES)
        if not chunk:
            return bytes(body)
        if not isinstance(chunk, bytes):
            raise TypeError("INSPECTION_RESPONSE_CHUNK_INVALID")
        if len(chunk) > RESPONSE_READ_CHUNK_BYTES or len(body) + len(chunk) > max_bytes:
            body.clear()
            raise ResponseSizeLimitError("INSPECTION_RESPONSE_TOO_LARGE")
        body.extend(chunk)


class _StreamedInspectionResponse:
    def __init__(self, cdp, event, body):
        self._cdp = cdp
        self._request_id = event["requestId"]
        self._status = event["responseStatusCode"]
        self._status_text = event.get("responseStatusText", "")
        self._response_headers = event.get("responseHeaders", [])
        self.headers = {
            header["name"].lower(): header["value"]
            for header in self._response_headers
            if header.get("name")
        }
        self.status = self._status
        self._body = body
        self._fulfilled = False

    async def body(self):
        return self._body

    async def fulfill(self):
        await self._cdp.send("Fetch.fulfillRequest", {
            "requestId": self._request_id,
            "responseCode": self._status,
            "responsePhrase": self._status_text,
            "responseHeaders": self._response_headers,
            "body": base64.b64encode(self._body).decode("ascii"),
        })
        self._fulfilled = True

    async def dispose(self):
        if not self._fulfilled:
            await self._cdp.send("Fetch.failRequest", {
                "requestId": self._request_id,
                "errorReason": "Aborted",
            })
        self._body = b""


class InspectionResponseStream:
    """Stream Chromium response chunks and fail closed at the configured cap."""

    def __init__(self, cdp, *, max_bytes=MAX_RESPONSE_BYTES,
                 url_pattern=f"{ORIGIN}/*"):
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError("INSPECTION_RESPONSE_SIZE_LIMIT_REQUIRED")
        self._cdp = cdp
        self._max_bytes = max_bytes
        self._url_pattern = url_pattern
        self._pending: dict[str, asyncio.Future] = {}

    async def start(self):
        self._cdp.on("Fetch.requestPaused", self._on_response_paused)
        await self._cdp.send("Fetch.enable", {
            "patterns": [{
                "urlPattern": self._url_pattern,
                "requestStage": "Response",
            }],
        })

    async def fetch(self, route, *, timeout_ms):
        if type(timeout_ms) is not int or timeout_ms <= 0:
            raise TimeoutError("INSPECTION_SESSION_DEADLINE")
        url = route.request.url
        if url in self._pending:
            raise RuntimeError("INSPECTION_DUPLICATE_STREAM_REQUEST")
        future = asyncio.get_running_loop().create_future()
        self._pending[url] = future
        try:
            await route.continue_()
            return await asyncio.wait_for(future, timeout=timeout_ms / 1000)
        except BaseException:
            if self._pending.get(url) is future:
                del self._pending[url]
            if not future.done():
                future.cancel()
            raise

    async def _on_response_paused(self, event):
        url = event.get("request", {}).get("url")
        future = self._pending.pop(url, None)
        if future is None:
            await self._cdp.send("Fetch.failRequest", {
                "requestId": event["requestId"],
                "errorReason": "Aborted",
            })
            return
        if event.get("responseStatusCode") is None:
            await self._cdp.send("Fetch.failRequest", {
                "requestId": event["requestId"],
                "errorReason": "Aborted",
            })
            if not future.done():
                future.set_exception(RuntimeError("INSPECTION_RESPONSE_UNAVAILABLE"))
            return

        stream_handle = None
        try:
            stream = await self._cdp.send("Fetch.takeResponseBodyAsStream", {
                "requestId": event["requestId"],
            })
            stream_handle = stream["stream"]

            async def read_chunk(size):
                result = await self._cdp.send("IO.read", {
                    "handle": stream_handle,
                    "size": size,
                })
                data = result.get("data", "")
                if result.get("base64Encoded"):
                    return base64.b64decode(data, validate=True)
                return data.encode("utf-8")

            body = await read_bounded_response(
                read_chunk, max_bytes=self._max_bytes,
            )
            await self._cdp.send("IO.close", {"handle": stream_handle})
            stream_handle = None
            if not future.done():
                future.set_result(_StreamedInspectionResponse(self._cdp, event, body))
        except BaseException as error:
            if stream_handle is not None:
                try:
                    await self._cdp.send("IO.close", {"handle": stream_handle})
                except Exception:
                    pass
            try:
                await self._cdp.send("Fetch.failRequest", {
                    "requestId": event["requestId"],
                    "errorReason": "Aborted",
                })
            except Exception:
                pass
            if not future.done():
                future.set_exception(error)


def _valid_declared_asset(raw_url: str, document_url: str) -> str | None:
    absolute = urljoin(document_url, raw_url)
    parsed = urlsplit(absolute)
    if (parsed.scheme != "https" or parsed.netloc != "ujsportal.pacourts.us"
            or parsed.path not in ASSET_PATHS or parsed.fragment):
        return None
    if parsed.query and not _VERSION.fullmatch(parsed.query):
        return None
    return absolute


class _AssetDeclarations(HTMLParser):
    def __init__(self, document_url: str):
        super().__init__(convert_charrefs=True)
        self.document_url = document_url
        self.urls: set[str] = set()

    def handle_starttag(self, tag, attrs):
        attributes = {key.lower(): value for key, value in attrs if key}
        raw_url = None
        if tag.lower() == "script":
            raw_url = attributes.get("src")
        elif tag.lower() == "link" and "stylesheet" in (attributes.get("rel") or "").lower().split():
            raw_url = attributes.get("href")
        if raw_url:
            declared = _valid_declared_asset(raw_url, self.document_url)
            if declared:
                self.urls.add(declared)


def declared_asset_urls(document_url: str, html: bytes) -> frozenset[str]:
    """Return only exact, bounded stylesheet/script URLs declared by the page."""
    if (document_url != CASE_SEARCH or not isinstance(html, bytes)
            or len(html) > MAX_RESPONSE_BYTES):
        return frozenset()
    try:
        parser = _AssetDeclarations(document_url)
        parser.feed(html.decode("utf-8", errors="replace"))
        parser.close()
        return frozenset(parser.urls)
    except Exception:
        return frozenset()


class InspectionRequestGate:
    """Session-wide request budget, deduplication, and 10-minute deadline."""

    def __init__(self, *, clock=time.monotonic, max_requests=MAX_REQUESTS,
                 session_seconds=MAX_SESSION_SECONDS):
        if max_requests != MAX_REQUESTS or session_seconds != MAX_SESSION_SECONDS:
            raise ValueError("INSPECTION_POLICY_FIXED")
        self._clock = clock
        self._deadline = clock() + session_seconds
        self._lock = asyncio.Lock()
        self._reserved_paths: set[str] = set()
        self._reserved_count = 0
        self._assets: frozenset[str] = frozenset()

    @property
    def reserved_count(self) -> int:
        return self._reserved_count

    @property
    def reserved_paths(self) -> frozenset[str]:
        return frozenset(self._reserved_paths)

    def remaining_seconds(self) -> float:
        return max(0.0, self._deadline - self._clock())

    def remaining_timeout_ms(self) -> int:
        return max(0, int(self.remaining_seconds() * 1000))

    def declare_document(self, document_url: str, html: bytes) -> None:
        # Called only with the bounded response body of the permitted bootstrap GET.
        self._assets = declared_asset_urls(document_url, html)

    def _candidate_path(self, url: str, method: str, resource_type: str) -> str | None:
        try:
            parsed = urlsplit(url)
        except (TypeError, ValueError):
            return None
        if (parsed.scheme != "https" or parsed.netloc != "ujsportal.pacourts.us"
                or parsed.fragment or method != "GET"):
            return None
        if parsed.path == "/CaseSearch" and not parsed.query and resource_type == "document":
            return parsed.path
        if parsed.path not in ASSET_PATHS or resource_type not in ("script", "stylesheet"):
            return None
        if parsed.query and not _VERSION.fullmatch(parsed.query):
            return None
        # Exact URL comparison ensures a cache key is the one in the returned page.
        return parsed.path if url in self._assets else None

    async def reserve(self, url: str, method: str, resource_type: str) -> bool:
        """Atomically consume one slot before any request is handed to fetch()."""
        async with self._lock:
            if self.remaining_seconds() <= 0:
                return False
            path = self._candidate_path(url, method, resource_type)
            if (path is None or path in self._reserved_paths
                    or self._reserved_count >= MAX_REQUESTS):
                return False
            self._reserved_paths.add(path)
            self._reserved_count += 1
            return True


async def fetch_inspection_once(route, gate: InspectionRequestGate, response_stream=None):
    """Fetch only through the bounded stream, never buffering route.fetch()."""
    timeout_ms = min(FETCH_TIMEOUT_MS, gate.remaining_timeout_ms())
    if timeout_ms <= 0:
        raise TimeoutError("INSPECTION_SESSION_DEADLINE")
    if response_stream is None:
        raise RuntimeError("INSPECTION_RESPONSE_STREAM_REQUIRED")
    return await response_stream.fetch(route, timeout_ms=timeout_ms)
