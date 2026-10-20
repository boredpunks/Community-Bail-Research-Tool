"""Bounded in-memory classification; never return console text or source URLs."""
import re
import weakref
from urllib.parse import urlsplit
from source_protocol import allowed
from calendar_protocol import expected_optional_console_error

MAX_COUNT = 10_000
MAX_GROUPS = 32
MAX_LOCAL_ORDER = 10_000
MAX_REQUEST_STARTS = 10_000
REQUIRED = {"MAIN_SCRIPT", "MAIN_STYLESHEET"}
RESOURCE_TYPES = {"document", "script", "stylesheet", "image", "font", "media",
                  "xhr", "fetch", "eventsource", "websocket", "manifest", "texttrack", "other"}
STAGES = ("BEFORE_SEARCH", "SEARCH_ARMED", "POST_ATTEMPT", "RESPONSE_RECEIVED",
          "RESPONSE_BODY_READ", "POST_ACKNOWLEDGED", "DOCUMENT_FULFILLED",
          "INSPECTION", "PARSER_STARTED", "PARSER_ACCEPTED", "PARSER_REJECTED")
MILESTONES = set(STAGES[1:]) | {"READ_ONLY"}
LIFECYCLE_STATES = (
    "BEFORE_POST_ATTEMPT",
    "POST_ATTEMPT_IN_PROGRESS",
    "RESPONSE_ACKNOWLEDGED",
    "BROWSER_FULFILLED",
    "READ_ONLY_INSPECTION",
)
LIFECYCLE_RANK = {state: index for index, state in enumerate(LIFECYCLE_STATES)}


def location_class(url):
    """Diagnostic shape only; never a request permission or retained URL."""
    if url is None or url == "":
        return "MISSING"
    if not isinstance(url, str) or len(url) > 2048:
        return "INVALID"
    try:
        p = urlsplit(url)
        if not p.scheme or p.username or p.password or any(ord(c) < 32 for c in url):
            return "INVALID"
        if p.scheme not in ("http", "https"):
            return "NON_HTTP"
        if not p.hostname:
            return "INVALID"
        if p.scheme == "https" and p.hostname == "ujsportal.pacourts.us" and p.port in (None, 443):
            return "SOURCE_ASSET_PATH" if p.path in (
                "/resource/js/sitemain.min.js", "/resource/css/sitemain.min.css") else "SOURCE_OTHER"
        return "EXTERNAL_HTTP"
    except (TypeError, ValueError):
        return "INVALID"


