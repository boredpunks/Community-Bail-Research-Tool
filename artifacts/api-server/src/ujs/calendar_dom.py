"""Passive bounded projection of a loaded calendar, not full-page HTML."""
import codecs
from html.parser import HTMLParser


class ResultFraming(HTMLParser):
    """Reject truncated/malformed source grids before browser HTML repair."""
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.result_depth = None
        self.row = self.cell = None
        self.bad = False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            if self.result_depth is not None:
                self.bad = True
            if dict(attrs).get("id") == "caseSearchResultGrid":
                self.result_depth = self.depth
        if self.result_depth is not None:
            if tag == "tr":
                self.bad |= self.row is not None
                self.row = tag
            elif tag in ("td", "th"):
                self.bad |= self.row is None or self.cell is not None
                self.cell = tag

    def handle_endtag(self, tag):
        if self.result_depth is not None:
            if tag in ("td", "th"):
                self.bad |= self.cell != tag
                self.cell = None
            elif tag == "tr":
                self.bad |= self.row is None or self.cell is not None
                self.row = None
            elif tag == "table" and self.depth == self.result_depth:
                self.bad |= self.row is not None or self.cell is not None
                self.result_depth = None
        if tag == "table":
            self.depth = max(0, self.depth - 1)


def complete_result_framing(body, content_type):
    # HTML is decoded incrementally only for framing; no retained cells/URLs.
    # Accept the demonstrated encodings, never guess a lossy replacement.
    import re
    charset = re.search(r"charset\s*=\s*[\"']?([a-zA-Z0-9_-]+)", content_type, re.I)
    encoding = charset.group(1).lower() if charset else "utf-8"
    if encoding not in ("utf-8", "utf8", "us-ascii", "windows-1252", "iso-8859-1"):
        return False
    parser = ResultFraming()
    try:
        decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
        view = memoryview(body)
        for index in range(0, len(body), 64 * 1024):
            parser.feed(decoder.decode(view[index:index + 64 * 1024]))
            # HTMLParser retains an unfinished token; bound that too.
            if len(parser.rawdata) > 1_000_000:
                return False
        parser.feed(decoder.decode(b"", final=True))
        parser.close()
        return not (parser.bad or parser.result_depth is not None or parser.row
                    or parser.cell or parser.rawdata.strip())
    except (ValueError, UnicodeError):
        return False


# Walking bounds work done and aggregate string sizes BEFORE calling outerHTML
# on only the result table. Never serialize document.documentElement/page.content.
# Scan global links/text too so late pagination and limit warnings aren't lost.
DOM_PROJECTION = r"""({limit}) => {
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let node, visited=0, units=0, table=null, tables=0, pagination=false, resultLimit=false, tail="";
  while ((node=walker.nextNode())) {
    if (++visited>200000) throw new Error("CALENDAR_RESPONSE_LIMIT");
    if (node.nodeType===Node.TEXT_NODE || node.nodeType===Node.COMMENT_NODE) {
      const text=node.data;
      units+=node.nodeType===Node.COMMENT_NODE ? text.length+7 : 0;
      // Bounded, overlapping scan; includes warnings early or late in page.
      for (let i=0;i<text.length;i+=4096) {
        const part=tail+text.slice(i,i+4096);
        if (node.nodeType===Node.TEXT_NODE) units+=text.slice(i,i+4096)
          .replace(/[&<>]/g,c=>c==="&"?"&amp;":c==="<"?"&lt;":"&gt;").length;
        if (/(?:not\s+all\s+results\s+are\s+shown)|(?:maximum|limit)\s+(?:of\s+)?(?:500|results)|(?:first|more than)\s+500|(?:result|record)s?\s+limit|too many results/i.test(part)) resultLimit=true;
        tail=part.slice(-256);
      }
    } else if (node.nodeType===Node.ELEMENT_NODE) {
      units+=node.tagName.length*2+5;
      for (const a of node.attributes) units+=a.name.length+a.value.length*6+4;
      if (node.tagName==="TABLE" && node.id==="caseSearchResultGrid") { tables++; table=node; }
      if (node.tagName==="A" && /(?:pageNumber|pageIndex|page=)/i.test(node.getAttribute("href")||"")) pagination=true;
    }
    if (units>limit) throw new Error("CALENDAR_RESPONSE_LIMIT");
  }
  if (tables===0) return {html:"",pagination,resultLimit};
  if (tables!==1) throw new Error("RESULTS_NOT_VALIDATED");
  let projected=table, traversal="STATIC_DOM";
  // Read every locally-held row, including pages detached by DataTables. This
  // is a local data read, never a page click or unaccounted source request.
  const jq=window.jQuery;
  if (jq?.fn?.dataTable?.isDataTable?.(table)) {
    const api=jq(table).DataTable();
    const settings=api.settings()[0];
    if (settings?.oFeatures?.bServerSide) {
      pagination=true; traversal="REMOTE_PAGINATION_NOT_TRAVERSED";
    } else {
      const rows=api.rows().nodes().toArray();
      if (rows.length>5000) throw new Error("CALENDAR_RESPONSE_LIMIT");
      projected=table.cloneNode(true);
      for (const body of [...projected.tBodies]) body.remove();
      const body=document.createElement("tbody");
      for (const row of rows) body.append(row.cloneNode(true));
      projected.append(body);
      traversal="LOCAL_DATATABLES";
    }
  } else if (document.querySelector('[aria-controls="caseSearchResultGrid"][data-page], #caseSearchResultGrid_next:not(.disabled)')) {
    pagination=true; traversal="REMOTE_PAGINATION_NOT_TRAVERSED";
  }
  const html=projected.outerHTML;
  if (html.length>limit) throw new Error("CALENDAR_RESPONSE_LIMIT");
  return {html,pagination,resultLimit,traversal};
}"""
