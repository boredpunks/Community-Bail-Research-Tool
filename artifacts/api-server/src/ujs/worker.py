"""One child of the application's single worker. No database or separate service.

The parent grants every source request through its persisted shared limiter.
JSON stdout is protocol only. No PDFs, HTML, cookies or personal fields persist.
"""
import asyncio
from datetime import datetime, timezone
import json
import re
import shutil
import sys
from urllib.parse import urlsplit, parse_qs

from playwright.async_api import async_playwright
from evidence import CalendarResults, DOCKET, extract_bail
from public_http import download


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


class SourceFailure(RuntimeError):
    def __init__(self, outcome, attempted=False):
        super().__init__(outcome)
        self.attempted = attempted


def allowed(url, method):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "ujsportal.pacourts.us"
            or parsed.port not in (None, 443) or parsed.username or parsed.password):
        return False
    if parsed.path == "/CaseSearch":
        return method in ("GET", "POST") and not parsed.query
    if parsed.path in ("/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css"):
        return method == "GET"
    if parsed.path == "/Report/CpDocketSheet":
        docket = parse_qs(parsed.query).get("docketNumber", [""])[0]
        return method == "GET" and DOCKET.fullmatch(docket) and set(parse_qs(parsed.query)) <= {"docketNumber", "dnh"}
    return False


async def main():
    config = json.loads(sys.stdin.readline())
    criteria = config["criteria"]
    lock = asyncio.Lock()
    stopped = False
    requests = 0
    blocked = 0
    calendar_time = None
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=shutil.which("chromium"), headless=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-sync", "--no-first-run", "--no-sandbox"],
        )
        context = await browser.new_context(service_workers="block", accept_downloads=False)
        context.set_default_timeout(60_000)

        async def retrieve(url, method, fetcher):
            nonlocal stopped, requests, calendar_time
            async with lock:
                if stopped or not allowed(url, method):
                    raise SourceFailure("REQUEST_NOT_PERMITTED")
                emit("request", path=urlsplit(url).path, method=method)
                permission = json.loads(await asyncio.to_thread(sys.stdin.readline))
                if not permission.get("allow"):
                    stopped = True
                    raise SourceFailure("REQUEST_NOT_PERMITTED")
                requests += 1
                started = datetime.now(timezone.utc).isoformat()
                try:
                    response = await fetcher()
                    body = await response.body()
                    outcome = "OK"
                    if response.status == 429:
                        outcome = "RATE_LIMIT"
                    elif response.status in (401, 403):
                        outcome = "ACCESS_DENIED"
                    elif 300 <= response.status < 400:
                        outcome = "REDIRECT"
                    elif response.status != 200:
                        outcome = "HTTP_ERROR"
                    elif len(body) > 4_000_000:
                        outcome = "SIZE_LIMIT"
                    elif "text/html" in response.headers.get("content-type", "") and re.search(
                        rb"verify you are human|cf-chl-|g-recaptcha|hcaptcha", body, re.I
                    ):
                        outcome = "CHALLENGE"
                    emit("response", requestId=permission["requestId"], status=response.status,
                         outcome=outcome, retryAfter=response.headers.get("retry-after"))
                    if outcome != "OK":
                        stopped = True
                        await response.dispose()
                        raise SourceFailure(outcome, attempted=True)
                    if method == "POST" and urlsplit(url).path == "/CaseSearch":
                        calendar_time = started
                    return response, body, started
                except Exception as error:
                    if not stopped:
                        emit("response", requestId=permission["requestId"], status=None,
                             outcome="NETWORK_ERROR", retryAfter=None)
                    stopped = True
                    if isinstance(error, SourceFailure):
                        raise
                    raise SourceFailure("NETWORK_ERROR", attempted=True) from error

        async def handle_route(route):
            nonlocal blocked
            request = route.request
            if (not allowed(request.url, request.method)
                    or request.resource_type not in ("document", "script", "stylesheet", "xhr", "fetch")):
                blocked += 1
                await route.abort()
                return
            try:
                response, body, _ = await retrieve(
                    request.url, request.method,
                    lambda: route.fetch(max_redirects=0, max_retries=0, timeout=45_000),
                )
                await route.fulfill(response=response)
                await response.dispose()
                del body
            except Exception:
                await route.abort()

        await context.route("**/*", handle_route)
        page = await context.new_page()
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))
        try:
            items = config["pendingItems"]
            if not config["calendarComplete"]:
                await page.goto("https://ujsportal.pacourts.us/CaseSearch", wait_until="load", timeout=600_000)
                await page.locator("#SearchBy-Control select").select_option("CalendarEvent")
                await page.locator("#JudicialDistrict-Control select").select_option("05")
                await page.locator("#CourtOffice-Control select").select_option(criteria["courtOffice"])
                start = page.locator("input[name=CalendarEventStartDate]")
                minimum = await start.get_attribute("min")
                if minimum and criteria["startDate"] < minimum:
                    raise RuntimeError("UNSUPPORTED_HISTORICAL_WINDOW")
                await start.fill(criteria["startDate"])
                await page.locator("input[name=CalendarEventEndDate]").fill(criteria["endDate"])
                await page.locator("#CalendarEventType-Control select").select_option(criteria["eventType"])
                if not await page.locator("form").evaluate("(f) => f.checkValidity()"):
                    raise RuntimeError("SOURCE_FORM_VALIDATION")
                async with page.expect_navigation(wait_until="load", timeout=600_000):
                    await page.locator("#btnSearch").click()
                parser = CalendarResults()
                parser.feed(await page.content())
                items = parser.validated(criteria)
                # No automatic remote page traversal: disclose incomplete coverage.
                emit("calendar", rows=items, retrievedAt=calendar_time,
                     paginationComplete=not parser.has_remote_pagination and len(items) < 500,
                     resultCapReached=len(items) >= 500,
                     blockedAssets=blocked)
            for item in items[:config["remainingRecords"]]:
                if stopped:
                    break
                response = None
                try:
                    response, body, retrieved = await retrieve(
                        item["sourceUrl"], "GET",
                        lambda: download(item["sourceUrl"]),
                    )
                    try:
                        result = extract_bail(body, item["docketNumber"])
                        emit("docket", docketNumber=item["docketNumber"], retrievedAt=retrieved, **result)
                    finally:
                        del body
                        await response.dispose()
                except Exception as error:
                    if not stopped or isinstance(error, SourceFailure) and error.attempted:
                        emit("docket", docketNumber=item["docketNumber"],
                             retrievedAt=None, entries=[], postedEntryState="UNKNOWN",
                              excerpt=None, extractionOutcome="RETRIEVAL_FAILED" if stopped else "UNSUPPORTED_LAYOUT",
                             detail="Retrieval or processing failed; no guessed evidence saved.")
                    if stopped:
                        break
                # The parent persists the evidence and evaluates fixed matching
                # filters before permitting another document. No speculative GET.
                emit("checkpoint")
                permission = json.loads(await asyncio.to_thread(sys.stdin.readline))
                if not permission.get("continue"):
                    break
            if not stopped:
                emit("finished", blockedAssets=blocked, requests=requests)
        except Exception as error:
            emit("barrier", code=str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__)
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