def failure_class(text=None, status=None):
    if type(status) is int:
        if status in (401, 403):
            return "HTTP_DENIED"
        if status == 429:
            return "HTTP_RATE_LIMIT"
        return "HTTP_CLIENT" if 400 <= status < 500 else "HTTP_SERVER" if 500 <= status < 600 else "HTTP_OTHER"
    if not isinstance(text, str) or len(text) > 2048:
        return "UNKNOWN"
    match = re.fullmatch(r"(?:Failed to load resource: )?(?:net::)?(ERR_[A-Z_]{1,64})", text)
    if match:
        return {"ERR_FAILED": "NET_FAILED", "ERR_ABORTED": "NET_ABORTED",
                "ERR_BLOCKED_BY_CLIENT": "NET_BLOCKED_CLIENT", "ERR_NAME_NOT_RESOLVED": "DNS",
                "ERR_CONNECTION_REFUSED": "CONNECT", "ERR_TIMED_OUT": "TIMEOUT"}.get(match[1], "OTHER")
    match = re.fullmatch(r"Failed to load resource: the server responded with a status of ([1-5][0-9]{2}) \([A-Za-z ]{1,64}\)", text)
    return failure_class(status=int(match[1])) if match else "UNKNOWN"


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
        self.requests = {}  # Exact URLs and object keys are session memory ONLY.
        self.sequence = 0
        self.stage = "BEFORE_SEARCH"
        self.read_only = False
        self.milestones = []
        self.blocking_resource_failure = False

    def tick(self):
        if self.sequence >= MAX_COUNT:
            self.overflow = True
        self.sequence = min(MAX_COUNT, self.sequence + 1)
        return self.sequence

    def mark(self, name):
        if name not in MILESTONES:
            raise ValueError("Invalid diagnostic milestone")
        if any(row["name"] == name for row in self.milestones):
            return
        self.milestones.append({"name": name, "sequence": self.tick()})
        if name == "READ_ONLY":
            self.read_only = True
        elif STAGES.index(name) > STAGES.index(self.stage):
            self.stage = name

    def register(self, key, url, resource_type, phase):
        if key in self.requests:
            return
        if len(self.requests) >= 128 or not isinstance(url, str) or len(url) > 2048:
            self.overflow = True
            return
        self.tick()
        self.requests[key] = dict(url=url, ordinal=len(self.requests) + 1,
            resource=resource_type if resource_type in RESOURCE_TYPES else "UNKNOWN",
            requestPhase=phase, requestStage=self.stage, decision="UNKNOWN")

    def decide(self, key, decision):
        if key in self.requests:
            self.requests[key]["decision"] = decision

    def provenance(self, url, key=None):
        matches = ([self.requests[key]] if key in self.requests else
                   [r for r in self.requests.values() if r["url"] == url])
        state = "UNIQUE" if len(matches) == 1 else "AMBIGUOUS" if matches else "OVERFLOW" if self.overflow else "NONE"
        r = matches[0] if state == "UNIQUE" else {}
        return dict(location=location_class(url), match=state, ordinal=r.get("ordinal", 0),
                    resource=r.get("resource", "UNKNOWN"), decision=r.get("decision", "UNKNOWN"),
                    requestPhase=r.get("requestPhase", "UNKNOWN"), requestStage=r.get("requestStage", "UNKNOWN"),
                    stage=self.stage, readOnly=self.read_only)

    def add(self, category, phase, alias, signal, provenance=None, failure="UNKNOWN",
            event_state="BEFORE_POST_ATTEMPT", request_start_state="NOT_ASSOCIATED",
            event_order=None, request_start_order=None):
        # Reserve sequence space for in-flight completion and terminal evidence.
        if self.sequence >= MAX_COUNT - 256:
            self.overflow = True
            return
        p = provenance or self.provenance(None)
        fields = dict(category=category, phase=phase, alias=alias, signal=signal, **p,
                      failure=failure, eventState=event_state,
                      requestStartState=request_start_state)
        key = tuple(fields.items())
        sequence = self.tick()
        if key not in self.groups and len(self.groups) >= MAX_GROUPS:
            self.overflow = True
            return
        row = self.groups.setdefault(key, dict(**fields, count=0, firstSequence=sequence,
            lastSequence=sequence, firstEventOrder=None, lastEventOrder=None,
            firstRequestStartOrder=None, lastRequestStartOrder=None))
        if row["count"] >= MAX_COUNT:
            self.overflow = True
        row["count"] = min(MAX_COUNT, row["count"] + 1)
        row["lastSequence"] = sequence
        for value, first, last in (
            (event_order, "firstEventOrder", "lastEventOrder"),
            (request_start_order, "firstRequestStartOrder", "lastRequestStartOrder"),
        ):
            if value is None:
                continue
            row[first] = value if row[first] is None else min(row[first], value)
            row[last] = value if row[last] is None else max(row[last], value)

    def console(self, kind, text, url, blocked_optional, phase,
                event_state="BEFORE_POST_ATTEMPT", event_order=None):
        if kind != "error":
            return False
        alias = resource_alias(url, blocked_optional)
        p = self.provenance(url)
        matches = [r for r in self.requests.values() if r["url"] == url]
        optional = (expected_optional_console_error(kind, text, url, blocked_optional)
                    and bool(matches) and all(r["decision"] == "OPTIONAL_ABORT"
                        and r["resource"] in ("image", "font", "media") for r in matches))
        if optional and p["match"] == "AMBIGUOUS":
            # Request identity remains ambiguous, but every exact candidate has
            # the same proven session-optional abort. No mixed/unknown exemption.
            p["decision"] = "OPTIONAL_ABORT"
            types = {r["resource"] for r in matches}
            p["resource"] = next(iter(types)) if len(types) == 1 else "UNKNOWN"
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
        if (p["match"] == "OVERFLOW" or p["match"] == "AMBIGUOUS"
                and alias in ("OTHER", "UNKNOWN", "BLOCKED_OPTIONAL")) and not optional:
            category = "UNKNOWN_OR_UNSAFE"
        self.add(category, phase, alias, signal, p, failure_class(text),
                 event_state=event_state, event_order=event_order)
        return optional

    def exception(self, phase, event_state="BEFORE_POST_ATTEMPT", event_order=None):
        # No exception message, stack, filenames or arbitrary JS properties read.
        self.add("JAVASCRIPT_EXCEPTION", phase, "UNKNOWN", "SCRIPT_EXCEPTION",
                 event_state=event_state, event_order=event_order)

    def resource_failure(self, url, resource_type, blocked_optional, phase, key=None,
                         text=None, status=None, event_state="BEFORE_POST_ATTEMPT",
                         event_order=None, request_start_state="UNAVAILABLE",
                         request_start_order=None):
        alias = resource_alias(url, blocked_optional)
        p = self.provenance(url, key)
        if p["resource"] == "UNKNOWN" and resource_type in RESOURCE_TYPES:
            p["resource"] = resource_type
        optional = (alias == "BLOCKED_OPTIONAL" and resource_type in ("image", "font", "media")
                    and p["match"] == "UNIQUE" and p["decision"] == "OPTIONAL_ABORT")
        locally_blocked = p["decision"] in ("POLICY_ABORT", "READ_ONLY_STOP")
        category = ("BLOCKED_OPTIONAL_RESOURCE_ERROR" if optional else
                    "REQUIRED_RESOURCE_FAILURE" if alias in REQUIRED else "UNKNOWN_OR_UNSAFE")
        if not optional and not locally_blocked:
            self.blocking_resource_failure = True
        self.add(category, phase, alias, "REQUEST_FAILED", p,
                 "UNKNOWN" if locally_blocked else failure_class(text, status),
                 event_state=event_state, request_start_state=request_start_state,
                 event_order=event_order, request_start_order=request_start_order)

    def snapshot(self):
        return list(self.groups.values())


