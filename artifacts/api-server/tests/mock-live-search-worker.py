"""Offline source-response fixture for the live API search integration test.

The calendar and docket PDF are local fixtures. This worker preserves the
parent IPC protocol but has no browser, HTTP client, or public-network path.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "artifacts/api-server/src/ujs"))
from evidence import CalendarResults, extract_bail

DOCKET = "CP-02-CR-0005845-2026"
CALENDAR_URL = "https://ujsportal.pacourts.us/CaseSearch"
PDF_URL = (
    "https://ujsportal.pacourts.us/Report/CpDocketSheet"
    f"?docketNumber={DOCKET}"
)


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


def parent_message():
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("Parent closed the offline fixture protocol.")
    return json.loads(line)


def require_grant(url, method):
    emit("request", path="/CaseSearch" if "CaseSearch" in url else "/Report/CpDocketSheet",
         method=method, url=url)
    grant = parent_message()
    if grant.get("allow") is not True or not grant.get("requestId"):
        emit("pause", code="PARENT_DENIED", attempted=False)
        emit("finished")
        raise SystemExit(0)
    emit("response", requestId=grant["requestId"], status=200, outcome="OK", retryAfter=None)
    return parent_message().get("continue") is True


def calendar_rows(criteria):
    date = datetime.strptime(criteria["startDate"], "%Y-%m-%d")
    display_date = f"{date.month}/{date.day}/{date.year}"
    headers = ["Column"] * 19
    for index, label in {
        2: "Docket Number", 3: "Court Type", 6: "Filing Date",
        9: "County", 10: "Court Office", 14: "Event Type",
    }.items():
        headers[index] = label
    cells = [""] * 19
    cells[2] = DOCKET
    cells[3] = "Common Pleas"
    cells[6] = display_date
    cells[9] = "Allegheny"
    cells[10] = "CP-05-02-Crim"
    cells[14] = criteria["eventType"]
    cells[16] = f"{display_date} 9:00 am"
    cells[18] = f'<a href="/Report/CpDocketSheet?docketNumber={DOCKET}">Docket PDF</a>'
    html = (
        '<table id="caseSearchResultGrid"><tr>'
        + "".join(f"<th>{label}</th>" for label in headers)
        + "</tr><tr>"
        + "".join(f"<td>{cell}</td>" for cell in cells)
        + "</tr></table>"
    )
    parser = CalendarResults()
    parser.feed(html)
    parser.close()
    rows = parser.validated(criteria)
    if len(rows) != 1:
        raise RuntimeError("The mocked calendar response did not validate.")
    return rows


def main():
    config = json.loads(sys.stdin.readline())
    criteria = config["criteria"]
    if not require_grant(CALENDAR_URL, "POST"):
        return
    rows = calendar_rows(criteria)
    emit("calendar", rows=rows, retrievedAt=datetime.now(timezone.utc).isoformat(),
         paginationComplete=True, resultCapReached=False, traversal="STATIC_DOM",
         blockedAssets=0)
    if not require_grant(PDF_URL, "GET"):
        return

    pdf_path = ROOT / "attached_assets/CpDocketSheet_1792451669525.pdf"
    body = pdf_path.read_bytes()
    started = time.perf_counter()
    extracted = extract_bail(body, DOCKET)
    extraction_ms = round((time.perf_counter() - started) * 1000)
    if extracted["extractionOutcome"] != "EXTRACTED":
        raise RuntimeError("The supplied PDF fixture did not pass docket identity validation.")
    emit("docket", **{
        **extracted,
        "docketNumber": DOCKET,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "extractionMs": extraction_ms,
    })
    emit("finished")


if __name__ == "__main__":
    main()
