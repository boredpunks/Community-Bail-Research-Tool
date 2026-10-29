import json
import re
from pathlib import Path

import fitz


proof_path = Path("artifacts/proof_20261029_073354.json")
output_dir = Path(".agents/outputs/bail-proof")
output_dir.mkdir(parents=True, exist_ok=True)
results = json.loads(proof_path.read_text())

for result in results:
    pdf_path = Path(result["pdf_cache_path"])
    document = fitz.open(pdf_path)
    matching_pages = []
    for page_index, page in enumerate(document):
        text = page.get_text()
        has_bail_heading = "BAIL INFORMATION" in text or re.search(
            r"^BAIL\s*$", text, re.MULTILINE
        )
        has_identity = result["docket_number"].lower() in text.lower()
        if has_bail_heading and has_identity:
            matching_pages.append(page_index)

    if not matching_pages:
        observation_pages = [
            observation["page"] - 1 for observation in result["observations"]
        ]
        matching_pages = observation_pages or [0]

    rendered = []
    for page_index in matching_pages:
        output = output_dir / f"row-{result['index']:02d}-page-{page_index + 1:02d}.png"
        pixmap = document[page_index].get_pixmap(
            matrix=fitz.Matrix(1.8, 1.8),
            alpha=False,
        )
        pixmap.save(output)
        rendered.append(str(output))

    print(
        json.dumps(
            {
                "position": result["index"],
                "docket": result["docket_number"],
                "pages": [index + 1 for index in matching_pages],
                "images": rendered,
            }
        )
    )
    document.close()
