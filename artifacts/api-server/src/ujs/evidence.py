"""Minimal, fail-closed parsing of demonstrated Common Pleas source layouts."""
from datetime import datetime
from decimal import Decimal
from html.parser import HTMLParser
import hashlib
import re
from urllib.parse import parse_qs, urlsplit

import pymupdf

DOCKET = re.compile(r"CP-02-CR-\d{7}-\d{4}")
CALENDAR_AUDIT_HEADERS = [
    "Docket Number", "Court Type", "Filing Date", "County", "Court Office",
    "Event Type",
]


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


def calendar_date_fields(cells, criteria):
    """Date-only projection of a result row for the parent protocol."""
    return {
        "eventDate": validate_event_date(cells[16].strip(), criteria),
        "filingDate": iso_date(cells[6].strip()),
    }


class CalendarResults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = self.in_row = self.in_cell = False
        self.table_found = False
        self.headers = []
        self.validated_column_headers = None
        self.rows = []
        self.has_remote_pagination = False
        self.validated_row_count = 0
        self.scope_validated = False
        self.dates_validated = False
        self.explicit_empty_state = False
        self._table_depth = 0
        self._result_depth = None
        self._table_count = 0
        self._header_rows = 0
        self._presentation_rows = 0
        self._recognized_links = 0
        self._malformed = False
        self._row_observations = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self._table_depth += 1
            if self.in_table:
                self._malformed = True
            if a.get("id") == "caseSearchResultGrid":
                self._table_count += 1
                self.table_found = True
                if self._result_depth is None:
                    self._result_depth = self._table_depth
                    self.in_table = True
        if self.in_table and self._table_depth == self._result_depth:
            if tag == "tr":
                if self.in_row:
                    self._malformed = True
                self.in_row = True
                self.in_cell = False
                self.cells, self.link = [], None
                self._cell_types, self._cell_spans, self._links = [], [], []
                self._all_hrefs, self._interactive = [], 0
            elif self.in_row and tag in ("td", "th"):
                if self.in_cell:
                    self._malformed = True
                self.in_cell = True
                self.cells.append("")
                self._cell_types.append(tag)
                try:
                    span = int(a.get("colspan", "1"))
                    row_span = int(a.get("rowspan", "1"))
                except (TypeError, ValueError):
                    span, row_span = 0, 0
                if not 1 <= span <= 128 or row_span != 1:
                    self._malformed = True
                self._cell_spans.append(span)
            elif self.in_row and tag == "a" and a.get("href", "").startswith("/Report/CpDocketSheet?"):
                href = a["href"]
                self._recognized_links += 1
                if href not in self._links:
                    self._links.append(href)
                self.link = href
                if len(self._links) > 1:
                    self._malformed = True
            if self.in_row and tag == "a":
                self._all_hrefs.append(a.get("href", ""))
            if self.in_row and (tag in ("button", "input") or "onclick" in a):
                self._interactive += 1
        if tag == "a" and re.search(r"(?:pageNumber|pageIndex|page=)", a.get("href", ""), re.I):
            self.has_remote_pagination = True

    def handle_data(self, text):
        if self.in_cell and self.cells and self._table_depth == self._result_depth:
            self.cells[-1] += text

    def handle_endtag(self, tag):
        if self.in_table and self._table_depth == self._result_depth:
            if tag in ("td", "th"):
                if not self.in_cell or not self._cell_types or self._cell_types[-1] != tag:
                    self._malformed = True
                self.in_cell = False
            elif tag == "tr" and self.in_row:
                if self.in_cell:
                    self._malformed = True
                kinds = set(self._cell_types)
                if kinds == {"th"}:
                    self._header_rows += 1
                    if any(span != 1 for span in self._cell_spans):
                        self._malformed = True
                    self.headers = [cell.strip() for cell in self.cells]
                elif kinds == {"td"}:
                    self._row_observations.append(calendar_row_observation(
                        self.cells, self._cell_spans, self._all_hrefs, self._interactive))
                    if len(self.cells) == 1 and self._cell_spans[0] > 1 and not self._links:
                        self._presentation_rows += 1
                    # Presentation-shaped rows remain unverified, never empty proof.
                    self.rows.append((self.cells, self.link))
                    if len(self.cells) > 1 and any(span != 1 for span in self._cell_spans):
                        self._malformed = True
                elif kinds:
                    self._malformed = True
                self.in_row = self.in_cell = False
        if tag == "table":
            if self._table_depth == self._result_depth:
                if self.in_row or self.in_cell:
                    self._malformed = True
                self.in_table = False
                self._result_depth = None
            self._table_depth = max(0, self._table_depth - 1)

    def layout_summary(self):
        """Local structural evidence only; never source text, identifiers or URLs.

        This is not a result-acceptance decision or a parent wire envelope.
        """
        counts = {
            "resultTables": self._table_count,
            "headerRows": self._header_rows,
            "nonHeaderRows": len(self.rows),
            "presentationRows": self._presentation_rows,
            "recognizedDocumentLinks": self._recognized_links,
        }
        return {**{key: min(10_000, value) for key, value in counts.items()},
                "overflow": any(value > 10_000 for value in counts.values()),
                "malformed": self._malformed,
                "complete": self.table_found and not self.in_table and not self.in_row}

    def contract_observation(self):
        return {"kind": "calendar_layout", "version": 1, **self.layout_summary(),
                "rows": self._row_observations[:8],
                "rowsOmitted": len(self._row_observations) > 8}

    def validated(self, criteria):
        if not self.table_found:
            raise ValueError("RESULTS_NOT_VALIDATED")
        # Never combine separate grids or accept a partial/ambiguous parse.
        if (self._table_count != 1 or self._header_rows != 1 or self._malformed
                or self.in_table or self.in_row or self.in_cell):
            raise ValueError("UNSUPPORTED_CALENDAR_LAYOUT")
        event_type_filter = criteria.get("eventType")
        if event_type_filter in ("", "ANY"):
            event_type_filter = None
        expected = {2: "Docket Number", 3: "Court Type", 6: "Filing Date",
                    9: "County", 10: "Court Office", 14: "Event Type"}
        if any(len(self.headers) <= i or not self.headers[i].startswith(label)
               for i, label in expected.items()):
            raise ValueError("UNSUPPORTED_CALENDAR_LAYOUT")
        # A single, exact source status row is an explicit empty result only
        # when it spans the demonstrated 19-column grid and contains no
        # docket, link, or interactive control. Unknown/presentation rows
        # remain rejected rather than being silently skipped.
        if len(self.rows) == 1 and len(self._row_observations) == 1:
            row = self._row_observations[0]
            links = row["links"]
            if (self._presentation_rows == 1 and row["shape"] == "PRESENTATION_SHAPED" and row["cells"] == 1
                    and row["spanTotal"] == len(self.headers) == 19
                    and row["statusLabel"] in {
                        "NO_RECORDS_FOUND", "NO_RESULTS_FOUND", "NO_DATA_AVAILABLE",
                        "NO_MATCHING_RECORDS",
                    }
                    and row["interactive"] == 0 and not row["docketShapedCell"]
                    and not any(links.values()) and not self._malformed):
                self.explicit_empty_state = True
                self.validated_row_count = 1
                self.validated_column_headers = list(CALENDAR_AUDIT_HEADERS)
                return []
        result, seen = [], set()
        for cells, link in self.rows:
            if not link:
                raise ValueError("CALENDAR_DOCUMENT_LINK_MISSING")
            if len(cells) < 18:
                raise ValueError("UNSUPPORTED_CALENDAR_LAYOUT")
            docket = cells[2].strip()
            event_type = cells[14].strip()
            url = urlsplit(link)
            if (not DOCKET.fullmatch(docket) or url.path != "/Report/CpDocketSheet"
                    or url.netloc or parse_qs(url.query).get("docketNumber") != [docket]
                    or cells[9].strip() != "Allegheny"
                    or cells[10].strip() != criteria["courtOffice"]
                    or not event_type
                    or event_type_filter is not None and event_type != event_type_filter):
                raise ValueError("CALENDAR_IDENTITY_OR_COVERAGE_CONFLICT")
            date_fields = calendar_date_fields(cells, criteria)
            if docket in seen:
                # Validate even repeated rows before first-seen deduplication.
                continue
            seen.add(docket)
            result.append({
                "docketNumber": docket, "position": len(result),
                "sourceUrl": "https://ujsportal.pacourts.us" + link,
                **date_fields,
                "eventType": event_type,
            })
        if self.rows:
            self.validated_row_count = len(self.rows)
            self.scope_validated = True
            self.dates_validated = True
        # Emit only allowlisted public label prefixes, never arbitrary header
        # text or any cell values, as preview audit metadata.
        self.validated_column_headers = list(CALENDAR_AUDIT_HEADERS)
        return result


