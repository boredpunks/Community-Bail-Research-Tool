"""Upgrade legacy synthetic *control-only* fixtures to the observed titles."""
import re

TITLES = {"SearchBy": "Search By", "JudicialDistrict": "Judicial District",
          "CourtOffice": "Court Office", "CourtRoomID": "Room", "CalendarEventType": "Calendar Event Type"}


def titled(markup):
    def replace(match):
        attrs = match.group(1)
        if re.search(r"\btitle=", attrs):
            return match.group()
        name = re.search(r'\bname="([^"]+)"', attrs)
        title = TITLES.get(name[1]) if name else None
        before = markup[:match.start()]
        if not title:
            container = re.search(r'<div id="(\w+)-Control">\s*$', before)
            title = TITLES.get(container[1]) if container else None
        if not title and re.search(r'<label[^>]*>(?:Court\s*room|Room)[^<]*</label>\s*$', before, re.I):
            title = "Room"
        return f'<select title="{title}"{attrs}>' if title else match.group()
    return re.sub(r"<select\b([^>]*)>", replace, markup)
