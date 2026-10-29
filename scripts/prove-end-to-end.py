# scripts/prove-end-to-end.py
"""
Task #76: End-to-End Proof (Calendar Search → PDF Fetch → Bail Extraction)

This is a one-row, direct HTTP proof runner. It does not use the application job
framework or its ACCESS_UNVERIFIED gate. Run only for the exact docket row
explicitly approved for this one-request check.

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
import sys
from datetime import datetime
from pathlib import Path

import fitz
import requests

BASE_URL = "https://ujsportal.pacourts.us"
USER_AGENT = "CommunityBailResearch-SourceAssessment/1.0"
MAX_PDF_SIZE = 4 * 1024 * 1024
CACHE_DIR = Path(".cache/community-bail-proof")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

PROOF_ROWS = [
    {
        "docket_number": "MJ-05247-CR-0000502-2025",
        "dnh": "bz3yc0mNGOMQzwUjpdqYQQ==",
        "sourceUrl": (
            "https://ujsportal.pacourts.us/Report/MdjDocketSheet"
            "?docketNumber=MJ-05247-CR-0000502-2025"
            "&dnh=bz3yc0mNGOMQzwUjpdqYQQ%3D%3D"
        ),
        "hearing_date": "2026-10-28",
        "hearing_time": "12:51 am",
        "office": "MDJ-05-2-47",
        "event_type": "Bail Hearing",
        "courtroom": None,
    },
]

ARTIFACTS_DIR = Path("artifacts")
ARTIFACTS_DIR.mkdir(exist_ok=True)


def classify_bail(bail_text: str) -> dict:
    """Classify text near a bail heading; this is a candidate, not validation."""
    result = {
        "classification": "ambiguous",
        "amount": None,
        "percentage": None,
        "posted": False,
        "bail_type": None,
    }
    text_lower = bail_text.lower()

    if any(
        term in text_lower
        for term in ("nonmonetary", "ror", "release on recognizance", "unsecured")
    ):
        result["classification"] = "nonmonetary"
        return result

    amount_match = re.search(r"\$?([\d,]+)", bail_text)
    if amount_match:
        result["classification"] = "monetary"
        result["amount"] = int(amount_match.group(1).replace(",", ""))
        if "cash" in text_lower:
            result["bail_type"] = "Cash"
        elif "surety" in text_lower:
            result["bail_type"] = "Surety"
        elif "bond" in text_lower:
            result["bail_type"] = "Bond"
        else:
            result["bail_type"] = "Monetary"

    pct_match = re.search(r"(\d+)\s*%", bail_text)
    if pct_match:
        result["percentage"] = int(pct_match.group(1))

    if any(term in text_lower for term in ("posted", "satisfied", "exonerated")):
        result["posted"] = True

    return result


def fetch_pdf(url: str) -> tuple[bytes, str, str]:
    """Use a validated cached PDF, or fetch once and cache before parsing."""
    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.pdf"

    if cache_file.exists():
        pdf_bytes = cache_file.read_bytes()
        if len(pdf_bytes) > MAX_PDF_SIZE or not pdf_bytes.startswith(b"%PDF-"):
            raise RuntimeError("Cached PDF failed validation; refusing another source request")
        print(f"      Using cached PDF: {cache_file}")
        return pdf_bytes, hashlib.sha256(pdf_bytes).hexdigest(), str(cache_file)

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
        if response.status_code == 401:
            raise RuntimeError("HTTP 401: Access denied")
        if response.status_code == 403:
            raise RuntimeError("HTTP 403: Forbidden")
        if response.status_code == 429:
            raise RuntimeError("HTTP 429: Rate limited; stop without retrying")
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")

        content_type = response.headers.get("Content-Type", "")
        if "application/pdf" not in content_type and "application/octet-stream" not in content_type:
            raise RuntimeError(f"Wrong Content-Type: {content_type}")

        chunks = []
        total = 0
        for chunk in response.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > MAX_PDF_SIZE:
                raise RuntimeError("PDF exceeds 4MB limit")
            chunks.append(chunk)

    pdf_bytes = b"".join(chunks)
    if not pdf_bytes.startswith(b"%PDF-"):
        raise RuntimeError("Invalid PDF header")

    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    temp_file = cache_file.with_suffix(".pdf.tmp")
    temp_file.write_bytes(pdf_bytes)
    temp_file.replace(cache_file)
    print(f"      Cached validated PDF: {cache_file}")
    return pdf_bytes, pdf_hash, str(cache_file)


def extract_bail(pdf_bytes: bytes, expected_docket: str) -> list[dict]:
    """Bind dates and amounts in bail rows; require exact docket identity."""
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    observations = []

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
        pdf_docket = docket_match.group(1) if docket_match else None
        if pdf_docket != expected_docket:
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
        ):
            marker_pos = upper_text.find(marker, bail_start + len(heading))
            if marker_pos >= 0:
                section_end = min(section_end, marker_pos)
        bail_section = page_text[bail_start:section_end]

        date_matches = list(
            re.finditer(r"(?<!\d)(\d{1,2}/\d{1,2}/\d{4})(?!\d)", bail_section)
        )
        bail_rows = []
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
            if not amount_matches:
                continue

            amount_match = amount_matches[-1]
            amount_text = amount_match.group(1).replace(",", "")
            cents = amount_match.group(2) or "00"
            amount = int(amount_text) if cents == "00" else float(f"{amount_text}.{cents}")
            if amount <= 0:
                continue

            row_lower = row_text.lower()
            is_nonmonetary = "nonmonetary" in row_lower or "ror" in row_lower
            bail_type = "Nonmonetary" if is_nonmonetary else "Monetary"
            if "cash" in row_lower:
                bail_type = "Cash"
            elif "surety" in row_lower:
                bail_type = "Surety"
            pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", row_text)

            try:
                parsed_date = datetime.strptime(date_match.group(1), "%m/%d/%Y").date()
            except ValueError:
                continue

            bail_rows.append(
                {
                    "date": parsed_date.isoformat(),
                    "date_sort": parsed_date,
                    "amount": amount,
                    "bail_type": bail_type,
                    "percentage": float(pct_match.group(1)) if pct_match else None,
                    "quote": row_text[:500],
                    "classification": "monetary" if not is_nonmonetary else "nonmonetary",
                    "posted": None,
                }
            )

        monetary_rows = [row for row in bail_rows if row["classification"] == "monetary"]
        if monetary_rows:
            latest = max(monetary_rows, key=lambda row: row["date_sort"])
            latest.pop("date_sort")
            latest["page"] = page_num + 1
            observations.append(latest)

    document.close()
    return observations


def process_docket(row: dict, index: int, total: int) -> dict:
    result = {
        "index": index,
        "docket_number": row["docket_number"],
        "hearing_date": row["hearing_date"],
        "hearing_time": row.get("hearing_time"),
        "office": row["office"],
        "event_type": row["event_type"],
        "courtroom": row.get("courtroom"),
        "sourceUrl": row["sourceUrl"],
        "status": "pending",
        "error": None,
        "observations": [],
        "bail_amounts": [],
        "pdf_hash": None,
        "pdf_cache_path": None,
        "processed_at": datetime.now().isoformat(),
    }

    try:
        print(f"\n[{index + 1}/{total}] {result['docket_number']}")
        print("      Fetching PDF (single request; no retry)...")
        pdf_bytes, pdf_hash, pdf_cache_path = fetch_pdf(row["sourceUrl"])
        result["pdf_hash"] = pdf_hash
        result["pdf_cache_path"] = pdf_cache_path
        print(f"      PDF received: {len(pdf_bytes):,} bytes ({pdf_hash[:16]}...)")

        print("      Extracting candidate bail text...")
        observations = extract_bail(pdf_bytes, row["docket_number"])
        result["observations"] = observations

        if observations:
            result["bail_amounts"] = [
                observation["amount"]
                for observation in observations
                if observation["amount"] is not None
            ]
            result["status"] = "candidate_extracted"
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
            print("      Verify the quoted docket identity and bail terms manually.")
        else:
            result["status"] = "no_verified_bail_text"
            print("      No identity-matched bail observation found.")
    except Exception as error:
        result["status"] = "error"
        result["error"] = str(error)
        print(f"      Error: {error}")

    return result


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
                        result["status"],
                        result["error"],
                    ]
                )

    json_path.write_text(json.dumps(results, indent=2, default=str))
    return str(csv_path), str(json_path)


def main() -> None:
    print("=" * 70)
    print("Single-docket MDJ PDF retrieval and candidate extraction")
    print("=" * 70)

    if len(PROOF_ROWS) != 1:
        raise SystemExit("This runner is limited to exactly one explicitly approved row.")

    row = PROOF_ROWS[0]
    expected_url = (
        f"{BASE_URL}/Report/MdjDocketSheet"
        "?docketNumber=MJ-05247-CR-0000502-2025"
        "&dnh=bz3yc0mNGOMQzwUjpdqYQQ%3D%3D"
    )
    if row["docket_number"] != "MJ-05247-CR-0000502-2025" or row["sourceUrl"] != expected_url:
        raise SystemExit("Refusing to fetch: row does not match the approved MDJ docket and URL.")

    result = process_docket(row, 0, 1)
    csv_path, json_path = write_outputs([result])
    print(f"\nCSV:  {csv_path}")
    print(f"JSON: {json_path}")

    if result["status"] == "error":
        raise SystemExit(1)
    if result["status"] == "candidate_extracted":
        print("\nRetrieval succeeded; extraction remains a candidate pending manual review.")
        return

    print("\nRetrieval completed, but no identity-matched bail text was found.")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
