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
from urllib.parse import urlsplit, parse_qs, parse_qsl

from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout
from evidence import CalendarResults, DOCKET, calendar_result_state, extract_bail
from public_http import download
from optional_resources import IMAGE, FONT
from source_protocol import allowed, classify_response, CALENDAR_ASSETS
from calendar_protocol import response_pause, validate_calendar_form, submit_calendar_search, calendar_asset_barrier, fill_calendar_dates, expected_optional_console_error, CalendarFormFailure, select_calendar_preview_controls, calendar_form_field_count, calendar_form_field_shape, wait_for_calendar_search_button, calendar_search_button_visible, validate_unfiltered_calendar_room
from inspection_safety import (
    InspectionBrokerResponse, InspectionRequestGate, InspectionRequestRouter,
    read_inspection_protocol_line,
)
from network_sandbox import require_default_deny_active, verify_inspection_runtime


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


def submitted_calendar_payload_matches(request, expected_fields):
    """Compare only approved public filters; never retain or emit the POST body."""
    try:
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        body = request.post_data
        if (content_type != "application/x-www-form-urlencoded"
                or not isinstance(body, str) or len(body) > 1_000_000
                or not expected_fields or len(expected_fields) > 8):
            return False
        pairs = parse_qsl(body, keep_blank_values=True, max_num_fields=128, errors="strict")
        return all([value for field, value in pairs if field == name] == [expected]
                   for name, expected in expected_fields)
    except Exception:
        return False


