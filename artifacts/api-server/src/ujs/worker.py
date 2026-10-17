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
from calendar_protocol import response_pause, validate_calendar_form, submit_calendar_search, calendar_asset_barrier, fill_calendar_dates, expected_optional_console_error, CalendarFormFailure, select_calendar_preview_controls, calendar_form_field_count, calendar_form_field_shape, wait_for_calendar_search_button, calendar_search_button_visible, validate_unfiltered_calendar_room
from inspection_safety import (
    InspectionBrokerResponse, InspectionRequestGate, InspectionRequestRouter,
    read_inspection_protocol_line,
)
from network_sandbox import require_default_deny_active, verify_inspection_runtime


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


class SourceFailure(RuntimeError):
    def __init__(self, outcome, attempted=False):
        super().__init__(outcome)
        self.attempted = attempted


async def main(config=None):
    config = config if config is not None else json.loads(sys.stdin.readline())
    criteria = config["criteria"]
    inspection_only = config.get("inspectionOnly") is True
    if inspection_only:
        # This is a defense-in-depth stop for old, already-prepared permits.
        # Live INSPECT is disabled until the offline gate receives review.
        emit("barrier", code="FORM_INSPECTION_LIVE_DISABLED")
        return
    if inspection_only:
        # Keep these checks immediately behind the live-disabled barrier: if
        # that barrier is ever reconsidered, the kernel boundary and exact
        # tested runtime are mandatory before Playwright can start.
        require_default_deny_active()
        verify_inspection_runtime(shutil.which("chromium"))
    inspection_gate = InspectionRequestGate() if inspection_only else None
    calendar_preview_only = config.get("calendarPreviewOnly") is True
    courtroom_observation_only = config.get("courtroomObservationOnly") is True
    if courtroom_observation_only and (
            config.get("coverageOnly") is not True
            or criteria.get("courtOffice") != "CP-05-02-Crim"
            or criteria.get("eventType") != "Bail Hearing"
            or criteria.get("courtRoom") != "Courtroom 506"
            or criteria.get("requestCap") != 3 or criteria.get("recordCap") != 1):
        emit("barrier", code="COURTROOM_OBSERVATION_SCOPE_INVALID")
        return
    courtroom_observer = None
    if courtroom_observation_only:
        # A packaging failure must be discovered before any source request.
        try:
            from courtroom_observation import observe as courtroom_observer
        except ImportError:
            emit("barrier", code="COURTROOM_OBSERVATION_UNAVAILABLE")
            return
    lock = asyncio.Lock()
    stopped = False
    requests = 0
    blocked = 0
    calendar_time = None
    last_completed_clock = None
    loaded_assets = set()
    asset_cache = {}
    cached_responses = 0
    blocked_scripts = blocked_stylesheets = blocked_requests = page_errors = console_errors = 0
    optional_console_errors = 0
    blocked_optional_urls = set()
    diagnostic_phase = "READY"
    form_phase = "INITIALIZATION"
    calendar_post_observed = False
    calendar_post_completed = False
    submission_armed = False
    source_stop_state = None
    response_recorder = None
    if not (inspection_only or config.get("coverageOnly") or config.get("filingInspectionOnly")):
        from calendar_diagnostics import CalendarDiagnosticRecorder, RESPONSE_STRUCTURE, parser_outcome
        response_recorder = CalendarDiagnosticRecorder()
    response_structure = None
    response_inspection_status = "NOT_SAFE"
    response_inspection_attempted = False
    response_parser_attempted = False
    response_parser_outcome = "NOT_RUN"
    post_response_read_only = False
    blocked_during_inspection = 0
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=shutil.which("chromium"), headless=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-sync", "--no-first-run", "--no-sandbox",
                  "--no-proxy-server",
                  "--host-resolver-rules=MAP * ~NOTFOUND"],
        )
        context = await browser.new_context(service_workers="block", accept_downloads=False)
        context.set_default_timeout(60_000)

        async def retrieve(url, method, fetcher, *, resource_type=None, headers=None, tracked_key=None):
            nonlocal stopped, requests, calendar_time, last_completed_clock
            nonlocal calendar_post_observed, calendar_post_completed, source_stop_state

            async def read_protocol_line():
                reader = (asyncio.to_thread(read_inspection_protocol_line, sys.stdin)
                          if inspection_only else asyncio.to_thread(sys.stdin.readline))
                if not inspection_only:
                    return await reader
                remaining = inspection_gate.remaining_seconds()
                if remaining <= 0:
                    raise SourceFailure("INSPECTION_SESSION_DEADLINE")
                return await asyncio.wait_for(reader, timeout=remaining)

            async with lock:
                if (stopped or not allowed(url, method)
                        or (post_response_read_only or response_recorder and response_recorder.overflow)
                        and resource_type is not None):
                    raise SourceFailure("REQUEST_NOT_PERMITTED")
                clock = asyncio.get_running_loop()
                pause = response_pause(last_completed_clock, clock.time(), random.uniform(60, 90))
                if inspection_only:
                    remaining = inspection_gate.remaining_seconds()
                    if remaining <= 0:
                        raise SourceFailure("INSPECTION_SESSION_DEADLINE")
                    await asyncio.wait_for(asyncio.sleep(pause), timeout=remaining)
                else:
                    await asyncio.sleep(pause)
                if post_response_read_only and resource_type is not None:
                    raise SourceFailure("RESPONSE_INSPECTION_READ_ONLY")
                if inspection_only:
                    emit("request", path=urlsplit(url).path, method=method, url=url,
                         resourceType=resource_type, headers=headers or {})
                else:
                    emit("request", path=urlsplit(url).path, method=method, url=url)
                permission = json.loads(await read_protocol_line())
                if not permission.get("allow"):
                    stopped = True
                    raise SourceFailure(str(permission.get("reason") or "REQUEST_NOT_PERMITTED"))
                if post_response_read_only and resource_type is not None:
                    # A grant may have been awaiting the parent when a console
                    # stop arrived. Do not transmit after that stop; conservatively
                    # consume/account the granted slot rather than silently reuse it.
                    emit("response", requestId=permission["requestId"], status=None,
                         outcome="UNCERTAIN_AFTER_WORKER", retryAfter=None)
                    await read_protocol_line()
                    stopped = True
                    raise SourceFailure("SOURCE_STOPPED")
                if inspection_only and inspection_gate.remaining_seconds() <= 0:
                    stopped = True
                    raise SourceFailure("INSPECTION_SESSION_DEADLINE")
                requests += 1
                started = datetime.now(timezone.utc).isoformat()
                if method == "POST" and urlsplit(url).path == "/CaseSearch":
                    calendar_post_observed = True
                try:
                    if inspection_only and permission.get("brokerOutcome"):
                        outcome = permission["brokerOutcome"]
                        if outcome not in ("SIZE_LIMIT", "UNSUPPORTED_RESPONSE"):
                            raise RuntimeError("INSPECTION_BROKER_DIAGNOSTIC_INVALID")
                        status = permission.get("status")
                        retry_after = permission.get("retryAfter")
                        if type(status) is not int or not 100 <= status <= 599:
                            raise RuntimeError("INSPECTION_BROKER_DIAGNOSTIC_INVALID")
                        source_stop_state = outcome
                        emit("response", requestId=permission["requestId"], status=status,
                             outcome=outcome, retryAfter=retry_after)
                        acknowledgement = json.loads(await read_protocol_line())
                        last_completed_clock = clock.time()
                        stopped = True
                        if not acknowledgement.get("continue"):
                            stopped = True
                        raise SourceFailure(outcome, attempted=True)
                    if inspection_only and permission.get("transportError"):
                        outcome = permission["transportError"]
                        if outcome not in ("TIMEOUT", "NETWORK_ERROR"):
                            raise RuntimeError("INSPECTION_BROKER_DIAGNOSTIC_INVALID")
                        source_stop_state = outcome
                        emit("response", requestId=permission["requestId"], status=None,
                             outcome=outcome, retryAfter=None)
                        await read_protocol_line()
                        last_completed_clock = clock.time()
                        stopped = True
                        raise SourceFailure(outcome, attempted=True)
                    response = (InspectionBrokerResponse(permission)
                                if inspection_only else None)
                    if not inspection_only:
                        if response_recorder:
                            response_recorder.decide(tracked_key, "FETCH_ATTEMPT")
                            if method == "POST" and urlsplit(url).path == "/CaseSearch":
                                response_recorder.mark("POST_ATTEMPT")
                        response = await fetcher()
                    if response_recorder and method == "POST":
                        response_recorder.mark("RESPONSE_RECEIVED")
                    body = await response.body()
                    if response_recorder and method == "POST":
                        response_recorder.mark("RESPONSE_BODY_READ")
                    outcome = classify_response(
                        response.status, response.headers, body,
                        pdf=urlsplit(url).path == "/Report/CpDocketSheet",
                        path=urlsplit(url).path,
                    )
                    if outcome != "OK":
                        source_stop_state = outcome
                        if response_recorder:
                            response_recorder.resource_failure(url, resource_type, blocked_optional_urls,
                                diagnostic_phase, key=tracked_key, status=response.status)
                    emit("response", requestId=permission["requestId"], status=response.status,
                         outcome=outcome, retryAfter=response.headers.get("retry-after"))
                    acknowledgement = json.loads(await read_protocol_line())
                    last_completed_clock = clock.time()
                    if not acknowledgement.get("continue"):
                        stopped = True
                        if inspection_only:
                            await response.dispose()
                            raise SourceFailure("SOURCE_STOPPED", attempted=True)
                    if outcome != "OK":
                        stopped = True
                        await response.dispose()
                        raise SourceFailure(outcome, attempted=True)
                    if method == "POST" and urlsplit(url).path == "/CaseSearch":
                        calendar_time = started
                        calendar_post_completed = True
                        if response_recorder:
                            response_recorder.mark("POST_ACKNOWLEDGED")
                    return response, body, started
                except Exception as error:
                    if not stopped:
                        outcome = "TIMEOUT" if isinstance(error, (TimeoutError, BrowserTimeout)) else "NETWORK_ERROR"
                        if response_recorder:
                            response_recorder.resource_failure(url, resource_type, blocked_optional_urls,
                                diagnostic_phase, key=tracked_key, text="ERR_TIMED_OUT" if outcome == "TIMEOUT" else None)
                        source_stop_state = outcome
                        emit("response", requestId=permission["requestId"], status=None,
                             outcome=outcome,
                             retryAfter=None)
                        await read_protocol_line()
                    stopped = True
                    if isinstance(error, SourceFailure):
                        raise
                    raise SourceFailure("NETWORK_ERROR", attempted=True) from error

        coverage_only = config.get("coverageOnly") is True
        filing_inspection_only = config.get("filingInspectionOnly") is True
        inspection_local = False
        inspection_error = None

        async def handle_route(route):
            nonlocal blocked, blocked_scripts, blocked_stylesheets, blocked_requests
            nonlocal inspection_error
            nonlocal cached_responses, blocked_during_inspection
            request = route.request
            if response_recorder:
                response_recorder.register(request, request.url, request.resource_type, diagnostic_phase)
            if (inspection_only or coverage_only or filing_inspection_only) and inspection_local and request.resource_type not in ("image", "font", "media"):
                # Local observation ONLY. Never call retrieve/route.fetch here.
                inspection_error = "INSPECTION_UNEXPECTED_LOCAL_REQUEST"
                await route.abort()
                return
            if inspection_only and (
                inspection_gate is None
                or not await inspection_gate.reserve(request.url, request.method, request.resource_type)
            ):
                inspection_error = "INSPECTION_REQUEST_BLOCKED"
                await route.abort()
                return
            if (not allowed(request.url, request.method)
                    or calendar_preview_only and urlsplit(request.url).path == "/Report/CpDocketSheet"
                    or request.method == "POST" and not submission_armed
                    or request.resource_type not in ("document", "script", "stylesheet", "xhr", "fetch")):
                blocked += 1
                blocked_scripts += request.resource_type == "script"
                blocked_stylesheets += request.resource_type == "stylesheet"
                blocked_requests += request.resource_type in ("document", "xhr", "fetch")
                if request.resource_type in ("image", "font", "media") and len(blocked_optional_urls) < 10_000:
                    blocked_optional_urls.add(request.url)  # Ephemeral; never emitted.
                if response_recorder:
                    response_recorder.decide(request, "OPTIONAL_ABORT" if request.resource_type in (
                        "image", "font", "media") else "POLICY_ABORT")
                if post_response_read_only:
                    blocked_during_inspection = min(10_000, blocked_during_inspection + 1)
                await route.abort()
                return
            if (request.method == "POST" and urlsplit(request.url).path == "/CaseSearch"
                    and request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    != "application/x-www-form-urlencoded"):
                blocked += 1
                blocked_requests += 1
                if response_recorder:
                    response_recorder.decide(request, "POLICY_ABORT")
                await route.fulfill(status=400, content_type="text/plain", body="")
                return
            try:
                cacheable = (not (inspection_only or coverage_only or filing_inspection_only)
                             and request.method == "GET"
                             and urlsplit(request.url).path in CALENDAR_ASSETS
                             and request.resource_type in ("script", "stylesheet"))
                cached = asset_cache.get((request.url, request.resource_type)) if cacheable else None
                if cached is not None:
                    if stopped:
                        await route.abort()
                        return
                    headers, body = cached
                    if response_recorder:
                        response_recorder.decide(request, "CACHE")
                    await route.fulfill(status=200, headers=headers, body=body)
                    cached_responses += 1
                    return  # No grant, pacing, network request or source accounting.
                if post_response_read_only:
                    if response_recorder:
                        response_recorder.decide(request, "READ_ONLY_STOP")
                    blocked_during_inspection = min(10_000, blocked_during_inspection + 1)
                    blocked += 1
                    blocked_scripts += request.resource_type == "script"
                    blocked_stylesheets += request.resource_type == "stylesheet"
                    blocked_requests += request.resource_type in ("document", "xhr", "fetch")
                    await route.abort()
                    return
                response, body, _ = await retrieve(
                    request.url, request.method,
                    (lambda: None) if inspection_only else
                    (lambda: route.fetch(max_redirects=0, max_retries=0, timeout=45_000)),
                    resource_type=request.resource_type,
                    headers=await request.all_headers() if inspection_only else None,
                    tracked_key=request,
                )
                if inspection_only and urlsplit(request.url).path == "/CaseSearch":
                    inspection_gate.declare_document(request.url, body)
                await route.fulfill(response=response)
                if response_recorder and request.method == "POST":
                    response_recorder.mark("DOCUMENT_FULFILLED")
                if urlsplit(request.url).path in CALENDAR_ASSETS:
                    loaded_assets.add(urlsplit(request.url).path)
                    if cacheable and not calendar_post_observed and len(asset_cache) < 2:
                        # Decoded bytes from the successful bootstrap only, in
                        # this worker's memory. Exact URL/version and resource
                        # type must match. Never replay cookies or wire framing.
                        headers = {key: value for key, value in response.headers.items()
                                   if key.lower() not in {
                                       "set-cookie", "content-encoding", "content-length",
                                       "transfer-encoding", "connection", "keep-alive",
                                       "proxy-authenticate", "proxy-authorization",
                                       "te", "trailer", "upgrade",
                                   }}
                        asset_cache[(request.url, request.resource_type)] = (headers, body)
                await response.dispose()
                del body
            except Exception:
                try:
                    await route.abort()
                except Exception:
                    # A response may already have been fulfilled or aborted by CDP.
                    pass

        if inspection_only:
            if not hasattr(context, "route_web_socket"):
                raise RuntimeError("INSPECTION_WEBSOCKET_INTERCEPTION_UNAVAILABLE")

            async def block_websocket(websocket):
                await websocket.close()

            await context.route_web_socket("**/*", block_websocket)
        page = await context.new_page()
        if inspection_only:
            inspection_cdp = await context.new_cdp_session(page)
            inspection_router = InspectionRequestRouter(inspection_cdp)
            await inspection_router.start(handle_route)
        else:
            await context.route("**/*", handle_route)
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))

        def note_page_error(_error):
            nonlocal page_errors, post_response_read_only
            page_errors = min(10_000, page_errors + 1)  # Never log source messages.
            if response_recorder:
                response_recorder.exception(diagnostic_phase)
                post_response_read_only = True
                response_recorder.mark("READ_ONLY")

        def note_console(message):
            nonlocal console_errors, optional_console_errors, post_response_read_only
            if message.type == "error":
                optional = (response_recorder.console(message.type, message.text,
                    message.location.get("url"), blocked_optional_urls, diagnostic_phase)
                    if response_recorder else expected_optional_console_error(
                        message.type, message.text, message.location.get("url"), blocked_optional_urls))
                if optional:
                    optional_console_errors = min(10_000, optional_console_errors + 1)
                else:
                    console_errors = min(10_000, console_errors + 1)
                    if response_recorder:
                        post_response_read_only = True
                        response_recorder.mark("READ_ONLY")
                # Retain category counts only, never text, source URLs or tokens.

        page.on("pageerror", note_page_error)
        page.on("console", note_console)
        if response_recorder:
            page.on("request", lambda request: response_recorder.register(
                request, request.url, request.resource_type, diagnostic_phase))
            page.on("requestfailed", lambda request: response_recorder.resource_failure(
                request.url, request.resource_type, blocked_optional_urls, diagnostic_phase,
                key=request, text=request.failure))

        def calendar_diagnostics(phase):
            emit("calendar_diagnostics", phase=phase, blockedScripts=blocked_scripts,
                 blockedStylesheets=blocked_stylesheets, blockedRequests=blocked_requests,
                 pageErrors=page_errors, consoleErrors=console_errors,
                 optionalConsoleErrors=optional_console_errors,
                     networkRequests=requests, cachedResponses=cached_responses,
                 scriptLoaded=CALENDAR_ASSETS[0] in loaded_assets,
                 stylesheetLoaded=CALENDAR_ASSETS[1] in loaded_assets)

        def calendar_preflight(phase):
            calendar_diagnostics(phase)
            if stopped:
                raise SourceFailure("SOURCE_STOPPED")
            barrier = calendar_asset_barrier(loaded_assets, blocked_scripts,
                                            blocked_stylesheets, blocked_requests, page_errors,
                                            console_errors)
            if not barrier and response_recorder and response_recorder.blocking_resource_failure:
                barrier = "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"
            if not barrier and response_recorder and response_recorder.overflow:
                barrier = "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE"
            if barrier:
                raise RuntimeError(barrier)

        async def inspect_loaded_response():
            nonlocal post_response_read_only, response_structure, response_inspection_status
            nonlocal response_inspection_attempted
            if not response_recorder or response_inspection_attempted:
                return
            response_inspection_attempted = True
            # All subsequent browser retrieval is local or aborted. PDFs use
            # the separately authorized sequential path only after validation.
            post_response_read_only = True
            response_recorder.mark("READ_ONLY")
            if stopped or not calendar_post_observed or not calendar_post_completed or lock.locked():
                return
            try:
                response_recorder.mark("INSPECTION")
                response_structure = await asyncio.wait_for(page.evaluate(RESPONSE_STRUCTURE), timeout=1.5)
                response_inspection_status = "OBSERVED"
                await asyncio.sleep(0)
            except Exception:
                response_inspection_status = "UNAVAILABLE"
                response_structure = None

        def response_diagnostic():
            if not response_recorder or not (calendar_post_observed or response_recorder.groups):
                return
            gate = ("SOURCE_STOPPED" if stopped else calendar_asset_barrier(
                loaded_assets, blocked_scripts, blocked_stylesheets, blocked_requests, page_errors, console_errors))
            if not gate and response_recorder.blocking_resource_failure:
                gate = "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"
            if not gate and (response_inspection_status != "OBSERVED"
                             or response_structure["countsCapped"] or response_recorder.overflow):
                gate = "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE"
            emit("calendar_response_diagnostic", version=2, phase="RESULT",
                 submissionObserved=calendar_post_observed, responseCompleted=calendar_post_completed,
                 inspectionStatus=response_inspection_status, structure=response_structure,
                 parserAttempted=response_parser_attempted, parserOutcome=response_parser_outcome,
                 stopGate=gate or "NONE", classifications=response_recorder.snapshot(),
                 classificationOverflow=response_recorder.overflow, blockedDuringInspection=blocked_during_inspection,
                 eventSequence=response_recorder.sequence, milestones=response_recorder.milestones)

        try:
            items = config["pendingItems"]
            if not config["calendarComplete"]:
                goto_timeout = 600_000
                if inspection_only:
                    goto_timeout = min(goto_timeout, inspection_gate.remaining_timeout_ms())
                    if goto_timeout <= 0:
                        raise RuntimeError("INSPECTION_SESSION_DEADLINE")
                await page.goto("https://ujsportal.pacourts.us/CaseSearch", wait_until="load", timeout=goto_timeout)
                calendar_preflight("READY")
                # Inspection inventory has its own readiness rules and remains frozen.
                if filing_inspection_only or coverage_only or inspection_only:
                    await calendar_form_field_shape(page)
                else:
                    await wait_for_calendar_search_button(page)
                    await calendar_form_field_count(page)
                if filing_inspection_only:
                    inspection_local = True
                    from filing_inventory import observe
                    await observe(page, emit, lambda: inspection_error is None)
                    await asyncio.sleep(0.1)
                    if inspection_error:
                        raise RuntimeError("FILING_UNEXPECTED_LOCAL_REQUEST")
                    await context.close()
                    await browser.close()
                    calendar_preflight("RESULT")
                    emit("filing_finished")
                    return
                if coverage_only:
                    # Bootstrap is complete. No subsequent transmission is allowed.
                    inspection_local = True
                    if courtroom_observation_only:
                        form_phase = "CONTROL_SELECTION"
                        await courtroom_observer(page, emit, criteria, lambda: inspection_error is None)
                    else:
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
                preview_values = None
                form_phase = "CONTROL_SELECTION"
                if inspection_only:
                    await select_calendar_preview_controls(page, criteria)
                else:
                    from calendar_protocol import select_bound_calendar_controls
                    preview_values = await select_bound_calendar_controls(page, criteria)
                if not inspection_only and not criteria.get("courtRoom"):
                    await validate_unfiltered_calendar_room(page)
                    preview_values["courtRoom"] = ""
                form_phase = "DATE_ENTRY"
                await fill_calendar_dates(page, criteria)
                if inspection_only:
                    from form_inspection import snapshot
                    inspection_before = await snapshot(page, criteria)
                    if inspection_error or not all(row["uiMatches"] and row["uiEnabled"] and row["uiSameForm"]
                                                   for row in inspection_before["controls"]):
                        raise RuntimeError("INSPECTION_PUBLIC_STATE_MISMATCH")
                    emit("inspection_metadata", **inspection_before)
                    calendar_preflight("READY")
                    if inspection_error:
                        raise RuntimeError(inspection_error)
                    if inspection_gate.remaining_seconds() <= 0:
                        raise RuntimeError("INSPECTION_SESSION_DEADLINE")
                    await context.close()
                    await browser.close()
                    calendar_preflight("RESULT")
                    emit("inspection_finished")
                    return
                form_phase = "FINAL_VALIDATION"
                # Dependent widgets may replace/reorder unrelated native fields.
                # Bound the final form, then validate the exact current criteria,
                # owner, action, method and submitted backing values instead.
                await calendar_form_field_count(page)
                from calendar_protocol import validate_bound_calendar_form
                await validate_bound_calendar_form(page, criteria, preview_values)
                calendar_preflight("READY")
                emit("calendar_state", state="FORM_READY", formVisible=await page.locator("#btnSearch").is_visible())
                diagnostic_phase = "RESULT"
                form_phase = "SUBMISSION"
                submission_armed = True
                response_recorder.mark("SEARCH_ARMED")
                await submit_calendar_search(page)
                await inspect_loaded_response()
                calendar_preflight("RESULT")
                if not calendar_post_observed:
                    raise RuntimeError("SUBMISSION_NOT_OBSERVED")
                if not calendar_post_completed:
                    raise RuntimeError("UNEXPECTED_RESPONSE")
                if (response_inspection_status != "OBSERVED" or response_structure["countsCapped"]
                        or response_recorder.overflow):
                    raise RuntimeError("CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE")
                if response_structure["resultTableCount"] != 1:
                    raise RuntimeError("RESULTS_NOT_VALIDATED")
                parser = CalendarResults()
                response_parser_attempted = True
                response_recorder.mark("PARSER_STARTED")
                parser.feed(await page.content())
                try:
                    items = parser.validated(criteria)
                except ValueError as error:
                    response_parser_outcome = parser_outcome(error)
                    response_recorder.mark("PARSER_REJECTED")
                    emit("calendar_state", state="RESULTS_NOT_VALIDATED",
                         formVisible=await page.locator("#btnSearch").is_visible())
                    raise RuntimeError(str(error)) from error
                response_parser_outcome = "CANDIDATE_NONEMPTY" if items else "NO_EMPTY_PROOF"
                calendar_preflight("RESULT")
                state = calendar_result_state(parser.table_found, items or [], explicit_empty_state=False)
                emit("calendar_state", state=state,
                     formVisible=await page.locator("#btnSearch").is_visible())
                if state not in ("RESULTS_VALIDATED", "EMPTY_RESULTS_VALIDATED"):
                    response_recorder.mark("PARSER_REJECTED")
                    raise RuntimeError("RESULTS_NOT_VALIDATED")
                response_recorder.mark("PARSER_ACCEPTED")
                response_diagnostic()
                # No automatic remote page traversal: disclose incomplete coverage.
                emit("calendar", rows=items, retrievedAt=calendar_time,
                     paginationComplete=not parser.has_remote_pagination and len(items) < 500,
                     resultCapReached=len(items) >= 500, blockedAssets=blocked,
                     **({"columnHeaders": parser.validated_column_headers}
                        if calendar_preview_only else {}))
                if calendar_preview_only:
                    emit("calendar_preview_finished")
                    return
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
            if response_recorder and response_parser_attempted and not any(
                    m["name"] in ("PARSER_ACCEPTED", "PARSER_REJECTED") for m in response_recorder.milestones):
                response_recorder.mark("PARSER_REJECTED")
            if response_parser_attempted and response_parser_outcome == "NOT_RUN":
                response_parser_outcome = "PARSER_ERROR"
                response_recorder.mark("PARSER_REJECTED")
            if response_recorder and (calendar_post_observed or response_recorder.groups):
                await inspect_loaded_response()
                response_diagnostic()
            calendar_diagnostics(diagnostic_phase)
            if isinstance(error, CalendarFormFailure):
                for failure in error.failures:
                    emit("calendar_form_diagnostic", **failure, phase=form_phase)
            form_visible = await calendar_search_button_visible(page)
            if source_stop_state == "ACCESS_DENIED":
                emit("calendar_state", state="ACCESS_DENIED", formVisible=form_visible)
            elif isinstance(error, RuntimeError) and str(error) == "SOURCE_FORM_VALIDATION":
                emit("calendar_state", state="FORM_VALIDATION_ERROR", formVisible=form_visible)
            elif not calendar_post_observed:
                emit("calendar_state", state="SUBMISSION_NOT_OBSERVED", formVisible=form_visible)
            elif calendar_post_completed:
                emit("calendar_state", state="RESULTS_NOT_VALIDATED", formVisible=form_visible)
            else:
                emit("calendar_state", state="UNEXPECTED_RESPONSE", formVisible=form_visible)
            safe_code = ("CALENDAR_RESULT_LOAD_TIMEOUT"
                         if isinstance(error, BrowserTimeout) and calendar_post_completed
                         else source_stop_state
                         if source_stop_state in {
                             "ACCESS_DENIED", "CHALLENGE", "HTTP_ERROR", "LOGIN_PROMPT",
                             "NETWORK_ERROR", "RATE_LIMIT", "REDIRECT", "SIZE_LIMIT",
                             "TIMEOUT", "UNSUPPORTED_RESPONSE",
                         }
                         else str(error) if isinstance(error, (RuntimeError, ValueError))
                         else type(error).__name__)
            emit("barrier", code=safe_code if safe_code in {
                "ACCESS_DENIED", "CHALLENGE", "HTTP_ERROR", "LOGIN_PROMPT",
                "NETWORK_ERROR", "RATE_LIMIT", "REDIRECT", "SIZE_LIMIT",
                "TIMEOUT", "UNSUPPORTED_RESPONSE",
                "FILING_FORM_MISSING", "FILING_CONTROL_INVALID", "FILING_CONTROL_AMBIGUOUS",
                "FILING_WIDGET_LIMIT", "FILING_FORM_ELEMENT_LIMIT", "FILING_OPTION_LIMIT",
                "FILING_ARIA_REFERENCE_LIMIT", "FILING_GROUP_REFERENCE_LIMIT", "FILING_OFFICE_CODE_LIMIT",
                "FILING_MODE_NOT_ESTABLISHED", "FILING_ADVANCED_NOT_ESTABLISHED", "FILING_COUNTY_NOT_ESTABLISHED", "FILING_UNEXPECTED_LOCAL_REQUEST",
                "COVERAGE_FORM_MISSING", "COVERAGE_CONTROL_INVALID",
                "COVERAGE_CONTROL_AMBIGUOUS", "COVERAGE_UNEXPECTED_LOCAL_REQUEST",
                "COURTROOM_OBSERVATION_FORM_MISSING", "COURTROOM_OBSERVATION_LIMIT",
                "INSPECTION_METADATA_INVALID", "INSPECTION_BODY_UNSUPPORTED",
                "INSPECTION_UNEXPECTED_LOCAL_REQUEST", "INSPECTION_PUBLIC_STATE_MISMATCH",
                "SOURCE_FORM_VALIDATION", "RESULTS_NOT_VALIDATED",
                "CALENDAR_RESULT_LOAD_TIMEOUT",
                "CRITERIA_NOT_AVAILABLE_ON_SOURCE",
                "CALENDAR_REQUIRED_RESOURCE_BLOCKED", "CALENDAR_REQUIRED_ASSET_MISSING",
                "CALENDAR_SCRIPT_ERROR", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                "CALENDAR_CONSOLE_ERROR",
                "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE",
                "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE",
                "CALENDAR_CONTROL_STATE_MISMATCH", "CALENDAR_SUBMITTED_VALUES_MISMATCH",
                "CALENDAR_FORM_MISSING", "UNSUPPORTED_CALENDAR_FORM_TARGET",
                "CALENDAR_PREFLIGHT_FAILED",
                "CALENDAR_FORM_STRUCTURE_CHANGED",
                "CALENDAR_FORM_INITIALIZATION_TIMEOUT",
                "SUBMISSION_NOT_OBSERVED", "UNEXPECTED_RESPONSE",
                "CALENDAR_DOCUMENT_LINK_MISSING", "UNSUPPORTED_CALENDAR_LAYOUT",
                "CALENDAR_IDENTITY_OR_COVERAGE_CONFLICT", "UNSUPPORTED_EVENT_DATE_LAYOUT",
                "CALENDAR_EVENT_DATE_OUTSIDE_REQUESTED_WINDOW",
            } else "UNEXPECTED_RESPONSE")
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    _config = json.loads(sys.stdin.readline())
    try:
        if _config.get("inspectionOnly") is True:
            asyncio.run(asyncio.wait_for(main(_config), timeout=600))
        else:
            asyncio.run(main(_config))
    except asyncio.TimeoutError:
        # A timed-out inspection is a failed, consumed one-use stage.
        sys.exit(124)
