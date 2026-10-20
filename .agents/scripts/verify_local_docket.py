"""Inspect a user-supplied PDF offline; never import a network client."""
import argparse
import json
from pathlib import Path
import sys

import pymupdf


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--docket", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "artifacts/api-server/src/ujs"))
    from evidence import extract_bail

    body = args.pdf.read_bytes()
    args.output.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(stream=body, filetype="pdf") as document:
        for index in range(min(2, document.page_count)):
            document[index].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(
                args.output / f"page-{index + 1}.png"
            )
    result = extract_bail(body, args.docket)
    # No names, addresses, dates of birth, document excerpts or source URLs.
    report = {
        "verificationType": "LOCAL_DOCUMENT_ONLY",
        "sourceRequests": 0,
        "extractionOutcome": result["extractionOutcome"],
        "detail": result.get("detail"),
        "documentPageCount": result.get("documentPageCount"),
        "documentSha256": result.get("documentSha256"),
        "bailSectionPages": result.get("bailSectionPages"),
        "postedEntryState": result["postedEntryState"],
        "entries": [
            {key: entry.get(key) for key in (
                "action", "bailCategory", "financialBasis", "amountCents",
                "sourcePages",
            )}
            for entry in result["entries"]
        ],
    }
    (args.output / "extraction.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
