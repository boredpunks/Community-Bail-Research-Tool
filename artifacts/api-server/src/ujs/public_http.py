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


def _download(url):
    if not allowed(url, "GET") or not any(path + "?" in url for path in (
            "/Report/CpDocketSheet", "/Report/MdjDocketSheet")):
        raise ValueError("REQUEST_NOT_PERMITTED")
    opener = request.build_opener(NoRedirect())
    req = request.Request(url, headers={
        "User-Agent": "CommunityBailResearch-SourceAssessment/1.0",
        "Accept": "text/html,application/pdf",
    })
    try:
        response = opener.open(req, timeout=45)
    except error.HTTPError as http_error:
        response = http_error
    with response:
        return Response(response.status, {key.lower(): value for key, value in response.headers.items()},
                        response.read(4_000_001))


async def download(url):
    # Only callers holding the parent's persisted request grant may invoke this.
    return await asyncio.to_thread(_download, url)
