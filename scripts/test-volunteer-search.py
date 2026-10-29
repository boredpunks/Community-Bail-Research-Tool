"""Offline/source-cache acceptance. Credentials and cookies stay in memory."""
import csv
import io
import os
import runpy
import time
from pathlib import Path
import requests


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print("PASS:", label, flush=True)


def main():
    proof = runpy.run_path("scripts/prove-end-to-end.py", run_name="proof_test")
    row = {"date": "2026-10-28", "classification": "monetary", "amount": 1000,
           "bail_type": "Monetary", "percentage": 10, "page": 1, "quote": ""}
    newer = {**row, "date": "2026-10-29", "classification": "nonmonetary", "amount": 0}
    selection = proof["select_bail_decision"]([row, newer])
    check(selection["classification"] == "nonmonetary" and not selection["is_ambiguous"], "Later nonmonetary decision supersedes monetary")
    check(proof["select_bail_decision"]([row, {**newer, "date": row["date"]}])["is_ambiguous"], "Same-date conflict is ambiguous")
    check(proof["select_bail_decision"]([])["classification"] == "unknown", "Empty evidence is unknown")
    base = "http://localhost:80"
    prefix = base + "/api/bail-search"
    check(requests.get(prefix + "/search", allow_redirects=False, timeout=10).status_code == 302, "Unauthenticated access redirects")
    sessions = [requests.Session(), requests.Session()]
    for session in sessions:
        response = session.post(base + "/api/workspace-access/enter",
            json={"password": os.environ["RESEARCH_WORKSPACE_PASSWORD"]},
            headers={"Origin": base}, timeout=10)
        check(response.status_code == 200, "Workspace session authenticated")
    a, b = sessions
    readiness = a.get(prefix + "/readiness", timeout=10).json()
    check(not readiness["liveAvailable"] and readiness["collectedDockets"] > 0, "Volunteer release reports a real collected-docket count and does not enable live collection")
    denied_live = a.post(prefix + "/search", json={"startDate": "2026-10-29", "endDate": "2026-10-29",
        "maxBail": 2000, "source": "live"}, headers={"Origin": base}, timeout=10)
    check(denied_live.status_code == 409, "Direct live creation is rejected without court requests")
    response = a.post(prefix + "/search", json={"startDate": "2026-10-28",
        "endDate": "2026-10-29", "maxBail": 2000, "source": "saved"},
        headers={"Origin": base}, timeout=20)
    check(response.status_code == 201, "Search persisted")
    search_id = response.json()["searchId"]
    endpoint = prefix + "/search/" + search_id
    check(b.get(endpoint + "/status", timeout=10).status_code == 403, "Other session cannot read search")
    check(b.get(endpoint + "/export", timeout=10).status_code == 403, "Other session cannot export search")
    for _ in range(90):
        result = a.get(endpoint + "/status", timeout=10).json()
        if result["status"] != "running":
            break
        time.sleep(1)
    check(result["status"] in ("complete", "paused"), "Search completes or explicitly pauses")
    check(len(result["results"]) > 0, "Actual saved-source results returned")
    check(all(not r["qualifies"] for r in result["results"] if r["classification"] == "denied"), "Denied excluded from monetary filter")
    text = a.get(endpoint + "/export", timeout=10).text
    rows = list(csv.DictReader(io.StringIO("\n".join(line for line in text.splitlines() if not line.startswith("#")))))
    check(len(rows) == len(result["results"]), "CSV contains all database result rows")
    check(f'# Search incomplete: {str(result["incomplete"]).lower()}' in text, "CSV completeness metadata")
    print("RESULT:", result["status"], result["progress"], "qualifying:", sum(r["qualifies"] for r in result["results"]), flush=True)
    matches_text = a.get(endpoint + "/export?selection=matches", timeout=10).text
    matches = list(csv.DictReader(io.StringIO("\n".join(line for line in matches_text.splitlines() if not line.startswith("#")))))
    check(len(matches) == sum(row["qualifies"] for row in result["results"]), "Matches-only export agrees with on-screen amount filter")
    check(all("ambiguous" in row and "error" in row and "source_url" in row for row in rows), "CSV carries uncertainty and source context")
    first = result["results"][0]
    check(b.post(endpoint + "/results/" + first["id"] + "/save", json={"shareWithWorkspace": True},
        headers={"Origin": base}, timeout=10).status_code == 403, "Other session cannot share search evidence")
    check(a.post(endpoint + "/results/" + first["id"] + "/save", json={"shareWithWorkspace": False},
        headers={"Origin": base}, timeout=10).status_code == 400, "Sharing requires explicit workspace consent")
    for row in result["results"]:
        if not row.get("save_available") and not row.get("saved_record_id"):
            denied = a.post(endpoint + "/results/" + row["id"] + "/save", json={"shareWithWorkspace": True},
                headers={"Origin": base}, timeout=10)
            check(denied.status_code == 409, "Incomplete or unverified evidence cannot silently become an observation")
            break
    if result.get("recovery", {}).get("action") == "evidence_needed":
        check(result["resumeToken"] is None, "Missing evidence does not expose a futile resume token")
    if result["status"] == "paused" and result.get("resumeToken"):
        token = result["resumeToken"]
        resumed = a.post(endpoint + "/resume", json={"resumeToken": token}, headers={"Origin": base}, timeout=10)
        check(resumed.status_code == 200, "Paused search resumes explicitly")
        replay = a.post(endpoint + "/resume", json={"resumeToken": token}, headers={"Origin": base}, timeout=10)
        check(replay.status_code in (403, 409), "Used resume token cannot replay")
        original_ids = {row["id"] for row in result["results"]}
        for _ in range(90):
            result = a.get(endpoint + "/status", timeout=10).json()
            if result["status"] != "running":
                break
            time.sleep(1)
        check(result["status"] in ("complete", "paused"), "Resumed search reaches an explicit terminal or paused state")
        check({row["id"] for row in result["results"]} == original_ids, "Resume retains result identity without duplicates")
    if "--wait-restart" in __import__("sys").argv:
        Path("/tmp/volunteer-search-restart-ready").touch()
        deadline = time.monotonic() + 120
        while not Path("/tmp/volunteer-search-restart-done").exists() and time.monotonic() < deadline:
            time.sleep(1)
        reread = a.get(endpoint + "/status", timeout=20).json()
        check(reread["results"] == result["results"], "Results and same session survive server restart")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("FAILED:", type(error).__name__)  # Never print authenticated transport exceptions.
        raise SystemExit(1)
