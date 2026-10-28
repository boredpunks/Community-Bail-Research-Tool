"""The assessed public HTTP document method. No cookies, redirects or retries."""
import asyncio
from urllib import error, request
from source_protocol import allowed


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Response:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self._body = body

    async def body(self):
        return self._body

    async def dispose(self):
        self._body = None


def _download(url, timeout_seconds=45, max_bytes=4_000_000):
    if not allowed(url, "GET") or not any(path + "?" in url for path in (
            "/Report/CpDocketSheet", "/Report/MdjDocketSheet")):
        raise ValueError("REQUEST_NOT_PERMITTED")
    opener = request.build_opener(NoRedirect())
    req = request.Request(url, headers={
        "User-Agent": "CommunityBailResearch-SourceAssessment/1.0",
        "Accept": "text/html,application/pdf",
    })
    try:
        response = opener.open(req, timeout=timeout_seconds)
    except error.HTTPError as http_error:
        response = http_error
    with response:
        return Response(response.status, {key.lower(): value for key, value in response.headers.items()},
                        response.read(max_bytes + 1))


async def download(url, *, timeout_seconds=45, max_bytes=4_000_000):
    # Only callers holding the parent's persisted request grant may invoke this.
    return await asyncio.to_thread(_download, url, timeout_seconds, max_bytes)
