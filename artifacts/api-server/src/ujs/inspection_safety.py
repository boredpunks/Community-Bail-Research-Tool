"""Offline-testable, fail-closed request gate for the public-form inspector.

The inspector is intentionally disabled for live use pending an enforcement
review. Every permitted request must be reserved before the browser can send it.
"""
import asyncio
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
FETCH_TIMEOUT_MS = 45_000
_VERSION = re.compile(r"v=([A-Za-z0-9_-]{16,128})\Z")


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


async def fetch_inspection_once(route, gate: InspectionRequestGate):
    """A single bounded upstream fetch; redirect and retry handling are disabled."""
    timeout_ms = min(FETCH_TIMEOUT_MS, gate.remaining_timeout_ms())
    if timeout_ms <= 0:
        raise TimeoutError("INSPECTION_SESSION_DEADLINE")
    return await route.fetch(max_redirects=0, max_retries=0, timeout=timeout_ms)