def valid_bounded_engine_scope(criteria):
    request_cap = criteria.get("requestCap")
    return (
        criteria.get("courtOffice") == "CP-05-02-Crim"
        and criteria.get("eventType") == "Bail Hearing"
        and criteria.get("courtRoom") == "Courtroom 506"
        and type(request_cap) is int and 8 <= request_cap <= 12
        and criteria.get("recordCap") == 5
        and criteria.get("calendarPreviewOnly") is not True
    )


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
    bounded_engine_observation = config.get("boundedEngineObservation") is True
    if courtroom_observation_only and (
            config.get("coverageOnly") is not True
            or criteria.get("courtOffice") != "CP-05-02-Crim"
            or criteria.get("eventType") != "Bail Hearing"
            or criteria.get("courtRoom") != "Courtroom 506"
            or criteria.get("requestCap") != 3 or criteria.get("recordCap") != 1):
        emit("barrier", code="COURTROOM_OBSERVATION_SCOPE_INVALID")
        return
    if bounded_engine_observation and not valid_bounded_engine_scope(criteria):
        emit("barrier", code="BOUNDED_ENGINE_SCOPE_INVALID")
        return
    courtroom_observer = None
    if courtroom_observation_only or bounded_engine_observation:
        # A packaging failure must be discovered before any source request.
        try:
            from courtroom_observation import observe as courtroom_observer
        except ImportError:
            emit("barrier", code="COURTROOM_OBSERVATION_UNAVAILABLE")
            return
    lock = asyncio.Lock()
    stopped = False
    requests = 0
    bounded_observation_complete = False
    bounded_observation_limit_hit = False
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
    calendar_search_request_started = False
    calendar_search_request_start_state = None
    calendar_search_request_start_order = None
    calendar_post_attempt_started = False
    calendar_post_attempt_order = None
    calendar_response_acknowledged = False
    calendar_response_acknowledged_order = None
    calendar_browser_fulfilled = False
    calendar_browser_fulfilled_order = None
    calendar_read_only_inspection = False
    calendar_read_only_inspection_order = None
    submission_armed = False
    source_stop_state = None
    response_recorder = None
    calendar_lifecycle = None
    if not (inspection_only or config.get("coverageOnly") or config.get("filingInspectionOnly")):
        from calendar_diagnostics import (
            CalendarDiagnosticRecorder, CalendarLifecycle, RESPONSE_STRUCTURE, parser_outcome,
        )
        response_recorder = CalendarDiagnosticRecorder()
        calendar_lifecycle = CalendarLifecycle()
    response_structure = None
    response_inspection_status = "NOT_SAFE"
    response_inspection_attempted = False
    response_parser_attempted = False
    response_parser_outcome = "NOT_RUN"
    calendar_explicit_empty = False
    response_result_validation = {
        "outcome": "NOT_RUN", "observedRows": 0, "validatedRows": 0,
        "validatedDockets": 0, "documentLinks": "NOT_CHECKED",
        "scope": "NOT_CHECKED", "dates": "NOT_CHECKED",
        "explicitEmptyResult": "NOT_CAPTURED",
    }
    calendar_has_remote_pagination = False
    calendar_validated_headers = None
    criteria_validation = "NOT_VERIFIED"
    response_diagnostic_emitted = False
    expected_calendar_post_fields = None
    submission_payload_rejected = False
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
            nonlocal bounded_observation_complete, bounded_observation_limit_hit
            nonlocal calendar_post_observed, calendar_post_completed, source_stop_state
            nonlocal calendar_post_attempt_started, calendar_post_attempt_order
            nonlocal calendar_response_acknowledged, calendar_response_acknowledged_order

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
                if bounded_engine_observation and not bounded_observation_complete and requests >= 3:
                    bounded_observation_limit_hit = True
                    raise SourceFailure("COURTROOM_OBSERVATION_REQUEST_LIMIT")
                clock = asyncio.get_running_loop()
                # The persisted parent scheduler grants each transmission only
                # after operation-specific pacing, shared quotas and cooldowns.
                # No second hidden 60–90s per-resource application floor.
                pause = 0
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
                    calendar_post_attempt_started = True
                    if calendar_lifecycle:
                        calendar_lifecycle.advance("POST_ATTEMPT_IN_PROGRESS")
                        calendar_post_attempt_order = calendar_lifecycle.event_order()
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
                        pdf=urlsplit(url).path in ("/Report/CpDocketSheet", "/Report/MdjDocketSheet"),
                        path=urlsplit(url).path,
                    )
                    if outcome != "OK":
                        source_stop_state = outcome
                        if response_recorder:
                            response_recorder.resource_failure(url, resource_type, blocked_optional_urls,
                                diagnostic_phase, key=tracked_key, status=response.status,
                                event_state=calendar_lifecycle.state,
                                event_order=calendar_lifecycle.event_order(),
                                request_start_state=calendar_lifecycle.request_start(tracked_key)[0],
                                request_start_order=calendar_lifecycle.request_start(tracked_key)[1])
                    emit("response", requestId=permission["requestId"], status=response.status,
                         outcome=outcome, retryAfter=response.headers.get("retry-after"))
                    acknowledgement = json.loads(await read_protocol_line())
                    if method == "POST" and urlsplit(url).path == "/CaseSearch":
                        calendar_response_acknowledged = True
                        if calendar_lifecycle:
                            calendar_lifecycle.advance("RESPONSE_ACKNOWLEDGED")
                            calendar_response_acknowledged_order = calendar_lifecycle.event_order()
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
                                diagnostic_phase, key=tracked_key,
                                text="ERR_TIMED_OUT" if outcome == "TIMEOUT" else None,
                                event_state=calendar_lifecycle.state,
                                event_order=calendar_lifecycle.event_order(),
                                request_start_state=calendar_lifecycle.request_start(tracked_key)[0],
                                request_start_order=calendar_lifecycle.request_start(tracked_key)[1])
                        source_stop_state = outcome
                        emit("response", requestId=permission["requestId"], status=None,
                             outcome=outcome,
                             retryAfter=None)
                        await read_protocol_line()
                        if method == "POST" and urlsplit(url).path == "/CaseSearch":
                            calendar_response_acknowledged = True
                            if calendar_lifecycle:
                                calendar_lifecycle.advance("RESPONSE_ACKNOWLEDGED")
                                calendar_response_acknowledged_order = calendar_lifecycle.event_order()
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
            nonlocal bounded_observation_limit_hit
            nonlocal cached_responses, blocked_during_inspection
            nonlocal criteria_validation, submission_payload_rejected
            nonlocal calendar_browser_fulfilled, calendar_browser_fulfilled_order
            request = route.request
            if response_recorder:
                response_recorder.register(request, request.url, request.resource_type, diagnostic_phase)
            if request.resource_type in ("image", "font"):
                # Fulfil EVERY optional image/font locally, in every phase.
                # A valid font is required: an empty body creates OTS/console
                # errors. No network reservation, transport or error exemption.
                if response_recorder:
                    response_recorder.decide(request, "CACHE")
                await route.fulfill(status=200,
                    content_type="image/svg+xml" if request.resource_type == "image" else "font/ttf",
                    headers={"Access-Control-Allow-Origin": "*"},
                    body=IMAGE if request.resource_type == "image" else FONT)
                return
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
                    or calendar_preview_only and urlsplit(request.url).path in ("/Report/CpDocketSheet", "/Report/MdjDocketSheet")
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
                if response_recorder:
                    submission_payload_rejected = True
                    criteria_validation = "NOT_VERIFIED"
                blocked += 1
                blocked_requests += 1
                if response_recorder:
                    response_recorder.decide(request, "POLICY_ABORT")
                await route.fulfill(status=400, content_type="text/plain", body="")
                return
            if (response_recorder and request.method == "POST"
                    and urlsplit(request.url).path == "/CaseSearch"):
                if not submitted_calendar_payload_matches(request, expected_calendar_post_fields):
                    submission_payload_rejected = True
                    criteria_validation = "NOT_VERIFIED"
                    blocked += 1
                    blocked_requests += 1
                    response_recorder.decide(request, "POLICY_ABORT")
                    await route.abort()
                    return
                criteria_validation = "INTERCEPTED_POST_BODY_MATCHED"
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
                if (request.method == "POST" and urlsplit(request.url).path == "/CaseSearch"
                        and calendar_lifecycle):
                    calendar_browser_fulfilled = True
                    calendar_lifecycle.advance("BROWSER_FULFILLED")
                    calendar_browser_fulfilled_order = calendar_lifecycle.event_order()
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
            except Exception as error:
                if (bounded_engine_observation and not bounded_observation_complete
                        and isinstance(error, SourceFailure)
                        and error.outcome == "COURTROOM_OBSERVATION_REQUEST_LIMIT"):
                    bounded_observation_limit_hit = True
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

        def stop_if_observation_budget_exhausted():
            if bounded_observation_limit_hit:
                emit("bounded_engine_stopped", code="COURTROOM_OBSERVATION_REQUEST_LIMIT")
                return True
            return False

        def note_request_started(request):
            nonlocal calendar_search_request_started
            nonlocal calendar_search_request_start_state, calendar_search_request_start_order
            request_start_state = "UNAVAILABLE"
            request_start_order = None
            if calendar_lifecycle:
                request_start_state, request_start_order = calendar_lifecycle.request_started(request)
            if response_recorder:
                response_recorder.register(request, request.url, request.resource_type, diagnostic_phase)
            if request.method == "POST" and urlsplit(request.url).path == "/CaseSearch":
                calendar_search_request_started = True
                calendar_search_request_start_state = request_start_state
                calendar_search_request_start_order = request_start_order

        def note_page_error(_error):
            nonlocal page_errors, post_response_read_only
            page_errors = min(10_000, page_errors + 1)  # Never log source messages.
            if response_recorder:
                response_recorder.exception(
                    diagnostic_phase, event_state=calendar_lifecycle.state,
                    event_order=calendar_lifecycle.event_order())
                post_response_read_only = True
                response_recorder.mark("READ_ONLY")

        def note_console(message):
            nonlocal console_errors, optional_console_errors, post_response_read_only
            if message.type == "error":
                event_state = calendar_lifecycle.state if calendar_lifecycle else "BEFORE_POST_ATTEMPT"
                optional = (response_recorder.console(message.type, message.text,
                    message.location.get("url"), blocked_optional_urls, diagnostic_phase,
                    event_state=event_state,
                    event_order=calendar_lifecycle.event_order() if calendar_lifecycle else None)
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

        observed_pages = set()

        def observe_page(target):
            key = id(target)
            if key in observed_pages:
                return
            observed_pages.add(key)
            target.on("pageerror", note_page_error)
            target.on("console", note_console)
            if response_recorder:
                target.on("request", note_request_started)

                def note_request_failed(request):
                    request_start_state, request_start_order = calendar_lifecycle.request_start(request)
                    response_recorder.resource_failure(
                        request.url, request.resource_type, blocked_optional_urls, diagnostic_phase,
                        key=request, text=request.failure, event_state=calendar_lifecycle.state,
                        event_order=calendar_lifecycle.event_order(),
                        request_start_state=request_start_state,
                        request_start_order=request_start_order)

                target.on("requestfailed", note_request_failed)

        observe_page(page)
        context.on("page", observe_page)

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
            nonlocal calendar_read_only_inspection, calendar_read_only_inspection_order
            if not response_recorder or response_inspection_attempted:
                return
            response_inspection_attempted = True
            # All subsequent browser retrieval is local or aborted. PDFs use
            # the separately authorized sequential path only after validation.
            post_response_read_only = True
            if calendar_search_request_started and calendar_post_observed:
                calendar_read_only_inspection = True
                calendar_lifecycle.advance("READ_ONLY_INSPECTION")
                calendar_read_only_inspection_order = calendar_lifecycle.event_order()
            response_recorder.mark("READ_ONLY")
            if not calendar_post_observed or not calendar_post_completed or lock.locked():
                return
            try:
                response_recorder.mark("INSPECTION")
                response_structure = await asyncio.wait_for(page.evaluate(RESPONSE_STRUCTURE), timeout=1.5)
                response_inspection_status = "OBSERVED"
                await asyncio.sleep(0)
            except Exception:
                response_inspection_status = "UNAVAILABLE"
                response_structure = None

        async def validate_loaded_response():
            nonlocal response_parser_attempted, response_parser_outcome, response_result_validation
            nonlocal items, calendar_has_remote_pagination, calendar_validated_headers
            nonlocal calendar_explicit_empty
            if (not response_recorder or response_parser_attempted
                    or not calendar_post_observed or not calendar_post_completed
                    or response_inspection_status != "OBSERVED"
                    or response_structure["countsCapped"] or response_recorder.overflow):
                return
            response_parser_attempted = True
            response_recorder.mark("PARSER_STARTED")
            parser = CalendarResults()
            try:
                markup = await page.content()
                if len(markup) > 4_000_000:
                    raise ValueError("CALENDAR_RESPONSE_LIMIT")
                parser.feed(markup)
                if len(parser.rows) != response_structure["dataRowCount"]:
                    raise ValueError("CALENDAR_STRUCTURE_MISMATCH")
                parsed_items = parser.validated(criteria)
            except Exception as error:
                response_parser_outcome = parser_outcome(error)
                response_result_validation = {
                    "outcome": response_parser_outcome,
                    "observedRows": response_structure["dataRowCount"],
                    "validatedRows": 0, "validatedDockets": 0,
                    "documentLinks": "REJECTED", "scope": "REJECTED",
                    "dates": "REJECTED", "explicitEmptyResult": "NOT_CAPTURED",
                }
                response_recorder.mark("PARSER_REJECTED")
                items = []
            else:
                calendar_explicit_empty = parser.explicit_empty_state
                response_parser_outcome = (
                    "CANDIDATE_NONEMPTY" if parsed_items
                    else "EXPLICIT_EMPTY_RESULT" if calendar_explicit_empty
                    else "NO_EMPTY_PROOF"
                )
                response_result_validation = {
                    "outcome": "VALIDATED_NONEMPTY" if parsed_items
                    else "VALIDATED_EMPTY" if calendar_explicit_empty else "EMPTY_NOT_PROVEN",
                    "observedRows": response_structure["dataRowCount"],
                    "validatedRows": parser.validated_row_count,
                    "validatedDockets": len(parsed_items),
                    "documentLinks": "ALL_VALID" if parsed_items else "NO_ROWS",
                    "scope": "ALL_ROWS_MATCH" if parser.scope_validated else "NO_ROWS",
                    "dates": "ALL_WITHIN_REQUEST" if parser.dates_validated else "NO_ROWS",
                    "explicitEmptyResult": "SOURCE_STATUS_MARKER" if calendar_explicit_empty else "NOT_CAPTURED",
                }
                if parsed_items or calendar_explicit_empty:
                    response_recorder.mark("PARSER_ACCEPTED")
                else:
                    response_recorder.mark("PARSER_REJECTED")
                calendar_has_remote_pagination = parser.has_remote_pagination
                calendar_validated_headers = parser.validated_column_headers
                items = parsed_items
            finally:
                emit("calendar_layout", **{
                    key: value for key, value in parser.contract_observation().items() if key != "kind"
                })
                # Do not retain response markup, row cells, links, docket IDs,
                # or URLs in the diagnostic path.
                parser.rows.clear()
                parser.headers.clear()
                del parser

        def response_transport_status():
            if stopped or not calendar_post_completed:
                return "SOURCE_STOPPED" if stopped else "RESPONSE_INCOMPLETE"
            if response_recorder and response_recorder.overflow:
                return "DIAGNOSTIC_OVERFLOW"
            if blocked_scripts or blocked_stylesheets or blocked_requests:
                return "REQUIRED_RESOURCE_FAILURE"
            if not set(CALENDAR_ASSETS).issubset(loaded_assets):
                return "REQUIRED_ASSET_MISSING"
            if response_recorder and response_recorder.blocking_resource_failure:
                return "UNCLASSIFIED_REQUEST_FAILURE"
            return "COMPLETE"

        def response_console_status():
            runtime = page_errors > 0
            other = console_errors > 0
            if runtime and other:
                return "MIXED"
            if runtime:
                return "RUNTIME_EXCEPTIONS"
            if other:
                return "UNCLASSIFIED_CONSOLE_ERRORS"
            if optional_console_errors:
                return "PROVEN_OPTIONAL_ONLY"
            return "CLEAN"

        def response_eligibility(transport, console):
            if (response_recorder and response_recorder.overflow
                    or response_inspection_status != "OBSERVED"
                    or response_structure and response_structure.get("countsCapped")):
                return "BLOCKED_INTEGRITY"
            if criteria_validation != "INTERCEPTED_POST_BODY_MATCHED":
                return "BLOCKED_CRITERIA"
            if transport != "COMPLETE":
                return "BLOCKED_TRANSPORT"
            if console in ("UNCLASSIFIED_CONSOLE_ERRORS", "RUNTIME_EXCEPTIONS", "MIXED"):
                return "BLOCKED_CONSOLE"
            if response_result_validation["outcome"] == "VALIDATED_EMPTY":
                return "VALIDATED_EMPTY"
            if response_result_validation["outcome"] != "VALIDATED_NONEMPTY":
                return "BLOCKED_RESULT"
            return "ELIGIBLE"

        def response_diagnostic():
            nonlocal response_diagnostic_emitted
            if not response_recorder or not (calendar_search_request_started or response_recorder.groups):
                return
            if response_diagnostic_emitted:
                return
            gate = ("SOURCE_STOPPED" if stopped else calendar_asset_barrier(
                loaded_assets, blocked_scripts, blocked_stylesheets, blocked_requests, page_errors, console_errors))
            if not gate and response_recorder.blocking_resource_failure:
                gate = "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"
            if not gate and (response_inspection_status != "OBSERVED"
                             or response_structure["countsCapped"] or response_recorder.overflow):
                gate = "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE"
            transport = response_transport_status()
            console = response_console_status()
            eligibility = response_eligibility(transport, console)
            emit("calendar_response_diagnostic", version=4, phase="RESULT",
                 submissionObserved=calendar_post_observed, responseCompleted=calendar_post_completed,
                 inspectionStatus=response_inspection_status, structure=response_structure,
                 parserAttempted=response_parser_attempted, parserOutcome=response_parser_outcome,
                 criteriaValidation=criteria_validation,
                 transportIntegrity={"status": transport,
                     "requiredAssetsLoaded": set(CALENDAR_ASSETS).issubset(loaded_assets),
                     "requestFailureObserved": bool(response_recorder.blocking_resource_failure),
                     "blockedDuringInspection": blocked_during_inspection},
                 consoleDiagnostics={"status": console, "consoleErrors": console_errors,
                     "runtimeExceptions": page_errors, "provenOptionalErrors": optional_console_errors},
                 resultValidation=response_result_validation,
                 documentEligibility=eligibility,
                 stopGate=gate or "NONE", classifications=response_recorder.snapshot(),
                 classificationOverflow=response_recorder.overflow, blockedDuringInspection=blocked_during_inspection,
                  eventSequence=response_recorder.sequence, milestones=response_recorder.milestones,
                  lifecycle={
                      "browserRequestStarted": calendar_search_request_started,
                      "browserRequestStartState": calendar_search_request_start_state,
                      "browserRequestStartOrder": calendar_search_request_start_order,
                      "postAttemptStarted": calendar_post_attempt_started,
                      "postAttemptOrder": calendar_post_attempt_order,
                      "responseAcknowledged": calendar_response_acknowledged,
                      "responseAcknowledgedOrder": calendar_response_acknowledged_order,
                      "browserFulfilled": calendar_browser_fulfilled,
                      "browserFulfilledOrder": calendar_browser_fulfilled_order,
                      "readOnlyInspection": calendar_read_only_inspection,
                      "readOnlyInspectionOrder": calendar_read_only_inspection_order,
                      "orderOverflow": calendar_lifecycle.order_overflow,
                  })
            response_diagnostic_emitted = True

        try:
            items = config["pendingItems"]
            if not config["calendarComplete"]:
                goto_timeout = 600_000
                if inspection_only:
                    goto_timeout = min(goto_timeout, inspection_gate.remaining_timeout_ms())
                    if goto_timeout <= 0:
                        raise RuntimeError("INSPECTION_SESSION_DEADLINE")
                await page.goto("https://ujsportal.pacourts.us/CaseSearch", wait_until="load", timeout=goto_timeout)
                if stop_if_observation_budget_exhausted():
                    return
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
                    preview_values = (await select_calendar_preview_controls(page, criteria)
                                      if config.get("ordinaryCalendar") else
                                      await select_bound_calendar_controls(page, criteria))
                    if stop_if_observation_budget_exhausted():
                        return
                if not inspection_only and not criteria.get("courtRoom"):
                    await validate_unfiltered_calendar_room(page)
                    preview_values["courtRoom"] = ""
                form_phase = "DATE_ENTRY"
                await fill_calendar_dates(page, criteria)
                if stop_if_observation_budget_exhausted():
                    return
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
                expected_calendar_post_fields = (await validate_calendar_form(page, criteria, preview_values)
                    if config.get("ordinaryCalendar") else
                    await validate_bound_calendar_form(page, criteria, preview_values))
                if stop_if_observation_budget_exhausted():
                    return
                if bounded_engine_observation:
                    observation = await courtroom_observer(
                        page, emit, criteria, lambda: inspection_error is None, controls_prevalidated=True)
                    if observation.get("outcome") != "BOUND_506":
                        emit("bounded_engine_stopped", code="COURTROOM_BINDING_NOT_ESTABLISHED")
                        return
                    if requests > 3:
                        emit("bounded_engine_stopped", code="COURTROOM_OBSERVATION_REQUEST_LIMIT")
                        return
                    bounded_observation_complete = True
                criteria_validation = "PRE_SUBMISSION_FORMDATA_MATCHED"
                calendar_preflight("READY")
                emit("calendar_state", state="FORM_READY", formVisible=await page.locator("#btnSearch").is_visible())
                diagnostic_phase = "RESULT"
                form_phase = "SUBMISSION"
                submission_armed = True
                response_recorder.mark("SEARCH_ARMED")
                await submit_calendar_search(page)
                await inspect_loaded_response()
                await validate_loaded_response()
                if not calendar_post_observed:
                    raise RuntimeError("SUBMISSION_NOT_OBSERVED")
                if not calendar_post_completed:
                    raise RuntimeError("UNEXPECTED_RESPONSE")
                response_diagnostic()
                eligibility = response_eligibility(
                    response_transport_status(), response_console_status())
                if eligibility not in ("ELIGIBLE", "VALIDATED_EMPTY"):
                    emit("calendar_state", state="RESULTS_NOT_VALIDATED",
                         formVisible=await calendar_search_button_visible(page))
                    items = []
                    raise RuntimeError({
                        "BLOCKED_INTEGRITY": "CALENDAR_RESPONSE_DIAGNOSTIC_UNAVAILABLE",
                        "BLOCKED_CRITERIA": "CALENDAR_SUBMITTED_VALUES_MISMATCH",
                        "BLOCKED_TRANSPORT": (
                            "CALENDAR_UNCLASSIFIED_RESOURCE_FAILURE"
                            if response_transport_status() == "UNCLASSIFIED_REQUEST_FAILURE"
                            else "CALENDAR_REQUIRED_RESOURCE_BLOCKED"),
                        "BLOCKED_CONSOLE": "CALENDAR_CONSOLE_ERROR",
                        "BLOCKED_RESULT": (
                            response_parser_outcome if response_parser_outcome not in
                            ("CANDIDATE_NONEMPTY", "EXPLICIT_EMPTY_RESULT", "NO_EMPTY_PROOF", "NOT_RUN")
                            else "RESULTS_NOT_VALIDATED"),
                    }[eligibility])
                state = calendar_result_state(
                    response_structure["resultTableCount"] == 1,
                    items or [], explicit_empty_state=calendar_explicit_empty)
                emit("calendar_state", state=state,
                     formVisible=await page.locator("#btnSearch").is_visible())
                if state not in ("RESULTS_VALIDATED", "EMPTY_RESULTS_VALIDATED"):
                    raise RuntimeError("RESULTS_NOT_VALIDATED")
                response_diagnostic()
                # No automatic remote page traversal: disclose incomplete coverage.
                emit("calendar", rows=items, retrievedAt=calendar_time,
                     paginationComplete=not calendar_has_remote_pagination and len(items) < 500,
                     resultCapReached=len(items) >= 500, blockedAssets=blocked,
                     **({"columnHeaders": calendar_validated_headers}
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
            if (bounded_engine_observation and isinstance(error, SourceFailure)
                    and error.outcome == "COURTROOM_OBSERVATION_REQUEST_LIMIT"):
                emit("bounded_engine_stopped", code="COURTROOM_OBSERVATION_REQUEST_LIMIT")
                return
            if response_recorder and (calendar_search_request_started or response_recorder.groups):
                if calendar_post_observed:
                    await inspect_loaded_response()
                await validate_loaded_response()
                response_diagnostic()
            calendar_diagnostics(diagnostic_phase)
            if isinstance(error, CalendarFormFailure):
                for failure in error.failures:
                    emit("calendar_form_diagnostic", **failure, phase=form_phase)
            if submission_payload_rejected:
                emit("calendar_form_diagnostic", code="CALENDAR_SUBMITTED_VALUES_MISMATCH",
                     control="FORM", reason="SUBMITTED_VALUE_MISMATCH", phase="SUBMISSION")
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
            safe_code = ("CALENDAR_SUBMITTED_VALUES_MISMATCH" if submission_payload_rejected
                         else "CALENDAR_RESULT_LOAD_TIMEOUT"
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
