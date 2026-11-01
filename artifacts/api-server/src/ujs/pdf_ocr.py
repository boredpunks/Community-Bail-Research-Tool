"""Bounded, local-only OCR transcripts. OCR never establishes a bail amount."""
import csv
import io
import math
import os
import re
import shutil
import subprocess
import time

import pymupdf

OCR_BUDGET_SECONDS = 60
OCR_PAGE_SECONDS = 20
MAX_TRANSCRIPT_CHARS = 4000


def ordered_ocr_text(output):
    """Use word geometry: Tesseract's plain-text block order can move tables."""
    words = []
    for row in csv.DictReader(io.StringIO(output.decode("utf-8", errors="replace")), delimiter="\t"):
        if row.get("level") != "5" or not row.get("text", "").strip():
            continue
        left, top, height = (int(row[key]) for key in ("left", "top", "height"))
        if left < 0 or top < 0 or height <= 0:
            raise ValueError("Invalid OCR word geometry.")
        words.append((top + height / 2, left, height, row["text"].strip()))
    lines = []
    for word in sorted(words):
        center, left, height, text = word
        if not lines or abs(lines[-1][0] - center) > max(3, min(lines[-1][1], height) * .45):
            lines.append([center, height, [(left, text)]])
        else:
            lines[-1][2].append((left, text))
    return "\n".join(" ".join(text for _, text in sorted(line[2])) for line in lines)


def fill_scanned_pages(document, pages):
    """Fill textless pages, without sending document bytes to another service."""
    missing = [index for index, text in enumerate(pages) if not text.strip()]
    if not missing:
        return pages, False, None
    engine = shutil.which("tesseract")
    if not engine:
        return pages, False, "Local OCR is unavailable; scanned pages could not be read."
    pages = list(pages)
    used = False
    deadline = time.monotonic() + OCR_BUDGET_SECONDS
    for index in missing:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return pages, used, "OCR processing limit reached; the transcript is incomplete."
        page = document[index]
        # Bound raster memory as well as subprocess time, including oversized PDFs.
        area = page.rect.width * page.rect.height
        if area <= 0:
            return pages, used, "A scanned page has invalid dimensions."
        scale = min(220 / 72, math.sqrt(8_000_000 / area))
        try:
            image = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            result = subprocess.run(
                [engine, "stdin", "stdout", "-l", "eng", "--psm", "3", "tsv"],
                input=image.tobytes("png"), capture_output=True,
                timeout=min(OCR_PAGE_SECONDS, remaining),
                # Tesseract's default thread fan-out can be slower on shared CPUs.
                env={**os.environ, "OMP_THREAD_LIMIT": "1"},
            )
            if result.returncode != 0 or len(result.stdout) > 256_000:
                return pages, used, "Local OCR could not read every scanned page."
            text = ordered_ocr_text(result.stdout)
            if text.strip():
                pages[index] = text
                used = True
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
            return pages, used, "Local OCR stopped before every scanned page was read."
    return pages, used, None


def bail_transcript(pages, base, notice=None, ocr_assisted=True):
    """Retain only the bail-setting text; do not infer financial observations."""
    excerpts, locations = [], []
    for number, text in enumerate(pages, 1):
        # OCR can retain table-border glyphs beside otherwise readable labels.
        # These labels only bound an unvalidated transcript, never numeric data.
        heading = re.search(r"\bBAIL\s+INFORMATION\b", text, re.I) or re.search(
            r"(?im)^[\s|]*BAIL[\s|]*$", text)
        if not heading:
            continue
        section = text[heading.end():]
        end = re.search(
            r"(?im)(?:\bBail\s+Posted\b|^[\s|]*(?:CHARGES\b|DEFENDANT INFORMATION\b|"
            r"DOCKET ENTR(?:Y|IES)\b|ATTORNEY INFORMATION\b|CASE INFORMATION\b|"
            r"CASE PARTICIPANTS\b|CALENDAR EVENTS\b|SCHEDULED EVENTS\b|"
            r"CONFINEMENT\b|CASE FINANCIAL INFORMATION\b|CPCMS\b|MDJS\b|Printed:))",
            section,
        )
        if end:
            section = section[:end.start()]
        # Avoid names/Nebbia material above the setting-column labels.
        columns = re.search(r"\bBail\s+Action\b", section, re.I)
        if columns:
            excerpts.append(section[columns.start():].strip())
            locations.append(number)
    excerpt = "\n\n".join(excerpts)
    detail = ("OCR-assisted text" if ocr_assisted else "Extracted PDF text")
    detail += " is unvalidated. Compare it with the original PDF before interpreting bail amounts or classifications."
    if not excerpt:
        detail += " No complete bail-setting transcript could be located."
    if len(excerpt) > MAX_TRANSCRIPT_CHARS:
        excerpt = excerpt[:MAX_TRANSCRIPT_CHARS]
        detail += " The displayed transcript is truncated; consult the original for the full chronology."
    if notice:
        detail += " " + notice
    return dict(base, entries=[], postedEntryState="UNKNOWN",
                extractionOutcome="UNSUPPORTED_LAYOUT", excerpt=excerpt or None,
                bailSectionPages=locations, detail=detail)
