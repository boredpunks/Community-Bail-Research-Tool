import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
CHROMIUM = shutil.which("chromium")


def search(search_id, status, start_date, progress, results, updated_at,
           recovery_action=None, recovery_message=None, available_at=None):
    action = recovery_action or ("resume" if status == "paused" else "none")
    return {
        "searchId": search_id,
        "status": status,
        "criteria": {
            "startDate": start_date,
            "endDate": start_date,
            "maxBail": 2000,
            "source": "live",
            "courtOffice": "ANY",
            "eventType": "Bail Hearing",
        },
        "progress": progress,
        "incomplete": False,
        "reason": None,
        "resumeToken": "test-resume-token" if action in ("resume", "wait") else None,
        "resumeAvailableAt": available_at,
        "recovery": {
            "action": action,
            "message": recovery_message or ("Docket PDF processing stopped. Cause unknown from retained evidence. The search is incomplete. 2 docket rows from the validated calendar are retained. Next: Resume this same search." if status == "paused" else ""),
            "availableAt": available_at,
        },
        "canManage": True,
        "results": results,
        "createdAt": "2026-11-01T12:00:00.000Z",
        "updatedAt": updated_at,
        "sourceNotice": "Test fixture; no court source is contacted.",
        "stage": "checking_documents" if status in ("running", "paused") else "complete",
    }


def progress(**overrides):
    values = {
        "completed": 1,
        "total": 1,
        "pending": 0,
        "calendarValidated": True,
        "calendarCoverage": {
            "segmentsChecked": 1,
            "segmentsTotal": 1,
            "rowsObserved": 1,
            "rowsRetained": 1,
            "rowsExcluded": 0,
            "partial": False,
        },
        "documentsDiscovered": 1,
        "documentRequestsAttempted": 1,
        "documentsRetrieved": 1,
        "documentsProcessed": 1,
        "documentsWithEvidence": 1,
        "sourceRequestsUsed": 2,
        "sourceRequestLimit": 10,
        "localOcr": None,
        "timeline": [{
            "id": "request-calendar", "at": "2026-11-01T12:00:30.000Z",
            "label": "POST · Submitting the court calendar search",
            "detail": "Path /CaseSearch · HTTP 200 · source outcome OK",
            "status": "completed", "durationMs": 1_250,
        }],
    }
    values.update(overrides)
    return values


def result(row_id, docket_number, quote, status="EXTRACTED"):
    return {
        "id": row_id,
        "docket_number": docket_number,
        "hearing_date": "2026-11-01",
        "decision_date": None,
        "office": "CP-05-02-Crim",
        "bail_amount": 1500 if quote and status == "EXTRACTED" else None,
        "percentage": None,
        "classification": "monetary",
        "evidence_page": 2 if quote else None,
        "evidence_quote": quote,
        "evidence_acquisition": "STORED_EXTRACTION" if quote else "NOT_RETRIEVED",
        "document_status": status,
        "qualifies": bool(quote),
        "ambiguous": status == "AMBIGUOUS",
        "error": None,
        "source_url": "https://example.test/docket.pdf" if quote else None,
        "source_retrieved_at": None,
        "source_consulted_at": None,
        "source_pdf_sha256": None,
    }