def calendar_row_observation(cells, spans, hrefs, interactive):
    """A bounded structural projection, not a result acceptance decision."""
    status_labels = {
        "no records found": "NO_RECORDS_FOUND",
        "no records found.": "NO_RECORDS_FOUND",
        "no results found": "NO_RESULTS_FOUND",
        "no results found.": "NO_RESULTS_FOUND",
        "no data available in table": "NO_DATA_AVAILABLE",
        "no matching records found": "NO_MATCHING_RECORDS",
    }
    text = " ".join(cells[0].split()).lower() if len(cells) == 1 else ""
    links = {key: 0 for key in ("relativeDocket", "absoluteSourceDocket",
                               "other", "identityMatched", "strictQuery")}
    docket = cells[2].strip() if len(cells) > 2 else ""
    for href in hrefs:
        try:
            url = urlsplit(href)
            query = parse_qs(url.query, keep_blank_values=True)
            relative = not url.scheme and not url.netloc and href.startswith("/")
            absolute = url.scheme == "https" and url.netloc == "ujsportal.pacourts.us"
            route = url.path == "/Report/CpDocketSheet" and not url.fragment
            key = ("relativeDocket" if relative else "absoluteSourceDocket") if route and (relative or absolute) else "other"
            links[key] += 1
            if key != "other":
                links["identityMatched"] += bool(DOCKET.fullmatch(docket) and query.get("docketNumber") == [docket])
                links["strictQuery"] += set(query) == {"docketNumber"} and len(query["docketNumber"]) == 1
        except ValueError:
            links["other"] += 1
    return {
        "shape": "PRESENTATION_SHAPED" if len(cells) == 1 and spans[0] > 1 else "DATA_SHAPED" if len(cells) >= 18 and all(span == 1 for span in spans) else "OTHER",
        "cells": min(len(cells), 128), "spanTotal": min(max(0, sum(spans)), 10_000),
        "docketShapedCell": bool(DOCKET.fullmatch(docket)),
        "statusLabel": status_labels.get(text, "BLANK" if not text else "OTHER"),
        "interactive": min(interactive, 128),
        "links": {key: min(value, 128) for key, value in links.items()},
    }


