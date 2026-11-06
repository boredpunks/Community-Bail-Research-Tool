import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
CHROMIUM = shutil.which("chromium")


def main():
    if not CHROMIUM:
        raise RuntimeError("Chromium is required for this browser regression test.")

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

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=CHROMIUM,
                args=["--no-sandbox"],
            )
            page = browser.new_page()

            def mock_api(route):
                path = route.request.url.split("?", 1)[0]
                body = {"authenticated": True} if path.endswith("/api/workspace-access/session") else []
                route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

            page.route("**/api/**", mock_api)
            page.goto(f"{base_url}/menu", wait_until="domcontentloaded")
            page.locator('[data-testid="link-menu-review"]').wait_for()

            assert "Search the live court calendar and view the raw results." in page.locator(
                '[data-testid="link-menu-search"]'
            ).inner_text()
            assert "matches extracted from your latest search" in page.locator('[data-testid="link-menu-review"]').inner_text()
            assert "explicitly saved to the shared Candidates list" in page.locator('[data-testid="link-menu-candidates"]').inner_text()

            page.locator('[data-testid="link-menu-review"]').click()
            page.get_by_role("heading", name="Latest search matches").wait_for()
            review_nav = page.locator('[data-testid="nav-review"]')
            assert review_nav.get_attribute("aria-label") == "Review: Latest search matches"
            assert "not human-confirmed findings" in page.locator('[data-testid="text-review-state"]').inner_text()
            assert "does not verify or approve" in page.locator('[data-testid="text-review-state"]').inner_text()

            candidates_nav = page.locator('[data-testid="nav-candidates"]')
            assert candidates_nav.get_attribute("aria-label") == "Candidates: Rows saved to the shared list"
            candidates_nav.click()
            page.get_by_role("heading", name="Saved candidates").wait_for()
            assert "records list membership" in page.locator("main").inner_text()
            assert "does not verify the source or approve a finding" in page.locator("main").inner_text()

            search_nav = page.locator('[data-testid="nav-search"]')
            search_nav.click()
            assert page.url.endswith("/search")
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
    print("PASS: menu, navigation, Review, and Candidates render aligned state descriptions.")
