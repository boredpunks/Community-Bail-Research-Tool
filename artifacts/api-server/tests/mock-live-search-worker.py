"""Offline source-response fixture for the live API search integration test.

The calendar and docket PDF are local fixtures. This worker preserves the
parent IPC protocol but has no browser, HTTP client, or public-network path.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "artifacts/api-server/src/ujs"))
from evidence import CalendarResults, extract_bail

CALENDAR_URL = "https://ujsportal.pacourts.us/CaseSearch"
POSITIVE_DOCKET = "CP-02-CR-0005845-2026"
NO_BAIL_DOCKET = "MJ-05310-NT-0000228-2026"


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


def parent_message():
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("Parent closed the offline fixture protocol.")
    return json.loads(line)


def require_grant(url, method):
    emit("request", path=urlsplit(url).path, method=method, url=url)
    grant = parent_message()
    if grant.get("allow") is not True or not grant.get("requestId"):
        emit("pause", code="PARENT_DENIED", attempted=False)
        emit("finished")
        raise SystemExit(0)
    emit("response", requestId=grant["requestId"], status=200, outcome="OK", retryAfter=None)
    return parent_message().get("continue") is True


def calendar_rows(criteria, docket, court_type, court_office, event_type):
    date = datetime.strptime(criteria["startDate"], "%Y-%m-%d")
    display_date = f"{date.month}/{date.day}/{date.year}"
    headers = ["Column"] * 19
    for index, label in {
        2: "Docket Number", 3: "Court Type", 6: "Filing Date",
        9: "County", 10: "Court Office", 14: "Event Type",
    }.items():
        headers[index] = label
    cells = [""] * 19
    cells[2] = docket
    cells[3] = court_type
    cells[6] = display_date
    cells[9] = "Allegheny"
    cells[10] = court_office
    cells[14] = event_type
    cells[16] = f"{display_date} 9:00 am"
    report_path = "/Report/MdjDocketSheet" if court_type == "Magisterial District Court" else "/Report/CpDocketSheet"
    cells[18] = f'<a href="{report_path}?docketNumber={docket}">Docket PDF</a>'
    html = (
        '<table id="caseSearchResultGrid"><tr>'
        + "".join(f"<th>{label}</th>" for label in headers)
        + "</tr><tr>"
        + "".join(f"<td>{cell}</td>" for cell in cells)
        + "</tr>"
    )
    if event_type == "Preliminary Hearing":
        # Offline-only fixture: one valid row, one rejected out-of-window row,
        # and a visible next-page link. No court request is made by this test.
        rejected = cells.copy()
        rejected[2] = "CP-02-CR-0005846-2026"
        outside_date = date + timedelta(days=1)
        rejected[16] = f"{outside_date.month}/{outside_date.day}/{outside_date.year} 9:00 am"
        rejected[18] = f'<a href="{report_path}?docketNumber={rejected[2]}">Docket PDF</a>'
        html += "<tr>" + "".join(f"<td>{cell}</td>" for cell in rejected) + "</tr>"
    html += "</table>"
    if event_type == "Preliminary Hearing":
        html += '<a href="/CaseSearch?page=2">Next page</a>'
    parser = CalendarResults()
    parser.feed(html)
    parser.close()
    rows = parser.validated(criteria)
    if len(rows) != 1 or parser.row_rejection_count != (1 if event_type == "Preliminary Hearing" else 0):
        raise RuntimeError("The mocked calendar response did not validate.")
    return rows, parser.row_rejection_count, len(parser.rows)


def main():
    config = json.loads(sys.stdin.readline())
    criteria = config["criteria"]
    no_bail = criteria["eventType"] == "Formal Arraignment"
    docket = NO_BAIL_DOCKET if no_bail else POSITIVE_DOCKET
    court_type = "Magisterial District Court" if no_bail else "Common Pleas"
    event_type = criteria["eventType"]
    report_path = "/Report/MdjDocketSheet" if no_bail else "/Report/CpDocketSheet"
    pdf_url = f"https://ujsportal.pacourts.us{report_path}?docketNumber={docket}"
    if not require_grant(CALENDAR_URL, "POST"):
        return
    court_office = "05-3-10" if no_bail else criteria["courtOffice"]
    rows, rejected_rows, observed_rows = calendar_rows(criteria, docket, court_type, court_office, event_type)
    if event_type == "Preliminary Hearing":
        emit("calendar_coverage", segmentsChecked=1, segmentsTotal=None,
             rowsObserved=observed_rows, rowsExcluded=rejected_rows)
    emit("calendar", rows=rows, retrievedAt=datetime.now(timezone.utc).isoformat(),
         paginationComplete=event_type != "Preliminary Hearing", resultCapReached=False, traversal="STATIC_DOM",
         blockedAssets=0)
    if not require_grant(pdf_url, "GET"):
        return

    pdf_path = ROOT / (
        "attached_assets/MdjDocketSheet_(1)_1792451673387.pdf"
        if no_bail else "attached_assets/CpDocketSheet_1792451669525.pdf"
    )
    body = pdf_path.read_bytes()
    started = time.perf_counter()
    extracted = extract_bail(body, docket)
    extraction_ms = round((time.perf_counter() - started) * 1000)
    expected_outcome = "MISSING_BAIL_SECTION" if no_bail else "EXTRACTED"
    if extracted["extractionOutcome"] != expected_outcome:
        raise RuntimeError(f"The supplied PDF fixture did not produce {expected_outcome}.")
    emit("docket", **{
        **extracted,
        "docketNumber": docket,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "extractionMs": extraction_ms,
    })
    emit("finished")


if __name__ == "__main__":
    main()
