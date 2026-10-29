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


def fetch_pdf(url: str) -> tuple[bytes, str]:
    """Fetch exactly once, without redirects or automatic retries."""
    response = requests.get(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,application/octet-stream",
        },
        timeout=30,
        allow_redirects=False,
        stream=True,
    )

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

    return pdf_bytes, hashlib.sha256(pdf_bytes).hexdigest()


def extract_bail(pdf_bytes: bytes, expected_docket: str) -> list[dict]:
    """Extract candidate bail-table lines, requiring an exact docket identity."""
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

        lines = page_text.split("\n")
        in_bail_section = False
        bail_amounts = []

        for line in lines:
            if heading in line or (heading == "BAIL" and line.strip() == "BAIL"):
                in_bail_section = True
                continue

            if not in_bail_section:
                continue

            amount_match = re.search(r"\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.00)?", line)
            if amount_match:
                amount = int(amount_match.group(1).replace(",", ""))
                if amount > 0:
                    line_lower = line.lower()
                    is_nonmonetary = "nonmonetary" in line_lower or "ror" in line_lower
                    pct_match = re.search(r"(\d+)\s*%", line)
                    bail_type = "Monetary"
                    if "cash" in line_lower:
                        bail_type = "Cash"
                    elif "surety" in line_lower:
                        bail_type = "Surety"
                    elif is_nonmonetary:
                        bail_type = "Nonmonetary"

                    bail_amounts.append(
                        {
                            "page": page_num + 1,
                            "amount": amount,
                            "bail_type": bail_type,
                            "percentage": int(pct_match.group(1)) if pct_match else None,
                            "quote": line.strip()[:500],
                            "classification": (
                                "nonmonetary" if is_nonmonetary else "monetary"
                            ),
                            "posted": None,
                        }
                    )

            if any(
                heading_text in line.upper()
                for heading_text in (
                    "CHARGES",
                    "DEFENDANT INFORMATION",
                    "CONFINEMENT",
                    "CASE PARTICIPANTS",
                )
            ):
                break

        if bail_amounts:
            observations.append(bail_amounts[-1])

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
        "processed_at": datetime.now().isoformat(),
    }

    try:
        print(f"\n[{index + 1}/{total}] {result['docket_number']}")
        print("      Fetching PDF (single request; no retry)...")
        pdf_bytes, pdf_hash = fetch_pdf(row["sourceUrl"])
        result["pdf_hash"] = pdf_hash
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
                    f"({observation['bail_type']}{pct}), page {observation['page']}"
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
