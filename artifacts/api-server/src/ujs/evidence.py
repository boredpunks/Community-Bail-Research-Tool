"""Minimal, fail-closed parsing of demonstrated Common Pleas source layouts."""
from datetime import datetime
from decimal import Decimal
from html.parser import HTMLParser
import re
from urllib.parse import parse_qs, urlsplit

import pymupdf

DOCKET = re.compile(r"CP-02-CR-\d{7}-\d{4}")


def iso_date(text):
    try:
        return datetime.strptime(text, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def validate_event_date(text, criteria):
    calendar_date = iso_date(text.split()[0]) if text else None
    if calendar_date is None:
        raise ValueError("UNSUPPORTED_EVENT_DATE_LAYOUT")
    if not criteria["startDate"] <= calendar_date <= criteria["endDate"]:
        raise ValueError("CALENDAR_EVENT_DATE_OUTSIDE_REQUESTED_WINDOW")
    return calendar_date


class CalendarResults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = self.in_row = self.in_cell = False
        self.table_found = False
        self.headers = []
        self.rows = []
        self.has_remote_pagination = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and a.get("id") == "caseSearchResultGrid":
            self.table_found = self.in_table = True
        if self.in_table and tag == "tr":
            self.in_row = True
            self.cells, self.link = [], None
        if self.in_row and tag in ("td", "th"):
            self.in_cell = True
            self.cells.append("")
            self.is_header = tag == "th"
        if self.in_row and tag == "a" and a.get("href", "").startswith("/Report/CpDocketSheet?"):
            self.link = a["href"]
        if tag == "a" and re.search(r"(?:pageNumber|pageIndex|page=)", a.get("href", ""), re.I):
            self.has_remote_pagination = True

    def handle_data(self, text):
        if self.in_cell and self.cells:
            self.cells[-1] += text

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.in_cell = False
        if tag == "tr" and self.in_row:
            if self.cells and getattr(self, "is_header", False):
                self.headers = [cell.strip() for cell in self.cells]
            elif self.cells:
                self.rows.append((self.cells, self.link))
            self.in_row = False
        if tag == "table":
            self.in_table = False

    def validated(self, criteria):
        if not self.table_found:
            raise ValueError("RESULTS_NOT_VALIDATED")
        expected = {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                    9: "County", 10: "Court Office", 14: "Event Type"}
        if any(len(self.headers) <= i or not self.headers[i].startswith(label)
               for i, label in expected.items()):
            raise ValueError("UNSUPPORTED_CALENDAR_LAYOUT")
        result, seen = [], set()
        for cells, link in self.rows:
            if not link:
                raise ValueError("CALENDAR_DOCUMENT_LINK_MISSING")
            if len(cells) < 18:
                raise ValueError("UNSUPPORTED_CALENDAR_LAYOUT")
            docket = cells[2].strip()
            url = urlsplit(link)
            if (not DOCKET.fullmatch(docket) or url.path != "/Report/CpDocketSheet"
                    or url.netloc or parse_qs(url.query).get("docketNumber") != [docket]
                    or cells[9].strip() != "Allegheny"
                    or cells[10].strip() != criteria["courtOffice"]
                    or cells[14].strip() != criteria["eventType"]):
                raise ValueError("CALENDAR_IDENTITY_OR_COVERAGE_CONFLICT")
            event_date = cells[16].strip()
            validate_event_date(event_date, criteria)
            if docket in seen:
                # Validate even repeated rows before first-seen deduplication.
                continue
            seen.add(docket)
            result.append({
                "docketNumber": docket, "position": len(result),
                "sourceUrl": "https://ujsportal.pacourts.us" + link,
                "eventDate": event_date or None,
                "filingDate": iso_date(cells[6].strip()),
            })
        return result


def calendar_result_state(validated_table, parsed_rows, explicit_empty_state):
    """A bare form/table with no parsed row is never treated as an empty search."""
    if not validated_table:
        return "RESULTS_NOT_VALIDATED"
    if parsed_rows:
        return "RESULTS_VALIDATED"
    if explicit_empty_state:
        return "EMPTY_RESULTS_VALIDATED"
    return "RESULTS_NOT_VALIDATED"


def extract_bail(body, docket):
    base = {"entries": [], "postedEntryState": "UNKNOWN", "excerpt": None}
    if not body.startswith(b"%PDF-"):
        return dict(base, extractionOutcome="UNREADABLE", detail="Source did not return a PDF.")
    try:
        with pymupdf.open(stream=body, filetype="pdf") as document:
            if document.page_count > 100:
                return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT", detail="Document page limit exceeded.")
            pages = [page.get_text(sort=True) for page in document]
    except Exception:
        return dict(base, extractionOutcome="UNREADABLE", detail="PDF could not be read.")
    if not pages or not pages[0].strip():
        return dict(base, extractionOutcome="UNREADABLE", detail="No readable document text; OCR is not enabled.")
    first = pages[0][:2500]
    identifiers = DOCKET.findall(first)
    if (not identifiers or identifiers[0] != docket
            or not re.search(r"COURT OF COMMON PLEAS OF\s+ALLEGHENY COUNTY", first, re.I)):
        return dict(base, extractionOutcome="IDENTITY_MISMATCH", detail="Court/docket header did not match the calendar row.")
    bail_pages = [page for page in pages if "BAIL INFORMATION" in page]
    if not bail_pages:
        return dict(base, extractionOutcome="MISSING_BAIL_SECTION", detail="Readable matching docket has no bail section. Bail and custody remain unknown.")
    sections = []
    for page in bail_pages:
        section = page[page.find("BAIL INFORMATION"):]
        end = re.search(
            r"\n\s*(?:DEFENDANT INFORMATION|CHARGES|DISPOSITION|DOCKET ENTRY INFORMATION|"
            r"CASE FINANCIAL INFORMATION|ATTORNEY INFORMATION|CALENDAR EVENTS|STATUS INFORMATION|"
            r"COMMONWEALTH INFORMATION|CASE PARTICIPANTS|COMMONWEALTH OF PENNSYLVANIA|CPCMS\s+\d+)\b",
            section,
        )
        if end:
            section = section[:end.start()]
        # The participant/Nebbia line is not needed to interpret bail.
        header = section.find("Bail Action")
        if header < 0:
            return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT", detail="Bail section exists but its table header is unsupported.")
        sections.append(section[header:].strip())
    section = "\n".join(sections)
    if len(section) > 4000:
        return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT", detail="Bail chronology exceeds the minimal excerpt limit; do not truncate it silently.")
    entries = []
    unknown_rows = []
    lines = section.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"^\s*(.*?)\s{2,}(\d{2}/\d{2}/\d{4})\s{2,}(.*?)\s*$", line)
        if not match:
            if re.search(r"\d{2}/\d{2}/\d{4}|\$[\d,]", line):
                unknown_rows.append(line)
            continue
        action, date, tail = match.groups()
        if action.count("(") > action.count(")") and index + 1 < len(lines):
            continuation = lines[index + 1].strip()
            if re.fullmatch(r"[A-Za-z -]+\)", continuation):
                action += " " + continuation
        words = re.sub(r"\s+", " ", tail).strip()
        # Never silently select one of two financial values in an unknown layout.
        # Multiple historical rows are expected; multiple amounts in ONE row are
        # an unsupported/ambiguous layout until verified against source evidence.
        if len(re.findall(r"\$[\d,]+\.\d{2}", tail)) > 1:
            unknown_rows.append(line)
        category, basis, amount = "UNKNOWN", None, None
        if re.search(r"\bNonmonetary\b", words, re.I):
            category = "NONMONETARY"
        elif re.search(r"\bRecognizance\b|\bROR\b", words, re.I):
            category = "RECOGNIZANCE"
        elif re.search(r"\bUnsecured\b", words, re.I):
            category, basis = "UNSECURED", "UNSECURED_AMOUNT"
        elif re.search(r"\bNominal\b", words, re.I):
            category, basis = "NOMINAL", "TOTAL_BAIL"
        elif re.search(r"\bMonetary\b", words, re.I):
            category, basis = "MONETARY", "TOTAL_BAIL"
        elif re.match(r"den(?:y|ied)", action, re.I):
            category = "DENIED"
        else:
            unknown_rows.append(line)
        if basis:
            # Percentage/deposit-bearing rows have not been demonstrated. Do not
            # assume that their displayed financial value is total bail.
            if re.search(r"\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s+\$", tail):
                unknown_rows.append(line)
            money = re.search(r"\$((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*$", tail)
            if money:
                amount = int(Decimal(money[1].replace(",", "")) * 100)
                if amount > 2147483647:
                    unknown_rows.append(line)
                    amount = None
        entries.append({"action": action.strip(), "wording": words,
                        "orderDate": iso_date(date), "bailCategory": category,
                        "amountCents": amount, "financialBasis": basis})
    if not entries or unknown_rows or any(entry["orderDate"] is None for entry in entries):
        return dict(base, excerpt=section, extractionOutcome="UNSUPPORTED_LAYOUT",
                    detail="Some bail rows could not be interpreted; no guessed amounts were saved.")
    # All source rows/chronology stay in the excerpt, including multiline action text.
    posted = "SHOWN_POSTED" if re.search(r"\bpost(?:ed|ing)\b", section, re.I) else "NOT_SHOWN"
    return {"entries": entries, "postedEntryState": posted, "excerpt": section,
            "extractionOutcome": "EXTRACTED",
            "detail": "Document identity matched. All bail entries remain provisional; no operative order or custody was inferred."}