# Passive structural projection only. No labels/cells/links/HTML returned, no
# interactions or requests, and no inference that a header-only table is empty.
RESPONSE_STRUCTURE = r"""() => {
  const out = {bodyPresent: !!document.body, searchButtonCount: 0,
    searchFormPresent: false, resultTableCount: 0, headerCellCount: 0,
    expectedHeaders: false, dataRowCount: 0, documentLinkCount: 0, countsCapped: false};
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
  let node, visited = 0, table = null;
  while ((node = walker.nextNode())) {
    if (++visited > 200000) { out.countsCapped = true; return out; }
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
    if (out.dataRowCount > 5000 || headers.length > 128) { out.countsCapped = true; break; }
  }
  out.dataRowCount = cap(out.dataRowCount, 5000);
  out.headerCellCount = cap(headers.length, 128);
  const labels = headers.map(cell => {
    const text = cell?.textContent;
    return typeof text === "string" && text.length <= 128 ? text.trim() : "";
  });
  const caseInformation = !labels.some(text => text.startsWith("Event Type"))
    && ["Docket Number", "Court Type", "Filing Date", "County", "Court Office"].every(label =>
      labels.filter(text => text.startsWith(label)).length === 1);
  const expected = [[2,"Docket Number"],[3,"Court Type"],[6,"Filing Date"],
    [9,"County"],[10,"Court Office"],[14,"Event Type"]];
  out.expectedHeaders = caseInformation || expected.every(([i,label]) => labels[i]?.startsWith(label));
  const links = table.querySelectorAll("a[href]");
  if (links.length > 20000) out.countsCapped = true;
  for (let i=0; i<Math.min(links.length,20000); i++) {
    const raw = links[i].getAttribute("href") || "";
    if (raw.length <= 2048 && /^\/Report\/(?:Cp|Mdj)DocketSheet\?/.test(raw)) out.documentLinkCount++;
  }
  // Size is enforced during streaming receipt and bounded DOM projection.
  // Do not create a full document serialization merely to measure its length.
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
        "CASE_INFORMATION_SCOPE_UNSUPPORTED": "UNSUPPORTED_LAYOUT",
        "CALENDAR_RESPONSE_LIMIT": "PARSER_ERROR",
        "CALENDAR_STRUCTURE_MISMATCH": "PARSER_ERROR",
    }.get(str(error), "PARSER_ERROR")


class CalendarLifecycle:
    """Bounded local lifecycle state and ephemeral request-start observations."""

    def __init__(self):
        self.state = "BEFORE_POST_ATTEMPT"
        self.order = 0
        self.order_overflow = False
        self.request_starts = weakref.WeakKeyDictionary()

    def advance(self, state):
        if state not in LIFECYCLE_STATES:
            raise ValueError("CALENDAR_LIFECYCLE_STATE_INVALID")
        if LIFECYCLE_RANK[state] >= LIFECYCLE_RANK[self.state]:
            self.state = state

    def _next_order(self):
        if self.order >= MAX_LOCAL_ORDER:
            self.order_overflow = True
            return None
        self.order += 1
        return self.order

    def request_started(self, request):
        state = self.state
        order = self._next_order()
        try:
            if len(self.request_starts) >= MAX_REQUEST_STARTS:
                self.order_overflow = True
                return state, order
            self.request_starts[request] = (state, order)
        except TypeError:
            self.order_overflow = True
        return state, order

    def request_start(self, request):
        try:
            return self.request_starts.get(request, ("UNAVAILABLE", None))
        except TypeError:
            return "UNAVAILABLE", None

    def event_order(self):
        return self._next_order()
