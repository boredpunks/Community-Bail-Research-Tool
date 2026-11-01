import asyncio
import json
import os
import shutil
import socket
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
CHROMIUM = shutil.which("chromium")


def make_search(status, result=None, reason=None):
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    return {
        "searchId": "journey-search-1",
        "status": status,
        "criteria": {"startDate": today, "endDate": today, "maxBail": 2000,
                     "source": "live", "courtOffice": "ANY", "eventType": "Bail Hearing"},
        "progress": {"completed": 0 if status == "running" else 1, "total": 1,
                     "pending": 1 if status == "running" else 0,
                     "calendarValidated": True,
                     "calendarCoverage": {"segmentsChecked": 1, "segmentsTotal": 1,
                                          "rowsObserved": 1, "rowsRetained": 1,
                                          "rowsExcluded": 0, "partial": False},
                     "documentsDiscovered": 1,
                     "documentRequestsAttempted": 1, "documentsRetrieved": 1 if status == "complete" else 0,
                     "documentsProcessed": 0 if status == "running" else 1,
                     "documentsWithEvidence": 0 if status == "running" else 1,
                      "sourceRequestsUsed": 2, "sourceRequestLimit": 10,
                      "localOcr": None, "timeline": []},
        "incomplete": False, "reason": reason, "resumeToken": None,
        "resumeAvailableAt": None,
        "recovery": {"action": "none", "message": "", "availableAt": None},
        "canManage": True, "results": [result] if result else [],
        "createdAt": "2026-11-01T12:00:00.000Z", "updatedAt": "2026-11-01T12:04:00.000Z",
        "sourceNotice": "Test fixture; no court source is contacted.",
        "stage": "checking_documents" if status == "running" else "complete",
    }


async def main():
    if not CHROMIUM:
        raise RuntimeError("Chromium is required.")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = os.environ.copy()
    env.update({"PORT": str(port), "BASE_PATH": "/"})
    server = subprocess.Popen(
        ["pnpm", "--filter", "@workspace/community-bail-research", "run", "dev"],
        cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base_url = f"http://127.0.0.1:{port}"
    for _ in range(180):
        if server.poll() is not None:
            raise RuntimeError(server.stdout.read() if server.stdout else "Vite exited.")
        try:
            import urllib.request
            urllib.request.urlopen(base_url, timeout=1).close()
            break
        except Exception:
            await asyncio.sleep(0.25)
    else:
        raise RuntimeError("Vite did not start.")

    running = make_search("running")
    complete = make_search("complete", {
        "id": "successful-row", "docket_number": "CP-02-CR-0005845-2026",
        "hearing_date": datetime.now(ZoneInfo("America/New_York")).date().isoformat(),
        "decision_date": None, "office": "CP-05-02-Crim", "bail_amount": 100,
        "percentage": 10, "classification": "monetary", "evidence_page": 2,
        "evidence_quote": "10.00% unsecured bail, $100.00.",
        "evidence_acquisition": "STORED_EXTRACTION", "document_status": "EXTRACTED",
        "qualifies": True, "ambiguous": False, "error": None,
        "source_url": "https://example.test/docket.pdf", "source_retrieved_at": None,
        "source_consulted_at": None, "source_pdf_sha256": None,
    }, reason="Review warning: the extracted result needs manual review.")
    state = {"search": running, "post_count": 0, "post_seen": asyncio.Event(),
             "release_post": asyncio.Event(), "status_ids": []}

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, executable_path=CHROMIUM,
                                              args=["--no-sandbox"])
            page = await browser.new_page(viewport={"width": 390, "height": 844},
                                          device_scale_factor=1)

            async def mock_api(route):
                req = route.request
                path = req.url.split("?", 1)[0]
                if path.endswith("/api/workspace-access/session"):
                    body = {"authenticated": True}
                elif path.endswith("/api/bail-search/search") and req.method == "GET":
                    body = [state["search"]]
                elif path.endswith("/api/bail-search/search") and req.method == "POST":
                    state["post_count"] += 1
                    assert state["post_count"] == 1, "Unexpected automatic/duplicate Search POST"
                    assert req.post_data_json["source"] == "live"
                    state["search"] = running
                    state["post_seen"].set()
                    await state["release_post"].wait()
                    body = running
                elif path.endswith("/api/bail-search/search/journey-search-1/status"):
                    state["status_ids"].append("journey-search-1")
                    body = state["search"]
                elif path.endswith("/api/bail-search/candidates") or path.endswith("/api/bail-records"):
                    body = []
                else:
                    route.fulfill(status=404, content_type="application/json",
                                  body=json.dumps({"error": "Unexpected mocked API request"}))
                    return
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

            await page.route("**/api/**", mock_api)
            await page.goto(f"{base_url}/search", wait_until="domcontentloaded")
            today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
            await page.get_by_test_id("input-search-start-date").fill(today)
            await page.get_by_test_id("input-search-end-date").fill(today)
            await page.get_by_test_id("button-start-bail-search").click()
            await asyncio.wait_for(state["post_seen"].wait(), timeout=5)

            # The mocked POST is deliberately unresolved while navigation unmounts Search.
            await page.get_by_test_id("nav-review").click()
            await page.get_by_test_id("background-search-status").wait_for()
            background_status = await page.get_by_test_id("background-search-status").inner_text()
            assert "Search running" in background_status
            assert "Checking docket documents" in background_status
            assert "PDFs processed" in background_status
            state["release_post"].set()
            await page.wait_for_function(
                "() => sessionStorage.getItem('bail-research:last-started-search') === 'journey-search-1'"
            )

            # Complete only the mock while off Search; no court endpoint is contacted.
            state["search"] = complete
            await page.get_by_test_id("nav-search").click()
            await page.get_by_test_id("text-search-completion-warning").wait_for()
            assert await page.get_by_test_id("status-search").inner_text()
            assert "CP-02-CR-0005845-2026" in await page.get_by_test_id("table-search-rows").inner_text()
            assert "$100.00" in await page.get_by_test_id("table-search-rows").inner_text()
            assert await page.get_by_test_id("text-search-evidence-successful-row").inner_text() == "10.00% unsecured bail, $100.00."
            assert await page.get_by_test_id("button-resume-search").count() == 0
            assert await page.get_by_test_id("text-search-completion-warning").inner_text() == complete["reason"]
            assert await page.evaluate("sessionStorage.getItem('bail-research:last-started-search')") == "journey-search-1"

            await page.reload(wait_until="domcontentloaded")
            await page.get_by_test_id("text-search-completion-warning").wait_for()
            assert "CP-02-CR-0005845-2026" in await page.get_by_test_id("table-search-rows").inner_text()
            assert "$100.00" in await page.get_by_test_id("table-search-rows").inner_text()
            assert await page.get_by_test_id("button-resume-search").count() == 0
            assert state["post_count"] == 1
            assert state["status_ids"] and set(state["status_ids"]) == {"journey-search-1"}
            print("PASS: delayed mocked start promotes across navigation; completion, warning, docket and $100 persist after reload at 390x844; no extra POST/resume.")
            await browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