def calendar_result_state(validated_table, parsed_rows, explicit_empty_state):
    """A bare form/table with no parsed row is never treated as an empty search."""
    if not validated_table:
        return "RESULTS_NOT_VALIDATED"
    if parsed_rows:
        return "RESULTS_VALIDATED"
    if explicit_empty_state:
        return "EMPTY_RESULTS_VALIDATED"
    return "RESULTS_NOT_VALIDATED"


def bail_sections(pages):
    """Keep one-based page locations alongside the existing supported sections."""
    sections = []
    for page_number, page in enumerate(pages, 1):
        if "BAIL INFORMATION" not in page:
            continue
        section = page[page.find("BAIL INFORMATION"):]
        end = re.search(
            r"\n\s*(?:DEFENDANT INFORMATION|CHARGES|DISPOSITION|DOCKET ENTRY INFORMATION|"
            r"CASE FINANCIAL INFORMATION|ATTORNEY INFORMATION|CALENDAR EVENTS|STATUS INFORMATION|"
            r"COMMONWEALTH INFORMATION|CASE PARTICIPANTS|COMMONWEALTH OF PENNSYLVANIA|CPCMS\s+\d+)\b",
            section,
        )
        if end:
            section = section[:end.start()]
        header = section.find("Bail Action")
        if header < 0:
            raise ValueError("UNSUPPORTED_BAIL_HEADER")
        sections.append((page_number, section[header:].strip()))
    return sections


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
    base.update(documentSha256=hashlib.sha256(body).hexdigest(),
                documentPageCount=len(pages),
                bailSectionPages=[i for i, page in enumerate(pages, 1)
                                  if "BAIL INFORMATION" in page])
    if not base["bailSectionPages"]:
        return dict(base, extractionOutcome="MISSING_BAIL_SECTION", detail="Readable matching docket has no bail section. Bail and custody remain unknown.")
    try:
        sections = bail_sections(pages)
    except ValueError:
        return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT", detail="Bail section exists but its table header is unsupported.")
    section = "\n".join(text for _, text in sections)
    if len(section) > 4000:
        return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT", detail="Bail chronology exceeds the minimal excerpt limit; do not truncate it silently.")
    entries = []
    unknown_rows = []
    located_lines = [(page, line) for page, text in sections for line in text.splitlines()]
    lines = [line for _, line in located_lines]
    for index, line in enumerate(lines):
        match = re.match(r"^\s*(.*?)\s{2,}(\d{2}/\d{2}/\d{4})\s{2,}(.*?)\s*$", line)
        if not match:
            if re.search(r"\d{2}/\d{2}/\d{4}|\$[\d,]", line):
                unknown_rows.append(line)
            continue
        action, date, tail = match.groups()
        source_pages = [located_lines[index][0]]
        if action.count("(") > action.count(")") and index + 1 < len(lines):
            continuation = lines[index + 1].strip()
            if re.fullmatch(r"[A-Za-z -]+\)", continuation):
                action += " " + continuation
                source_pages = sorted(set(source_pages + [located_lines[index + 1][0]]))
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
                         "amountCents": amount, "financialBasis": basis,
                         "sourcePages": source_pages})
    if not entries or unknown_rows or any(entry["orderDate"] is None for entry in entries):
        return dict(base, excerpt=section, extractionOutcome="UNSUPPORTED_LAYOUT",
                    detail="Some bail rows could not be interpreted; no guessed amounts were saved.")
    # All source rows/chronology stay in the excerpt, including multiline action text.
    posted = "SHOWN_POSTED" if re.search(r"\bpost(?:ed|ing)\b", section, re.I) else "NOT_SHOWN"
    return dict(base, entries=entries, postedEntryState=posted, excerpt=section,
                extractionOutcome="EXTRACTED",
                detail="Document identity matched. All bail entries remain provisional; no operative order or custody was inferred.")
