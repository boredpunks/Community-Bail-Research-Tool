"""One already-granted regression PDF via the integrated urllib client."""
import asyncio
import hashlib
import json
from pathlib import Path
import sys
from public_http import download
from source_protocol import classify_response
from evidence import extract_bail

# Expectations supplied by the operator for these real source dockets only.
EXPECTED = [
    ("MJ-05003-CR-0004964-2026", "MONETARY", 500000, "NOT_SHOWN"),
    ("MJ-05003-CR-0005460-2026", "UNSECURED", 100000, "SHOWN_POSTED"),
    ("MJ-05003-CR-0004796-2026", "UNSECURED", 500000, "SHOWN_POSTED"),
    ("CP-02-CR-0005298-2024", "DENIED", 0, None),
]


def verify(directory):
    results = []
    for docket, category, amount, posted in EXPECTED:
        file = Path(directory) / f"{docket}.pdf"
        if not file.is_file():
            results.append({"docket": docket, "passed": False, "error": "REAL_SOURCE_PDF_NOT_RETRIEVED"})
            continue
        parsed = extract_bail(file.read_bytes(), docket)
        passed = (parsed["extractionOutcome"] == "EXTRACTED"
                  and any(row["bailCategory"] == category and row["amountCents"] == amount
                          for row in parsed["entries"])
                  and (posted is None or parsed["postedEntryState"] == posted))
        results.append({"docket": docket, "passed": passed,
                        "extractionOutcome": parsed["extractionOutcome"],
                        "postedEntryState": parsed["postedEntryState"],
                        "observedEntries": [{key: row[key] for key in ("action", "bailCategory", "amountCents")}
                                            for row in parsed["entries"]]})
    return {"verified": all(row["passed"] for row in results), "results": results}


async def main():
    url, destination = sys.argv[1:]
    response = None
    try:
        response = await download(url)
        body = await response.body()
        outcome = classify_response(response.status, response.headers, body, pdf=True)
        if outcome == "OK":
            Path(destination).parent.mkdir(parents=True, exist_ok=True)
            Path(destination).write_bytes(body)
        print(json.dumps({"status": response.status, "outcome": outcome,
                          "retryAfter": response.headers.get("retry-after"),
                          "sha256": hashlib.sha256(body).hexdigest() if outcome == "OK" else None}))
    except Exception:
        print(json.dumps({"status": None, "outcome": "NETWORK_ERROR"}))
    finally:
        if response:
            await response.dispose()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "verify":
        result = verify(sys.argv[2])
        print(json.dumps(result))
        sys.exit(0 if result["verified"] else 1)
    asyncio.run(main())
