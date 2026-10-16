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


class InspectionBrokerResponse:
    """A bounded response delivered by the parent over the private worker pipe."""

    def __init__(self, message):
        if not isinstance(message, dict) or message.get("allow") is not True:
            raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
        self.request_id = message.get("requestId")
        self.status = message.get("status")
        raw_headers = message.get("headers")
        raw_body = message.get("body")
        if (not isinstance(self.request_id, str)
                or not re.fullmatch(r"[\da-f-]{36}", self.request_id, re.I)
                or type(self.status) is not int or not 100 <= self.status <= 599
                or not isinstance(raw_headers, list) or len(raw_headers) > 256
                or not isinstance(raw_body, str)
                or len(raw_body) > ((MAX_RESPONSE_BYTES + 2) // 3) * 4):
            raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
        pairs = []
        total = 0
        for pair in raw_headers:
            if (not isinstance(pair, list) or len(pair) != 2
                    or not isinstance(pair[0], str) or not isinstance(pair[1], str)
                    or not pair[0] or len(pair[0]) > 128 or len(pair[1]) > 8192
                    or any(char in pair[0] + pair[1] for char in "\r\n\0")):
                raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
            total += len(pair[0]) + len(pair[1])
            if total > 32_768:
                raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
            pairs.append((pair[0], pair[1]))
        try:
            body = base64.b64decode(raw_body, validate=True)
        except (ValueError, TypeError) as error:
            raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID") from error
        if len(body) > MAX_RESPONSE_BYTES:
            raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
        self.raw_headers = pairs
        self.headers = {}
        for name, value in pairs:
            key = name.lower()
            if key == "set-cookie":
                continue
            if key in self.headers:
                self.headers[key] += ", " + value
            else:
                self.headers[key] = value
        self._body = body

    async def body(self):
        return self._body

    async def dispose(self):
        self._body = b""


class _InterceptedRequest:
    def __init__(self, event):
        request = event.get("request", {})
        self.url = request.get("url", "")
        self.method = request.get("method", "")
        self.resource_type = str(event.get("resourceType", "")).lower()
        self._headers = request.get("headers", {})
        self.headers = self._headers if isinstance(self._headers, dict) else {}

    async def all_headers(self):
        if not isinstance(self._headers, dict):
            return {}
        return {
            str(key).lower(): str(value)
            for key, value in self._headers.items()
            if isinstance(key, str) and isinstance(value, str)
        }


class _CDPRoute:
    def __init__(self, cdp, event):
        self._cdp = cdp
        self._request_id = event.get("requestId")
        self.request = _InterceptedRequest(event)
        self._finished = False

    async def abort(self):
        if self._finished:
            return
        self._finished = True
        await self._cdp.send("Fetch.failRequest", {
            "requestId": self._request_id,
            "errorReason": "Aborted",
        })

    async def fulfill(self, *, response):
        if self._finished or not isinstance(response, InspectionBrokerResponse):
            raise RuntimeError("INSPECTION_BROKER_RESPONSE_INVALID")
        headers = []
        connection_tokens = set()
        for name, value in response.raw_headers:
            if name.lower() == "connection":
                connection_tokens.update(
                    token.strip().lower() for token in value.split(",") if token.strip()
                )
        hop_by_hop = {
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailer", "transfer-encoding", "upgrade", "content-length",
        } | connection_tokens
        for name, value in response.raw_headers:
            if name.lower() not in hop_by_hop:
                headers.append({"name": name, "value": value})
        headers.append({"name": "Content-Length", "value": str(len(response._body))})
        await self._cdp.send("Fetch.fulfillRequest", {
            "requestId": self._request_id,
            "responseCode": response.status,
            "responseHeaders": headers,
            "body": base64.b64encode(response._body).decode("ascii"),
        })
        self._finished = True


class InspectionRequestRouter:
    """Pause every browser request and fulfill it only from the parent broker."""

    def __init__(self, cdp):
        self._cdp = cdp
        self._handler = None

    async def start(self, handler):
        self._handler = handler
        self._cdp.on("Fetch.requestPaused", self._on_request_paused)
        await self._cdp.send("Fetch.enable", {
            "patterns": [{"urlPattern": "*", "requestStage": "Request"}],
        })

    async def _on_request_paused(self, event):
        route = _CDPRoute(self._cdp, event)
        try:
            if self._handler is None:
                await route.abort()
            else:
                await self._handler(route)
        except Exception:
            try:
                await route.abort()
            except Exception:
                pass


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


