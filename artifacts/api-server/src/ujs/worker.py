"""One child of the application's single worker. No database or separate service.

The parent grants every source request through its persisted shared limiter.
JSON stdout is protocol only. No PDFs, HTML, cookies or personal fields persist.
"""
import asyncio
from datetime import datetime, timezone
import json
import random
import re
import shutil
import sys
from urllib.parse import urlsplit, parse_qs

from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout
from evidence import CalendarResults, DOCKET, calendar_result_state, extract_bail
from public_http import download
from source_protocol import allowed, classify_response, CALENDAR_ASSETS
from calendar_protocol import response_pause, validate_calendar_form, submit_calendar_search, calendar_asset_barrier, fill_calendar_dates, expected_optional_console_error, CalendarFormFailure


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


class SourceFailure(RuntimeError):
    def __init__(self, outcome, attempted=False):
        super().__init__(outcome)
        self.attempted = attempted


async def main():
    config = json.loads(sys.stdin.readline())
    criteria = config["criteria"]
    lock = asyncio.Lock()
    stopped = False
    requests = 0
    blocked = 0
    calendar_time = None
    last_completed_clock = None
    loaded_assets = set()
    blocked_scripts = blocked_stylesheets = blocked_requests = page_errors = console_errors = 0
    optional_console_errors = 0
    blocked_optional_urls = set()
    diagnostic_phase = "READY"
    calendar_post_observed = False
    calendar_post_completed = False
    submission_armed = False
    source_stop_state = None
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=shutil.which("chromium"), headless=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-sync", "--no-first-run", "--no-sandbox"],
        )
        context = await browser.new_context(service_workers="block", accept_downloads=False)
        context.set_default_timeout(60_000)

        async def retrieve(url, method, fetcher):
            nonlocal stopped, requests, calendar_time, last_completed_clock
            nonlocal calendar_post_observed, calendar_post_completed, source_stop_state
            async with lock:
                if stopped or not allowed(url, method):
                    raise SourceFailure("REQUEST_NOT_PERMITTED")
                clock = asyncio.get_running_loop()
                await asyncio.sleep(response_pause(last_completed_clock, clock.time(),
                                                   random.uniform(60, 90)))
                emit("request", path=urlsplit(url).path, method=method, url=url)
                permission = json.loads(await asyncio.to_thread(sys.stdin.readline))
                if not permission.get("allow"):
                    stopped = True
                    raise SourceFailure("REQUEST_NOT_PERMITTED")
                requests += 1
                started = datetime.now(timezone.utc).isoformat()
                if method == "POST" and urlsplit(url).path == "/CaseSearch":
                    calendar_post_observed = True
                try:
                    response = await fetcher()
                    body = await response.body()
                    outcome = classify_response(response.status, response.headers, body,
                                                pdf=urlsplit(url).path == "/Report/CpDocketSheet")
                    if outcome != "OK":
                        source_stop_state = outcome
                    emit("response", requestId=permission["requestId"], status=response.status,
                         outcome=outcome, retryAfter=response.headers.get("retry-after"))
                    acknowledgement = json.loads(await asyncio.to_thread(sys.stdin.readline))
                    last_completed_clock = clock.time()
                    if not acknowledgement.get("continue"):
                        stopped = True
                    if outcome != "OK":
                        stopped = True
                        await response.dispose()
                        raise SourceFailure(outcome, attempted=True)
                    if method == "POST" and urlsplit(url).path == "/CaseSearch":
                        calendar_time = started
                        calendar_post_completed = True
                    return response, body, started
                except Exception as error:
                    if not stopped:
                        emit("response", requestId=permission["requestId"], status=None,
                             outcome="TIMEOUT" if isinstance(error, (TimeoutError, BrowserTimeout)) else "NETWORK_ERROR",
                             retryAfter=None)
                        await asyncio.to_thread(sys.stdin.readline)
                    stopped = True
                    if isinstance(error, SourceFailure):
                        raise
                    raise SourceFailure("NETWORK_ERROR", attempted=True) from error

        inspection_only = config.get("inspectionOnly") is True
        coverage_only = config.get("coverageOnly") is True
        inspection_local = False
        inspection_armed = False
        inspection_before = None
        inspection_bindings = None
        inspection_done = asyncio.Event()
        inspection_error = None
        inspection_aborted_urls = set()
        inspection_abort_errors = 0

        async def handle_route(route):
            nonlocal blocked, blocked_scripts, blocked_stylesheets, blocked_requests
            nonlocal inspection_error
            request = route.request
            if (inspection_only or coverage_only) and inspection_local and request.resource_type not in ("image", "font", "media"):
                # Local observation ONLY. Never call retrieve/route.fetch here.
                try:
                    if (not coverage_only and inspection_armed and not inspection_done.is_set()
                            and request.url == "https://ujsportal.pacourts.us/CaseSearch"
                            and request.method == "POST"):
                        from form_inspection import local_post_metadata
                        metadata = local_post_metadata(inspection_before, inspection_bindings, criteria,
                                                       request.post_data, request.headers.get("content-type", ""))
                        inspection_aborted_urls.add(request.url)
                        emit("inspection_metadata", **metadata)
                    else:
                        inspection_error = "INSPECTION_UNEXPECTED_LOCAL_REQUEST"
                except Exception:
                    inspection_error = "INSPECTION_BODY_UNSUPPORTED"
                finally:
                    inspection_done.set()
                    await route.abort()
                return
            if (not allowed(request.url, request.method)
                    or request.method == "POST" and not submission_armed
                    or request.resource_type not in ("document", "script", "stylesheet", "xhr", "fetch")):
                blocked += 1
                blocked_scripts += request.resource_type == "script"
                blocked_stylesheets += request.resource_type == "stylesheet"
                blocked_requests += request.resource_type in ("document", "xhr", "fetch")
                if request.resource_type in ("image", "font", "media") and len(blocked_optional_urls) < 10_000:
                    blocked_optional_urls.add(request.url)  # Ephemeral; never emitted.
                await route.abort()
                return
            try:
                response, body, _ = await retrieve(
                    request.url, request.method,
                    lambda: route.fetch(max_redirects=0, max_retries=0, timeout=45_000),
                )
                await route.fulfill(response=response)
                if urlsplit(request.url).path in CALENDAR_ASSETS:
                    loaded_assets.add(urlsplit(request.url).path)
                await response.dispose()
                del body
            except Exception:
                await route.abort()

        await context.route("**/*", handle_route)
        page = await context.new_page()
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))

        def note_page_error(_error):
            nonlocal page_errors
            page_errors += 1  # Never log the message; it can contain source data.

        def note_console(message):
            nonlocal console_errors, optional_console_errors
            nonlocal inspection_abort_errors
            if message.type == "error":
                if expected_optional_console_error(message.type, message.text,
                                                   message.location.get("url"), inspection_aborted_urls):
                    inspection_abort_errors += 1
                    emit("inspection_abort", count=inspection_abort_errors)
                elif expected_optional_console_error(message.type, message.text,
                                                   message.location.get("url"), blocked_optional_urls):
                    optional_console_errors += 1
                else:
                    console_errors += 1
                # Retain category counts only, never text, source URLs or tokens.

        page.on("pageerror", note_page_error)
        page.on("console", note_console)

        def calendar_diagnostics(phase):
            emit("calendar_diagnostics", phase=phase, blockedScripts=blocked_scripts,
                 blockedStylesheets=blocked_stylesheets, blockedRequests=blocked_requests,
                 pageErrors=page_errors, consoleErrors=console_errors,
                 optionalConsoleErrors=optional_console_errors,
                 scriptLoaded=CALENDAR_ASSETS[0] in loaded_assets,
                 stylesheetLoaded=CALENDAR_ASSETS[1] in loaded_assets)

        def calendar_preflight(phase):
            calendar_diagnostics(phase)
            if stopped:
                raise SourceFailure("SOURCE_STOPPED")
            barrier = calendar_asset_barrier(loaded_assets, blocked_scripts,
                                            blocked_stylesheets, blocked_requests, page_errors,
                                            console_errors)
            if barrier:
                raise RuntimeError(barrier)

        try:
            items = config["pendingItems"]
            if not config["calendarComplete"]:
                await page.goto("https://ujsportal.pacourts.us/CaseSearch", wait_until="load", timeout=600_000)
                calendar_preflight("READY")
                if coverage_only:
                    # Bootstrap is complete. No subsequent transmission is allowed.
                    inspection_local = True
                    from coverage_inspection import observe
                    await observe(page, emit)
                    await asyncio.sleep(0.1)
                    if inspection_error:
                        raise RuntimeError("COVERAGE_UNEXPECTED_LOCAL_REQUEST")
                    await context.close()
                    await browser.close()
                    calendar_preflight("RESULT")
                    emit("coverage_finished")
                    return
                if inspection_only:
                    inspection_local = True  # No further transmissions, including dependent-control fetches.
                await page.locator("#SearchBy-Control select").select_option("CalendarEvent")
                await page.locator("#JudicialDistrict-Control select").select_option("05")
                await page.locator("#CourtOffice-Control select").select_option(criteria["courtOffice"])
                await page.locator("#CalendarEventType-Control select").select_option(criteria["eventType"])
                start = page.locator("input[name=CalendarEventStartDate]")
                minimum = await start.get_attribute("min")
                if minimum and criteria["startDate"] < minimum:
                    raise RuntimeError("UNSUPPORTED_HISTORICAL_WINDOW")
                await fill_calendar_dates(page, criteria)
                if inspection_only:
                    from form_inspection import snapshot
                    inspection_before, inspection_bindings = await snapshot(page, criteria)
                    if inspection_error or not all(row["uiMatches"] and row["uiEnabled"] and row["uiSameForm"]
                                                   for row in inspection_before["controls"]):
                        raise RuntimeError("INSPECTION_PUBLIC_STATE_MISMATCH")
                    emit("inspection_metadata", **inspection_before)
                    calendar_preflight("READY")
                    inspection_armed = True
                    await page.locator("#btnSearch").click(no_wait_after=True, timeout=5000)
                    await asyncio.wait_for(inspection_done.wait(), timeout=5)
                    await asyncio.sleep(0.1)
                    if inspection_error:
                        raise RuntimeError(inspection_error)
                    await context.close()
                    await browser.close()
                    calendar_preflight("RESULT")
                    emit("inspection_finished")
                    return
                await validate_calendar_form(page, criteria)
                calendar_preflight("READY")
                emit("calendar_state", state="FORM_READY", formVisible=await page.locator("#btnSearch").is_visible())
                diagnostic_phase = "RESULT"
                submission_armed = True
                await submit_calendar_search(page)
                calendar_preflight("RESULT")
                if not calendar_post_observed:
                    raise RuntimeError("SUBMISSION_NOT_OBSERVED")
                if not calendar_post_completed:
                    raise RuntimeError("UNEXPECTED_RESPONSE")
                parser = CalendarResults()
                parser.feed(await page.content())
                try:
                    items = parser.validated(criteria)
                except ValueError as error:
                    emit("calendar_state", state="RESULTS_NOT_VALIDATED",
                         formVisible=await page.locator("#btnSearch").is_visible())
                    raise RuntimeError(str(error)) from error
                state = calendar_result_state(parser.table_found, items or [], explicit_empty_state=False)
                emit("calendar_state", state=state,
                     formVisible=await page.locator("#btnSearch").is_visible())
                if state not in ("RESULTS_VALIDATED", "EMPTY_RESULTS_VALIDATED"):
                    raise RuntimeError("RESULTS_NOT_VALIDATED")
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
            calendar_diagnostics(diagnostic_phase)
            if isinstance(error, CalendarFormFailure):
                for failure in error.failures:
                    emit("calendar_form_diagnostic", **failure)
            if source_stop_state == "ACCESS_DENIED":
                emit("calendar_state", state="ACCESS_DENIED", formVisible=False)
            elif isinstance(error, RuntimeError) and str(error) == "SOURCE_FORM_VALIDATION":
                emit("calendar_state", state="FORM_VALIDATION_ERROR", formVisible=False)
            elif not calendar_post_observed:
                emit("calendar_state", state="SUBMISSION_NOT_OBSERVED", formVisible=False)
            elif calendar_post_completed:
                emit("calendar_state", state="RESULTS_NOT_VALIDATED", formVisible=False)
            else:
                emit("calendar_state", state="UNEXPECTED_RESPONSE", formVisible=False)
            safe_code = str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__
            emit("barrier", code=safe_code if safe_code in {
                "COVERAGE_FORM_MISSING", "COVERAGE_CONTROL_INVALID",
                "COVERAGE_CONTROL_AMBIGUOUS", "COVERAGE_UNEXPECTED_LOCAL_REQUEST",
                "INSPECTION_METADATA_INVALID", "INSPECTION_BODY_UNSUPPORTED",
                "INSPECTION_UNEXPECTED_LOCAL_REQUEST", "INSPECTION_PUBLIC_STATE_MISMATCH",
                "SOURCE_FORM_VALIDATION", "RESULTS_NOT_VALIDATED",
                "CALENDAR_REQUIRED_RESOURCE_BLOCKED", "CALENDAR_REQUIRED_ASSET_MISSING",
                "CALENDAR_SCRIPT_ERROR", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                "CALENDAR_CONSOLE_ERROR",
                "CALENDAR_CONTROL_STATE_MISMATCH", "CALENDAR_SUBMITTED_VALUES_MISMATCH",
                "CALENDAR_FORM_MISSING", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                "CALENDAR_PREFLIGHT_FAILED",
                "SUBMISSION_NOT_OBSERVED", "UNEXPECTED_RESPONSE",
                "CALENDAR_DOCUMENT_LINK_MISSING", "UNSUPPORTED_CALENDAR_LAYOUT",
                "CALENDAR_IDENTITY_OR_COVERAGE_CONFLICT", "UNSUPPORTED_EVENT_DATE_LAYOUT",
                "CALENDAR_EVENT_DATE_OUTSIDE_REQUESTED_WINDOW",
            } else "UNEXPECTED_RESPONSE")
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
