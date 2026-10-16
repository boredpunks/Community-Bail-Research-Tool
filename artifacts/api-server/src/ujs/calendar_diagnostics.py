"""Bounded in-memory classification; never return console text or source URLs."""
import re
from urllib.parse import urlsplit
from source_protocol import allowed
from calendar_protocol import expected_optional_console_error

MAX_COUNT = 10_000
MAX_GROUPS = 32
REQUIRED = {"MAIN_SCRIPT", "MAIN_STYLESHEET"}


def resource_alias(url, blocked_optional):
    if not isinstance(url, str) or not url or len(url) > 2048:
        return "UNKNOWN"
    if url in blocked_optional:
        return "BLOCKED_OPTIONAL"
    try:
        if not allowed(url, "GET"):
            return "OTHER"
        path = urlsplit(url).path
        return {"/CaseSearch": "MAIN_DOCUMENT",
                "/resource/js/sitemain.min.js": "MAIN_SCRIPT",
                "/resource/css/sitemain.min.css": "MAIN_STYLESHEET"}.get(path, "OTHER")
    except (TypeError, ValueError):
        return "UNKNOWN"


class CalendarDiagnosticRecorder:
    def __init__(self):
        self.groups = {}
        self.overflow = False

    def add(self, category, phase, alias, signal):
        key = (category, phase, alias, signal)
        if key not in self.groups and len(self.groups) >= MAX_GROUPS:
            self.overflow = True
            return
        count = self.groups.get(key, 0)
        if count >= MAX_COUNT:
            self.overflow = True
        self.groups[key] = min(MAX_COUNT, count + 1)

    def console(self, kind, text, url, blocked_optional, phase):
        if kind != "error":
            return False
        alias = resource_alias(url, blocked_optional)
        optional = expected_optional_console_error(kind, text, url, blocked_optional)
        if optional:
            category, signal = "BLOCKED_OPTIONAL_RESOURCE_ERROR", "RESOURCE_ABORT"
        elif (not isinstance(text, str) or len(text) > 2048
              or any(ord(char) < 32 and char not in "\r\n\t" for char in text)):
            category, signal = "UNKNOWN_OR_UNSAFE", "UNCLASSIFIED"
        else:
            resource_error = bool(re.fullmatch(
                r"Failed to load resource: (?:net::ERR_[A-Z_]{1,64}|"
                r"the server responded with a status of [1-5][0-9]{2} \([A-Za-z ]{1,64}\))", text))
            signal = "RESOURCE_LOAD_ERROR" if resource_error else "CONSOLE_ERROR"
            category = ("REQUIRED_RESOURCE_FAILURE" if resource_error and alias in REQUIRED
                        else "OTHER_CONSOLE_ERROR" if alias in REQUIRED | {"MAIN_DOCUMENT", "BLOCKED_OPTIONAL"}
                        else "UNKNOWN_OR_UNSAFE")
        self.add(category, phase, alias, signal)
        return optional

    def exception(self, phase):
        # No exception message, stack, filenames or arbitrary JS properties read.
        self.add("JAVASCRIPT_EXCEPTION", phase, "UNKNOWN", "SCRIPT_EXCEPTION")

    def resource_failure(self, url, resource_type, blocked_optional, phase):
        alias = resource_alias(url, blocked_optional)
        if alias == "BLOCKED_OPTIONAL" and resource_type in ("image", "font", "media"):
            self.add("BLOCKED_OPTIONAL_RESOURCE_ERROR", phase, alias, "REQUEST_FAILED")
        elif resource_type in ("script", "stylesheet"):
            self.add("REQUIRED_RESOURCE_FAILURE" if alias in REQUIRED else "UNKNOWN_OR_UNSAFE",
                     phase, alias, "REQUEST_FAILED")

    def snapshot(self):
        return [dict(category=k[0], phase=k[1], alias=k[2], signal=k[3], count=v)
                for k, v in sorted(self.groups.items())]


# Passive structural projection only. No labels/cells/links/HTML returned, no
# interactions or requests, and no inference that a header-only table is empty.
RESPONSE_STRUCTURE = r"""() => {
  const out = {bodyPresent: !!document.body, searchButtonCount: 0,
    searchFormPresent: false, resultTableCount: 0, headerCellCount: 0,
    expectedHeaders: false, dataRowCount: 0, documentLinkCount: 0, countsCapped: false};
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
  let node, visited = 0, table = null;
  while ((node = walker.nextNode())) {
    if (++visited > 10000) { out.countsCapped = true; return out; }
    if (node.id === "btnSearch") {
      out.searchButtonCount = Math.min(2, out.searchButtonCount + 1);
      out.searchFormPresent ||= !!node.form;
    }
    if (node.tagName === "TABLE" && node.id === "caseSearchResultGrid") {
      out.resultTableCount = Math.min(2, out.resultTableCount + 1); table = node;
    }
  }
  if (out.resultTableCount !== 1) return out;
  let headers = [];
  const cap = (n, max) => { if (n > max) out.countsCapped = true; return Math.min(n, max); };
  for (const row of table.rows) {
    if (row.querySelector("th")) headers = [...row.cells];
    else if (row.querySelector("td")) out.dataRowCount++;
    if (out.dataRowCount > 1000 || headers.length > 128) { out.countsCapped = true; break; }
  }
  out.dataRowCount = cap(out.dataRowCount, 1000);
  out.headerCellCount = cap(headers.length, 128);
  const expected = [[2,"Docket Number"],[3,"Court Type"],[6,"Filing Date"],
    [9,"County"],[10,"Court Office"],[14,"Event Type"]];
  out.expectedHeaders = expected.every(([i,label]) => {
    const text = headers[i]?.textContent;
    return typeof text === "string" && text.length <= 128 && text.trim().startsWith(label);
  });
  const links = table.querySelectorAll("a[href]");
  if (links.length > 1000) out.countsCapped = true;
  for (let i=0; i<Math.min(links.length,1000); i++) {
    const raw = links[i].getAttribute("href") || "";
    if (raw.length <= 2048 && raw.startsWith("/Report/CpDocketSheet?")) out.documentLinkCount++;
  }
  return out;
}"""


def parser_outcome(error):
    return {
        "RESULTS_NOT_VALIDATED": "MISSING_TABLE",
        "UNSUPPORTED_CALENDAR_LAYOUT": "UNSUPPORTED_LAYOUT",
        "CALENDAR_DOCUMENT_LINK_MISSING": "LINK_REJECTED",
        "CALENDAR_IDENTITY_OR_COVERAGE_CONFLICT": "IDENTITY_OR_SCOPE_REJECTED",
        "UNSUPPORTED_EVENT_DATE_LAYOUT": "DATE_REJECTED",
        "CALENDAR_EVENT_DATE_OUTSIDE_REQUESTED_WINDOW": "DATE_REJECTED",
    }.get(str(error), "PARSER_ERROR")