def main():
    if not CHROMIUM:
        raise RuntimeError("Chromium is required for this browser regression test.")

    date = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    older = search(
        "older-search",
        "complete",
        date,
        progress(),
        [result("older-row", "OLD-2026-0001", "Bail is set at $1,500.")],
        "2026-11-01T12:00:00.000Z",
    )
    newer = search(
        "newer-search",
        "paused",
        date,
        progress(
            completed=0,
            total=2,
            pending=2,
            documentsDiscovered=2,
            documentsRetrieved=0,
            documentsProcessed=0,
            documentsWithEvidence=0,
            sourceRequestsUsed=3,
            calendarCoverage={
                "segmentsChecked": 1,
                "segmentsTotal": None,
                "rowsObserved": 3,
                "rowsRetained": 2,
                "rowsExcluded": 1,
                "partial": True,
            },
        ),
        [
            result("pending-row-1", "CP-2026-0001", "", status="NOT_REQUESTED"),
            result("pending-row-2", "CP-2026-0002", "", status="NOT_REQUESTED"),
        ],
        "2026-11-01T12:01:00.000Z",
    )
    resumed = {**newer, "status": "running", "resumeToken": None, "recovery": {
        "action": "none", "message": "", "availableAt": None,
    }}

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = os.environ.copy()
    env.update({"PORT": str(port), "BASE_PATH": "/"})
    server = subprocess.Popen(
        ["pnpm", "--filter", "@workspace/community-bail-research", "run", "dev"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base_url = f"http://127.0.0.1:{port}"

    def server_ready():
        try:
            with urllib.request.urlopen(base_url, timeout=1):
                return True
        except (urllib.error.URLError, TimeoutError):
            return False

    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline and server.poll() is None:
            if server_ready():
                break
            time.sleep(0.25)
        else:
            output = server.stdout.read() if server.stdout else ""
            raise RuntimeError(f"Vite did not start for the browser test.\n{output}")

        started = {"value": False, "body": None, "post_count": 0, "resume_body": None,
                   "next_post_response": None}
        latest_search = {"value": newer}
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=CHROMIUM,
                args=["--no-sandbox"],
            )
            page = browser.new_page()

            def mock_api(route):
                request = route.request
                path = request.url.split("?", 1)[0]
                if path.endswith("/api/workspace-access/session"):
                    body = {"authenticated": True}
                elif path.endswith("/api/bail-search/search") and request.method == "GET":
                    body = [latest_search["value"], older] if started["value"] else [older]
                elif path.endswith("/api/bail-search/search") and request.method == "POST":
                    started["post_count"] += 1
                    if started["next_post_response"] is not None:
                        started["body"] = request.post_data_json
                        latest_search["value"] = started["next_post_response"]
                        started["value"] = True
                        body = started["next_post_response"]
                        started["next_post_response"] = None
                    elif started["post_count"] == 1:
                        started["body"] = request.post_data_json
                        started["value"] = True
                        body = latest_search["value"]
                    else:
                        route.fulfill(
                            status=503,
                            content_type="application/json",
                            body='{"message":"Test start failure"}',
                        )
                        return
                elif path.endswith("/api/bail-search/search/older-search/status"):
                    body = older
                elif path.endswith("/api/bail-search/search/newer-search/resume") and request.method == "POST":
                    started["resume_body"] = request.post_data_json
                    latest_search["value"] = resumed
                    body = resumed
                elif path.endswith("/api/bail-search/search/newer-search/status"):
                    body = latest_search["value"]
                elif path.endswith("/api/bail-search/search/successful-search/status"):
                    body = latest_search["value"]
                else:
                    route.fulfill(status=404, content_type="application/json", body='{"error":"Unexpected test request"}')
                    return
                route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

            page.route("**/api/**", mock_api)
            page.goto(f"{base_url}/search", wait_until="domcontentloaded")
            page.get_by_test_id("text-search-evidence-older-row").wait_for()
            assert page.get_by_test_id("text-search-evidence-older-row").inner_text() == "Bail is set at $1,500."

            page.get_by_test_id("input-search-start-date").fill(date)
            page.get_by_test_id("input-search-end-date").fill(date)
            page.get_by_test_id("button-start-bail-search").click()

            progress_panel = page.get_by_test_id("panel-search-progress")
            progress_panel.wait_for()
            assert "Checking docket documents" in progress_panel.inner_text()
            assert "0 of 2 dockets processed; 2 remain." in progress_panel.inner_text()
            assert "1 checked; total unknown" in page.get_by_test_id("text-calendar-coverage").inner_text()
            assert "3 observed · 2 retained · 1 excluded by validation" in page.get_by_test_id("text-calendar-coverage").inner_text()
            assert "Unchecked calendar dates have not been confirmed to have no cases." in page.get_by_test_id("text-calendar-partial-coverage").inner_text()
            activity = page.get_by_test_id("list-search-activity").inner_text()
            assert "Submitting the court calendar search" in activity
            assert "Path /CaseSearch · HTTP 200 · source outcome OK" in activity
            assert "Completed · 2s" in activity
            assert page.get_by_test_id("select-search-history").input_value() == "newer-search"
            assert "Paused" in page.get_by_test_id("status-search").inner_text()
            assert page.get_by_test_id("button-resume-search").is_enabled()
            assert page.get_by_test_id("row-search-pending-row-1").count() == 1
            assert page.get_by_test_id("row-search-pending-row-2").count() == 1
            assert page.get_by_test_id("status-search-evidence-pending-row-1").inner_text() == "Not requested — calendar row only"
            assert "$0.00" not in page.get_by_test_id("table-search-rows").inner_text()
            options = page.get_by_test_id("select-search-history").locator("option")
            assert options.count() == 2
            assert [options.nth(index).get_attribute("value") for index in range(2)] == [
                "newer-search",
                "older-search",
            ]
            assert started["body"]["startDate"] == date
            assert started["body"]["endDate"] == date
            assert started["body"]["source"] == "live"

            page.reload(wait_until="domcontentloaded")
            page.get_by_test_id("panel-search-progress").wait_for()
            assert page.get_by_test_id("select-search-history").input_value() == "newer-search"
            assert "Paused" in page.get_by_test_id("status-search").inner_text()
            assert page.get_by_test_id("button-resume-search").is_visible()
            assert page.get_by_test_id("button-resume-search").is_enabled()
            assert page.get_by_test_id("row-search-older-row").count() == 0

            page.get_by_test_id("select-search-history").select_option("older-search")
            assert page.get_by_test_id("text-search-evidence-older-row").inner_text() == "Bail is set at $1,500."
            assert page.get_by_test_id("panel-search-progress").count() == 0
            assert page.get_by_test_id("text-recovery-message").count() == 0
            page.get_by_test_id("select-search-history").select_option("newer-search")
            page.get_by_test_id("button-resume-search").click()
            assert started["resume_body"] == {"resumeToken": "test-resume-token"}
            page.wait_for_function(
                "() => document.querySelector('[data-testid=\"status-search\"]')?.textContent?.includes('Running')"
            )
            assert "Running" in page.get_by_test_id("status-search").inner_text()
            page.get_by_test_id("select-search-history").select_option("older-search")
            assert page.get_by_test_id("text-search-evidence-older-row").inner_text() == "Bail is set at $1,500."

            page.get_by_test_id("input-search-start-date").fill(date)
            page.get_by_test_id("input-search-end-date").fill(date)
            page.get_by_test_id("button-start-bail-search").click()
            error = page.get_by_test_id("error-search-form")
            error.wait_for()
            assert error.get_attribute("role") == "alert"
            assert "Search not started." in error.inner_text()
            assert "Previous results are unchanged." in error.inner_text()
            assert started["post_count"] == 2
            assert page.get_by_test_id("select-search-history").input_value() == "older-search"
            assert page.get_by_test_id("text-search-evidence-older-row").inner_text() == "Bail is set at $1,500."
            assert page.get_by_test_id("panel-search-progress").count() == 0

            stopped_cases = [
                ("source_blocked", "Calendar discovery stopped. The last source request timed out; the source does not confirm what completed. No validated docket total is available; this is not a confirmed empty search. 2 docket rows are retained; the calendar is not validated, so no zero-result conclusion is available. Next: Do not retry or change request methods."),
                ("source_blocked", "Calendar discovery stopped. The court returned an access denial (HTTP 403). No validated docket total is available; this is not a confirmed empty search. 2 docket rows are retained; the calendar is not validated, so no zero-result conclusion is available. Next: Do not retry or change request methods."),
                ("source_blocked", "Calendar discovery stopped. The court presented a verification challenge or sign-in prompt. No validated docket total is available; this is not a confirmed empty search. 2 docket rows are retained; the calendar is not validated, so no zero-result conclusion is available. Next: Do not retry or change request methods."),
                ("source_blocked", "Calendar discovery stopped. A source validation barrier is active; the original validation cause is unknown from retained evidence. No validated docket total is available; this is not a confirmed empty search. 2 docket rows are retained; the calendar is not validated, so no zero-result conclusion is available. Next: Do not retry or change request methods."),
                ("new_search", "Calendar discovery stopped. The original calendar date window has passed. No validated docket total is available; this is not a confirmed empty search. 2 docket rows are retained; the calendar is not validated, so no zero-result conclusion is available. Next: Start a new eligible search."),
            ]
            for action, message in stopped_cases:
                latest_search["value"] = search(
                    "newer-search", "paused", date,
                    progress(calendarValidated=False, total=0, pending=0),
                    [result("pending-row-1", "CP-2026-0001", "", status="NOT_REQUESTED"),
                     result("pending-row-2", "CP-2026-0002", "", status="NOT_REQUESTED")],
                    "2026-11-01T12:02:00.000Z",
                    recovery_action=action, recovery_message=message,
                )
                page.reload(wait_until="domcontentloaded")
                notice = page.get_by_test_id("text-recovery-message")
                notice.wait_for()
                assert message in notice.inner_text()
                assert page.get_by_test_id("button-resume-search").count() == 0
                assert page.get_by_test_id("row-search-pending-row-1").count() == 1
                assert started["post_count"] == 2, "A displayed timeout or source stop must not trigger another Search request."

            page.get_by_test_id("select-search-history").select_option("older-search")
            assert page.get_by_test_id("text-search-evidence-older-row").inner_text() == "Bail is set at $1,500."

            successful_result = result(
                "successful-row", "CP-02-CR-0005845-2026",
                "10.00% unsecured bail, $100.00.",
            )
            completed_search = search(
                "successful-search", "complete", date,
                progress(completed=1, total=1, pending=0, calendarValidated=True,
                         documentsDiscovered=1, documentsRetrieved=1,
                         documentsProcessed=1, documentsWithEvidence=1,
                         sourceRequestsUsed=2),
                [successful_result],
                "2026-11-01T12:04:00.000Z",
            )
            started["next_post_response"] = completed_search
            page.get_by_test_id("input-search-start-date").fill(date)
            page.get_by_test_id("input-search-end-date").fill(date)
            page.get_by_test_id("button-start-bail-search").click()
            page.get_by_test_id("text-search-evidence-successful-row").wait_for()
            assert page.get_by_test_id("text-search-evidence-successful-row").inner_text() == "10.00% unsecured bail, $100.00."
            assert "$100.00" in page.get_by_test_id("table-search-rows").inner_text()
            assert "Complete" in page.get_by_test_id("status-search").inner_text()
            assert page.get_by_test_id("select-search-history").input_value() == "successful-search"
            assert started["post_count"] == 3, "Successful search projection must not issue automatic retries."

            future = datetime.now().astimezone().replace(microsecond=0)
            from datetime import timedelta
            available_at = (future + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
            waiting_search = search(
                "newer-search", "paused", date,
                progress(calendarValidated=True, total=4, pending=2, completed=2,
                         documentsDiscovered=4, documentsProcessed=2),
                [result("pdf-pending", "CP-2026-0003", "", status="NOT_REQUESTED"),
                 result("pdf-empty", "CP-2026-0004", "", status="NO_BAIL_SECTION"),
                 result("pdf-ambiguous", "CP-2026-0005", "", status="AMBIGUOUS"),
                 result("pdf-failed", "CP-2026-0006", "", status="RETRIEVAL_FAILED")],
                "2026-11-01T12:03:00.000Z",
                recovery_action="wait",
                recovery_message="Docket PDF processing stopped. The shared hourly request limit has been reached. The search is incomplete; pending docket checks and any unprocessed PDFs remain unfinished. 4 docket rows from the validated calendar and 2 of 4 discovered PDFs processed are retained. Next: wait.",
                available_at=available_at,
            )
            latest_search["value"] = waiting_search
            page.reload(wait_until="domcontentloaded")
            page.get_by_test_id("text-recovery-message").wait_for()
            resume_button = page.get_by_test_id("button-resume-search")
            resume_button.wait_for()
            assert resume_button.is_disabled()
            assert page.get_by_test_id("status-search-evidence-pdf-pending").inner_text() == "Not requested — calendar row only"
            assert page.get_by_test_id("status-search-evidence-pdf-empty").inner_text() == "PDF processed; no bail section found"
            assert page.get_by_test_id("status-search-evidence-pdf-ambiguous").inner_text() == "Bail evidence is ambiguous"
            assert page.get_by_test_id("status-search-evidence-pdf-failed").inner_text() == "PDF retrieval failed"
            assert "$0.00" not in page.get_by_test_id("table-search-rows").inner_text()
            browser.close()

        print("PASS: mocked search completion projects evidence; stop states preserve results and never retry automatically.")
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
