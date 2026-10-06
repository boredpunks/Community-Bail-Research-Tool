"""Render selected briefing pages for source-reading checks, never import cases."""
from pathlib import Path
import sys
import pymupdf as fitz

document = fitz.open(sys.argv[1])
output = Path(".agents/outputs/bail-briefing")
output.mkdir(parents=True, exist_ok=True)
print(f"Briefing pages: {document.page_count}")
for page_index in [0, 5, 6, 11]:
    if page_index < document.page_count:
        page = document[page_index]
        path = output / f"page-{page_index + 1}.png"
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(path)
        print(path)
