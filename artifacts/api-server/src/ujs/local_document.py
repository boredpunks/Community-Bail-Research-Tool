"""Read one local upload from stdin. No network imports or requests."""
import json
import re
import sys
import pymupdf
from evidence import extract_bail

body = sys.stdin.buffer.read(4_000_001)
if len(body) > 4_000_000:
    raise ValueError("Local PDF exceeds the four-million-byte limit.")
with pymupdf.open(stream=body, filetype="pdf") as document:
    if not 1 <= document.page_count <= 100:
        raise ValueError("PDF page limit exceeded.")
    first = document[0].get_text(sort=True)
identities = re.findall(r"Docket\s+Number\s*:\s*((?:MJ-\d{5}-(?:CR|NT)|CP-02-CR)-\d{7}-\d{4})", first)
if len(set(identities)) != 1:
    raise ValueError("A unique supported docket header is required.")
docket = identities[0]
if docket.startswith("MJ-") and (not docket.startswith("MJ-05") or not re.search(r"County:\s+Allegheny\b", first)):
    raise ValueError("Only verified Allegheny documents are supported.")
expected = sys.argv[1] if len(sys.argv) > 1 else ""
if expected and expected != docket:
    raise ValueError("Uploaded document identity does not match the selected docket.")
result = extract_bail(body, docket)
if result["extractionOutcome"] in ("IDENTITY_MISMATCH", "UNREADABLE"):
    raise ValueError("Document identity or readability verification failed.")
print(json.dumps({"docketNumber": docket, "courtType": "MDJ" if docket.startswith("MJ-") else "COMMON_PLEAS", **result}))
