# scripts/prove-end-to-end.py
"""
Six-row saved-job proof (Calendar Results → PDF Fetch → Bail Extraction)

The six exact rows are defined below. Source URLs and DNH values are used only
for retrieval and validation; they are omitted from generated reports. This
standalone runner makes plain GET requests only; it does not update app review
state or bypass a source denial.

Usage:
  uv run python scripts/prove-end-to-end.py

Outputs:
  artifacts/proof_YYYYMMDD_HHMMSS.csv
  artifacts/proof_YYYYMMDD_HHMMSS.json
"""

import csv
import hashlib
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pymupdf as fitz
import requests

USER_AGENT = "CommunityBailResearch-SourceAssessment/1.0"
MAX_PDF_SIZE = 4 * 1024 * 1024
MIN_REQUEST_INTERVAL_SECONDS = 2.0
JOB_ID = "88f9911f-0e18-4359-b525-3c75541e0a60"
EXPECTED_ROW_COUNT = 6
CACHE_DIR = Path(".cache/community-bail-proof")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
LOCAL_PDF_OVERRIDES = {
    "CP-02-CR-0003870-2026": Path(
        "attached_assets/CpDocketSheet_1793205784766.pdf"
    ),
}

PROOF_ROWS: list[dict] = [
    {
        "docket_number": "MJ-05247-CR-0000502-2025",
        "dnh": "bz3yc0mNGOMQzwUjpdqYQQ==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=MJ-05247-CR-0000502-2025&dnh=bz3yc0mNGOMQzwUjpdqYQQ%3D%3D",
        "hearing_date": "2026-10-28",
        "hearing_time": "12:51 am",
        "office": "MDJ-05-2-47",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
    {
        "docket_number": "MJ-05214-CR-0000553-2026",
        "dnh": "Ncdns+orTqUADPymLY+Vqw==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=MJ-05214-CR-0000553-2026&dnh=Ncdns%2BorTqUADPymLY%2BVqw%3D%3D",
        "hearing_date": "2026-10-29",
        "hearing_time": "09:00 am",
        "office": "MDJ-05-2-14",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
    {
        "docket_number": "MJ-05214-CR-0000246-2026",
        "dnh": "J23XLMBst45i05cAWKi6kA==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=MJ-05214-CR-0000246-2026&dnh=J23XLMBst45i05cAWKi6kA%3D%3D",
        "hearing_date": "2026-10-29",
        "hearing_time": "09:00 am",
        "office": "MDJ-05-2-14",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
    {
        "docket_number": "MJ-05207-CR-0000269-2026",
        "dnh": "cu+7EHgCXD1ituq5aTCElg==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=MJ-05207-CR-0000269-2026&dnh=cu%2B7EHgCXD1ituq5aTCElg%3D%3D",
        "hearing_date": "2026-10-29",
        "hearing_time": "09:30 am",
        "office": "MDJ-05-2-07",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
    {
        "docket_number": "MJ-05003-CR-0006914-2026",
        "dnh": "eVhnQzCUlyDbF/7lJOgnXA==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/MdjDocketSheet?docketNumber=MJ-05003-CR-0006914-2026&dnh=eVhnQzCUlyDbF%2F7lJOgnXA%3D%3D",
        "hearing_date": "2026-10-28",
        "hearing_time": "08:30 am",
        "office": "MDJ-05-0-03",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
    {
        "docket_number": "CP-02-CR-0003870-2026",
        "dnh": "fXP/LUkAZHU4fxKH46mgkw==",
        "sourceUrl": "https://ujsportal.pacourts.us/Report/CpDocketSheet?docketNumber=CP-02-CR-0003870-2026&dnh=fXP%2FLUkAZHU4fxKH46mgkw%3D%3D",
        "hearing_date": "2026-10-28",
        "hearing_time": "08:30 am",
        "office": "CP-05-02-Crim",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
]
_last_request_started: float | None = None
_request_count = 0


class StopCollectionError(RuntimeError):
    """A source-wide denial or validation failure; no later source request is allowed."""


class RowRetrievalError(RuntimeError):
    """A non-retryable failure scoped to one docket row."""


def load_proof_rows() -> list[dict]:
    """Load the exact saved job rows without persisting source URLs in the script."""
    helper = Path("scripts/load-proof-rows.mjs")
    try:
        completed = subprocess.run(
            ["node", str(helper), JOB_ID],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("Could not read the saved job rows; no source request was made.") from error
    if completed.returncode != 0:
        raise RuntimeError("Could not read the saved job rows; no source request was made.")
    try:
        rows = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("The saved job returned invalid row data; no source request was made.") from error

    if not isinstance(rows, list) or len(rows) != EXPECTED_ROW_COUNT:
        raise RuntimeError(
            f"Expected exactly {EXPECTED_ROW_COUNT} saved job rows; no source request was made."
        )

    for expected_position, row in enumerate(rows):
        if row.get("position") != expected_position:
            raise RuntimeError("Saved job positions are incomplete or out of order; no source request was made.")
        events = row.get("matching_events")
        if not isinstance(events, list) or len(events) != 1:
            raise RuntimeError(
                f"Expected one exact calendar event for row {expected_position}; no source request was made."
            )
        event = events[0]
        row["hearing_date"] = event.get("eventDate")
        row["hearing_time"] = event.get("eventTime")
        row["event_type"] = event.get("eventType")
        row["sourceUrl"] = row.pop("source_url", None)
        row["source_reference"] = None

        parts = urlsplit(row["sourceUrl"] or "")
        query = parse_qs(parts.query, keep_blank_values=True)
        allowed_paths = {"/Report/MdjDocketSheet", "/Report/CpDocketSheet"}
        if (
            parts.scheme != "https"
            or parts.hostname != "ujsportal.pacourts.us"
            or parts.path not in allowed_paths
            or query.get("docketNumber") != [row.get("docket_number")]
            or len(query.get("dnh", [])) != 1
            or not query["dnh"][0]
        ):
            raise RuntimeError(
                f"Row {expected_position} failed source URL and docket validation; no request was made."
            )
        row["dnh"] = query["dnh"][0]
        row["source_reference"] = f"{parts.hostname}{parts.path}"
        if not row.get("hearing_date") or not row.get("event_type") or not row.get("office"):
            raise RuntimeError(
                f"Row {expected_position} is missing calendar metadata; no source request was made."
            )
    return rows

def validate_proof_rows(rows: list[dict]) -> None:
    """Validate row identity and approved UJS docket routes before retrieval."""
    if len(rows) != EXPECTED_ROW_COUNT:
        raise RuntimeError(
            f"Expected exactly {EXPECTED_ROW_COUNT} proof rows; no source request was made."
        )

    seen_dockets = set()
    allowed_paths = {"/Report/MdjDocketSheet", "/Report/CpDocketSheet"}
    for index, row in enumerate(rows):
        docket_number = row.get("docket_number")
        parts = urlsplit(row.get("sourceUrl") or "")
        query = parse_qs(parts.query, keep_blank_values=True)
        if (
            not isinstance(docket_number, str)
            or docket_number in seen_dockets
            or parts.scheme != "https"
            or parts.hostname != "ujsportal.pacourts.us"
            or parts.path not in allowed_paths
            or query.get("docketNumber") != [docket_number]
            or query.get("dnh") != [row.get("dnh")]
            or not all(
                row.get(field)
                for field in ("hearing_date", "hearing_time", "office", "event_type")
            )
        ):
            raise RuntimeError(
                f"Proof row {index} failed docket, metadata or source URL validation; no request was made."
            )
        row["source_reference"] = f"{parts.hostname}{parts.path}"
        seen_dockets.add(docket_number)


ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)


def validate_pdf_bytes(pdf_bytes: bytes, expected_docket: str) -> int:
    """Validate size, PDF signature and exact docket identity before caching."""
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise StopCollectionError("PDF exceeds the 4MB size limit.")
    if not pdf_bytes.startswith(b"%PDF-"):
        raise StopCollectionError("Response did not have a valid PDF signature.")
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
        document_text = "\n".join(page.get_text() for page in document)
        page_count = document.page_count
        document.close()
    except Exception as error:
        raise StopCollectionError("PDF could not be opened for identity validation.") from error
    if expected_docket.lower() not in document_text.lower():
        raise StopCollectionError("PDF identity did not match the requested docket.")
    return page_count


def _cache_pdf(cache_file: Path, pdf_bytes: bytes) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    temp_file = cache_file.with_suffix(".pdf.tmp")
    temp_file.write_bytes(pdf_bytes)
    temp_file.replace(cache_file)


def _pace_source_request() -> None:
    global _last_request_started
    if _last_request_started is not None:
        elapsed = time.monotonic() - _last_request_started
        wait_seconds = MIN_REQUEST_INTERVAL_SECONDS - elapsed
        if wait_seconds > 0:
            time.sleep(wait_seconds)
    _last_request_started = time.monotonic()


def fetch_pdf(url: str, expected_docket: str) -> tuple[bytes, str, str, str, int]:
    """Reuse a validated cache, then local evidence, or make one paced GET."""
    global _request_count
    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.pdf"
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or parts.hostname != "ujsportal.pacourts.us"
        or parts.path not in {"/Report/MdjDocketSheet", "/Report/CpDocketSheet"}
    ):
        raise StopCollectionError("Source URL is outside the approved UJS docket routes.")

    if cache_file.exists():
        pdf_bytes = cache_file.read_bytes()
        page_count = validate_pdf_bytes(pdf_bytes, expected_docket)
        print("      Using validated cached PDF.")
        return (
            pdf_bytes,
            hashlib.sha256(pdf_bytes).hexdigest(),
            str(cache_file),
            "CACHE",
            page_count,
        )

    local_pdf = LOCAL_PDF_OVERRIDES.get(expected_docket)
    if local_pdf and local_pdf.is_file():
        pdf_bytes = local_pdf.read_bytes()
        page_count = validate_pdf_bytes(pdf_bytes, expected_docket)
        try:
            _cache_pdf(cache_file, pdf_bytes)
        except OSError as error:
            raise StopCollectionError("Local PDF could not be cached; stopping before source requests.") from error
        print("      Validated and cached the existing local PDF.")
        return (
            pdf_bytes,
            hashlib.sha256(pdf_bytes).hexdigest(),
            str(cache_file),
            "LOCAL_ATTACHMENT",
            page_count,
        )

    _pace_source_request()
    _request_count += 1
    try:
        with requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/pdf,application/octet-stream",
            },
            timeout=30,
            allow_redirects=False,
            stream=True,
        ) as response:
            if response.status_code in {401, 403, 429} or response.status_code >= 500:
                raise StopCollectionError(
                    f"HTTP {response.status_code}; stopping collection without retry."
                )
            if response.status_code == 404:
                raise RowRetrievalError("HTTP 404 for this docket.")
            if response.status_code != 200:
                raise StopCollectionError(
                    f"HTTP {response.status_code}; stopping collection without retry."
                )

            content_type = response.headers.get("Content-Type", "").lower()
            if "application/pdf" not in content_type and "application/octet-stream" not in content_type:
                raise StopCollectionError("Source response was not a PDF; stopping collection.")

            chunks = []
            total = 0
            for chunk in response.iter_content(chunk_size=8192):
                total += len(chunk)
                if total > MAX_PDF_SIZE:
                    raise StopCollectionError("PDF exceeds the 4MB size limit.")
                chunks.append(chunk)
    except requests.RequestException as error:
        raise StopCollectionError("Network request failed; stopping without retry.") from error

    pdf_bytes = b"".join(chunks)
    page_count = validate_pdf_bytes(pdf_bytes, expected_docket)
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    try:
        _cache_pdf(cache_file, pdf_bytes)
    except OSError as error:
        raise StopCollectionError("Validated PDF could not be cached; stopping collection.") from error
    print("      Fetched once and cached the validated PDF.")
    return pdf_bytes, pdf_hash, str(cache_file), "HTTP_GET", page_count


def extract_bail(pdf_bytes: bytes, expected_docket: str) -> list[dict]:
    """Extract dated Bail Set rows and keep Bail Posted outside the parse boundary."""
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    candidates = []
    try:
        for page_num in range(len(document)):
            page_text = document[page_num].get_text()
            if "BAIL INFORMATION" in page_text:
                heading = "BAIL INFORMATION"
            elif re.search(r"^BAIL\s*$", page_text, re.MULTILINE):
                heading = "BAIL"
            else:
                continue

            docket_match = re.search(
                r"(?:Case\s*No\.?|Docket\s*Number:)\s*([A-Z0-9\-]+)",
                page_text,
                re.IGNORECASE,
            )
            if not docket_match or docket_match.group(1) != expected_docket:
                continue

            bail_start = page_text.find(heading)
            if bail_start < 0:
                continue
            section_end = len(page_text)
            upper_text = page_text.upper()
            for marker in (
                "BAIL POSTED",
                "CHARGES",
                "DEFENDANT INFORMATION",
                "CONFINEMENT",
                "CASE PARTICIPANTS",
                "MDJS 1200",
                "PRINTED:",
            ):
                marker_pos = upper_text.find(marker, bail_start + len(heading))
                if marker_pos >= 0:
                    section_end = min(section_end, marker_pos)
            bail_section = page_text[bail_start:section_end]
            date_matches = list(
                re.finditer(r"(?<!\d)(\d{1,2}/\d{1,2}/\d{4})(?!\d)", bail_section)
            )

            for row_index, date_match in enumerate(date_matches):
                row_start = date_match.start()
                row_end = (
                    date_matches[row_index + 1].start()
                    if row_index + 1 < len(date_matches)
                    else len(bail_section)
                )
                row_text = bail_section[row_start:row_end].strip()
                amount_matches = list(
                    re.finditer(r"\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?", row_text)
                )
                row_lower = row_text.lower()
                amount = None
                if amount_matches:
                    amount_match = amount_matches[-1]
                    amount_text = amount_match.group(1).replace(",", "")
                    cents = amount_match.group(2) or "00"
                    amount = (
                        int(amount_text)
                        if cents == "00"
                        else float(f"{amount_text}.{cents}")
                    )

                if re.search(r"\b(?:denied|deny)\b", row_lower):
                    classification, bail_type = "denied", "Denied"
                elif "unsecured" in row_lower:
                    classification, bail_type = "unsecured", "Unsecured"
                elif (
                    "nonmonetary" in row_lower
                    or re.search(r"\bror\b", row_lower)
                    or "recognizance" in row_lower
                ):
                    classification, bail_type = "nonmonetary", "Nonmonetary"
                elif "nominal" in row_lower:
                    classification, bail_type = "nominal", "Nominal"
                elif amount is not None and amount > 0:
                    classification, bail_type = "monetary", "Monetary"
                    if "cash" in row_lower:
                        bail_type = "Cash"
                    elif "surety" in row_lower:
                        bail_type = "Surety"
                else:
                    classification, bail_type = "unknown", "Unknown"
                pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", row_text)

                try:
                    parsed_date = datetime.strptime(
                        date_match.group(1), "%m/%d/%Y"
                    ).date()
                except ValueError:
                    continue

                candidates.append(
                    {
                        "date": parsed_date.isoformat(),
                        "date_sort": parsed_date,
                        "amount": amount,
                        "bail_type": bail_type,
                        "percentage": float(pct_match.group(1)) if pct_match else None,
                        "quote": row_text[:500],
                        "classification": classification,
                        "posted": None,
                        "page": page_num + 1,
                    }
                )
    finally:
        document.close()

    for row in candidates:
        row.pop("date_sort")
    return candidates


def latest_rows(entries: list[dict]) -> list[dict]:
    if not entries:
        return []
    latest_date = max(datetime.strptime(row["date"], "%Y-%m-%d").date() for row in entries)
    newest = [
        row for row in entries
        if datetime.strptime(row["date"], "%Y-%m-%d").date() == latest_date
    ]
    unique = {}
    for row in newest:
        key = (
            row["amount"],
            row["bail_type"],
            row["percentage"],
            row["date"],
            row["page"],
        )
        unique[key] = row
    return list(unique.values())


def select_bail_decision(entries: list[dict]) -> dict:
    """Latest dated Bail Set decision; printed order is not same-day chronology."""
    newest = latest_rows(entries)
    keys = {
        (entry["classification"], entry["amount"], entry.get("percentage"))
        for entry in newest
    }
    ambiguous = len(keys) > 1
    return {
        "classification": "ambiguous" if ambiguous else (
            newest[0]["classification"] if newest else "unknown"
        ),
        "is_ambiguous": ambiguous,
        "decision_date": newest[0]["date"] if newest else None,
        "observations": newest,
        "history": sorted(entries, key=lambda entry: entry["date"], reverse=True),
    }


def cached_json() -> None:
    """Machine entry point: cache only, never call fetch_pdf or the court."""
    row = json.load(sys.stdin)
    docket = row.get("docket_number")
    url = row.get("sourceUrl", "")
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    if (
        not isinstance(docket, str)
        or parts.scheme != "https"
        or parts.hostname != "ujsportal.pacourts.us"
        or parts.path not in {"/Report/MdjDocketSheet", "/Report/CpDocketSheet"}
        or query.get("docketNumber") != [docket]
        or len(query.get("dnh", [])) != 1
        or not query["dnh"][0]
    ):
        raise ValueError("Invalid saved source identity.")
    cache_file = CACHE_DIR / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()}.pdf"
    if not cache_file.is_file():
        print(json.dumps({"error": "Evidence is not locally available. No source request was made."}))
        return
    pdf_bytes = cache_file.read_bytes()
    page_count = validate_pdf_bytes(pdf_bytes, docket)
    entries = extract_bail(pdf_bytes, docket)
    print(json.dumps({
        "entries": entries,
        "decision": select_bail_decision(entries),
        "acquisition": "CACHE",
        "page_count": page_count,
        "http_requests": 0,
    }))


def process_docket(row: dict, index: int, total: int) -> dict:
    requests_before = _request_count
    result = {
        "index": index,
        "job_id": JOB_ID,
        "item_id": row.get("item_id"),
        "docket_number": row["docket_number"],
        "hearing_date": row["hearing_date"],
        "hearing_time": row.get("hearing_time"),
        "office": row["office"],
        "event_type": row["event_type"],
        "courtroom": row.get("courtroom"),
        "source_reference": row["source_reference"],
        "status": "pending",
        "error": None,
        "stop_collection": False,
        "observations": [],
        "other_bail_entries": [],
        "bail_amounts": [],
        "pdf_hash": None,
        "pdf_cache_path": None,
        "pdf_page_count": None,
        "pdf_acquisition": None,
        "http_requests": 0,
        "processed_at": datetime.now().isoformat(),
    }

    try:
        print(f"\n[{index + 1}/{total}] {result['docket_number']}")
        pdf_bytes, pdf_hash, pdf_cache_path, acquisition, page_count = fetch_pdf(
            row["sourceUrl"], row["docket_number"]
        )
        result["pdf_hash"] = pdf_hash
        result["pdf_cache_path"] = pdf_cache_path
        result["pdf_page_count"] = page_count
        result["pdf_acquisition"] = acquisition
        result["http_requests"] = _request_count - requests_before
        print(f"      PDF received: {len(pdf_bytes):,} bytes ({pdf_hash[:16]}...)")

        print("      Extracting candidate bail text...")
        entries = extract_bail(pdf_bytes, row["docket_number"])
        decision = select_bail_decision(entries)
        result["decision_date"] = decision["decision_date"]
        result["decision_classification"] = decision["classification"]
        result["history"] = decision["history"]
        result["other_bail_entries"] = [
            entry for entry in entries if entry not in decision["observations"]
        ]
        entries = decision["observations"]
        if decision["is_ambiguous"]:
            result["observations"] = entries
            result["status"] = "ambiguous_latest_decision"
            print("      Conflicting latest-date bail decisions; manual review is required.")
            return result
        monetary_entries = [
            entry for entry in entries if entry["classification"] == "monetary"
        ]
        unsecured_entries = [
            entry for entry in entries if entry["classification"] == "unsecured"
        ]

        if monetary_entries:
            observations = latest_rows(monetary_entries)
            result["observations"] = observations
            result["other_bail_entries"] = [
                entry for entry in entries if entry["classification"] != "monetary"
            ]
            result["bail_amounts"] = [entry["amount"] for entry in observations]
            result["status"] = (
                "candidate_extracted"
                if len(observations) == 1
                else "ambiguous_latest_financial_rows"
            )
            print(f"      Candidate observations: {len(observations)}")
            for observation in observations:
                pct = (
                    f", {observation['percentage']}%"
                    if observation.get("percentage") is not None
                    else ""
                )
                print(
                    f"      Candidate: ${observation['amount']:,} "
                    f"({observation['bail_type']}{pct}), "
                    f"effective {observation.get('date', 'date unknown')}, "
                    f"page {observation['page']}"
                )
            if len(observations) > 1:
                print("      Multiple distinct latest-date rows; manual review is required.")
            else:
                print("      Candidate awaits manual review.")
        elif unsecured_entries:
            observations = latest_rows(unsecured_entries)
            result["observations"] = observations
            result["other_bail_entries"] = [
                entry for entry in entries if entry not in observations
            ]
            result["status"] = "unsecured_only"
            print("      Latest bail amount is unsecured, not monetary bail.")
            for observation in observations:
                print(
                    f"      Unsecured: ${observation['amount']:,}, "
                    f"effective {observation['date']}, page {observation['page']}"
                )
        elif entries:
            result["observations"] = entries
            result["other_bail_entries"] = []
            result["status"] = "no_positive_monetary_bail_row"
            print(
                "      No positive monetary bail row; source records "
                f"{len(entries)} non-monetary/denied row(s)."
            )
        else:
            result["other_bail_entries"] = []
            result["status"] = "no_verified_bail_text"
            print("      No positive, identity-matched monetary bail row was extracted.")
    except StopCollectionError as error:
        result["status"] = "source_stopped"
        result["error"] = str(error)
        result["stop_collection"] = True
        result["http_requests"] = _request_count - requests_before
        print(f"      {error}")
    except RowRetrievalError as error:
        result["status"] = "error"
        result["error"] = str(error)
        result["http_requests"] = _request_count - requests_before
        print(f"      Error: {error}")
    except Exception as error:
        result["status"] = "extraction_error"
        result["error"] = f"Local processing failed: {type(error).__name__}"
        result["http_requests"] = _request_count - requests_before
        print(f"      Local processing failed: {type(error).__name__}")

    return result


def deferred_result(row: dict, index: int, stop_reason: str) -> dict:
    return {
        "index": index,
        "job_id": JOB_ID,
        "item_id": row.get("item_id"),
        "docket_number": row["docket_number"],
        "hearing_date": row["hearing_date"],
        "hearing_time": row.get("hearing_time"),
        "office": row["office"],
        "event_type": row["event_type"],
        "courtroom": row.get("courtroom"),
        "source_reference": row["source_reference"],
        "status": "deferred_after_source_stop",
        "error": stop_reason,
        "stop_collection": True,
        "observations": [],
        "other_bail_entries": [],
        "bail_amounts": [],
        "pdf_hash": None,
        "pdf_cache_path": None,
        "pdf_page_count": None,
        "pdf_acquisition": None,
        "http_requests": 0,
        "processed_at": datetime.now().isoformat(),
    }


def write_outputs(results: list[dict]) -> tuple[str, str]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = ARTIFACTS_DIR / f"proof_{timestamp}.csv"
    json_path = ARTIFACTS_DIR / f"proof_{timestamp}.json"

    with csv_path.open("w", newline="") as output_file:
        writer = csv.writer(output_file)
        writer.writerow(
            [
                "docket_number",
                "hearing_date",
                "hearing_time",
                "office",
                "event_type",
                "courtroom",
                "bail_amount",
                "bail_type",
                "classification",
                "percentage",
                "posted",
                "bail_date",
                "bail_page",
                "pdf_hash",
                "pdf_acquisition",
                "source_reference",
                "http_requests",
                "status",
                "error",
            ]
        )

        for result in results:
            if result["observations"]:
                for observation in result["observations"]:
                    writer.writerow(
                        [
                            result["docket_number"],
                            result["hearing_date"],
                            result["hearing_time"],
                            result["office"],
                            result["event_type"],
                            result.get("courtroom"),
                            observation["amount"],
                            observation["bail_type"],
                            observation["classification"],
                            observation["percentage"],
                            observation.get("posted"),
                            observation.get("date"),
                            observation["page"],
                            result["pdf_hash"],
                            result["pdf_acquisition"],
                            result["source_reference"],
                            result["http_requests"],
                            result["status"],
                            result["error"],
                        ]
                    )
            else:
                writer.writerow(
                    [
                        result["docket_number"],
                        result["hearing_date"],
                        result["hearing_time"],
                        result["office"],
                        result["event_type"],
                        result.get("courtroom"),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        result["pdf_hash"],
                        result["pdf_acquisition"],
                        result["source_reference"],
                        result["http_requests"],
                        result["status"],
                        result["error"],
                    ]
                )

    json_path.write_text(json.dumps(results, indent=2, default=str))
    return str(csv_path), str(json_path)


def main() -> None:
    print("=" * 70)
    print("Six-row saved-job PDF retrieval and bail candidate extraction")
    print("=" * 70)

    try:
        validate_proof_rows(PROOF_ROWS)
    except RuntimeError as error:
        raise SystemExit(str(error)) from error

    if "--list-only" in sys.argv:
        print(json.dumps(
            [
                {
                    "position": position,
                    "docket_number": row["docket_number"],
                    "hearing_date": row["hearing_date"],
                    "hearing_time": row["hearing_time"],
                    "office": row["office"],
                    "event_type": row["event_type"],
                    "courtroom": row["courtroom"],
                }
                for position, row in enumerate(PROOF_ROWS)
            ],
            indent=2,
        ))
        return

    results = []
    stop_reason = None
    for index, row in enumerate(PROOF_ROWS):
        if stop_reason:
            results.append(deferred_result(row, index, stop_reason))
            continue
        result = process_docket(row, index, len(PROOF_ROWS))
        results.append(result)
        if result["stop_collection"]:
            stop_reason = result["error"] or "Stopped after a source condition."

    csv_path, json_path = write_outputs(results)
    counts = {}
    for result in results:
        counts[result["status"]] = counts.get(result["status"], 0) + 1
    monetary_total = sum(
        observation["amount"]
        for result in results
        if result["status"] == "candidate_extracted"
        for observation in result["observations"]
        if observation["classification"] == "monetary"
        and observation["amount"] is not None
    )
    unsecured_total = sum(
        observation["amount"]
        for result in results
        if result["status"] == "unsecured_only"
        for observation in result["observations"]
        if observation["amount"] is not None
    )
    errors = [
        {"docket_number": result["docket_number"], "status": result["status"], "error": result["error"]}
        for result in results
        if result["status"]
        in {"error", "extraction_error", "source_stopped", "deferred_after_source_stop"}
    ]
    print(f"\nHTTP requests made: {_request_count}")
    print(f"Summary: {json.dumps(counts, sort_keys=True)}")
    print(f"Total monetary bail candidates: ${monetary_total:,}")
    print(f"Latest unsecured-only amount, excluded from monetary total: ${unsecured_total:,}")
    print(f"Errors: {json.dumps(errors) if errors else 'none'}")
    print(f"CSV:  {csv_path}")
    print(f"JSON: {json_path}")
    if stop_reason:
        print(f"Stopped collection: {stop_reason}")
        raise SystemExit(1)
    if any(result["status"] in {"error", "extraction_error"} for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    if "--cached-json" in sys.argv:
        cached_json()
    else:
        main()
