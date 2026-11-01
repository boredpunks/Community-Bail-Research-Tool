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


def search(search_id, status, start_date, progress, results, updated_at):
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
        "resumeToken": "test-resume-token" if status == "paused" else None,
        "resumeAvailableAt": None,
        "recovery": {
            "action": "resume" if status == "paused" else "none",
            "message": "Your results are saved. Continue checking the remaining evidence." if status == "paused" else "",
            "availableAt": None,
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
        "documentsDiscovered": 1,
        "documentRequestsAttempted": 1,
        "documentsRetrieved": 1,
        "documentsProcessed": 1,
        "documentsWithEvidence": 1,
        "sourceRequestsUsed": 2,
        "sourceRequestLimit": 10,
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
        "bail_amount": 1500,
        "percentage": None,
        "classification": "monetary",
        "evidence_page": 2 if quote else None,
        "evidence_quote": quote,
        "evidence_acquisition": "STORED_EXTRACTION" if quote else "NOT_RETRIEVED",
        "document_status": status,
        "qualifies": bool(quote),
        "ambiguous": False,
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
        ),
        [],
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

        started = {"value": False, "body": None, "post_count": 0, "resume_body": None}
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
                    if started["post_count"] == 1:
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
            assert page.get_by_test_id("select-search-history").input_value() == "newer-search"
            assert "Paused" in page.get_by_test_id("status-search").inner_text()
            assert page.get_by_test_id("button-resume-search").is_enabled()
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
            browser.close()

        print("PASS: refresh restores a resumable paused search while older PDF evidence remains selectable.")
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
