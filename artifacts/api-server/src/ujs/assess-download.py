"""One approved public HTTP document assessment; no browser, cookies or retries.

Only the existing parent limiter can grant its single request. Bytes are held
in memory and discarded, including on failure. Stdout contains protocol only.
"""
import json
import re
import sys
import asyncio
from datetime import datetime, timezone

from evidence import extract_bail
from worker import allowed, emit
from public_http import download


def main():
    item = json.loads(sys.stdin.readline())
    if not allowed(item["sourceUrl"], "GET"):
        raise ValueError("REQUEST_NOT_PERMITTED")
    emit("request", path="/Report/CpDocketSheet", method="GET")
    permission = json.loads(sys.stdin.readline())
    if not permission.get("allow"):
        emit("barrier", code="REQUEST_NOT_PERMITTED")
        return
    started = datetime.now(timezone.utc).isoformat()
    body = None
    outcome = "NETWORK_ERROR"
    status = None
    retry_after = None
    try:
        async def retrieve():
            response = await download(item["sourceUrl"])
            try:
                return response.status, response.headers, await response.body()
            finally:
                await response.dispose()
        status, headers, body = asyncio.run(retrieve())
        if body is not None:
            retry_after = headers.get("retry-after")
            if status == 429:
                outcome = "RATE_LIMIT"
            elif status in (401, 403):
                outcome = "ACCESS_DENIED"
            elif 300 <= status < 400:
                outcome = "REDIRECT"
            elif status != 200:
                outcome = "HTTP_ERROR"
            elif len(body) > 4_000_000:
                outcome = "SIZE_LIMIT"
            elif "text/html" in headers.get("content-type", "") and re.search(
                rb"verify you are human|cf-chl-|g-recaptcha|hcaptcha", body, re.I
            ):
                outcome = "CHALLENGE"
            else:
                outcome = "OK"
    except Exception:
        outcome = "NETWORK_ERROR"
    emit("response", requestId=permission["requestId"], status=status,
         outcome=outcome, retryAfter=retry_after)
    try:
        result = extract_bail(body, item["docketNumber"]) if outcome == "OK" else {
            "entries": [], "postedEntryState": "UNKNOWN", "excerpt": None,
            "extractionOutcome": "RETRIEVAL_FAILED",
            "detail": f"Approved single HTTP assessment stopped: {outcome}. No guessed evidence.",
        }
        emit("docket", docketNumber=item["docketNumber"],
             retrievedAt=started if outcome == "OK" else None, **result)
    finally:
        del body


if __name__ == "__main__":
    main()
