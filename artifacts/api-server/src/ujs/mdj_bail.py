"""Strict MDJ bail-table text parsing. No guessed amounts or case fixtures."""
import re
from decimal import Decimal

ROW = re.compile(
    r"(?m)^[ \t]*(Set|Changed|Modified|Denied|Revoked|Increased|Reduced|Bail Set)"
    r"\s+(\d{2}/\d{2}/\d{4})\s+"
    r"(Monetary|Unsecured|Nonmonetary|Non-Monetary|Nominal|Recognizance|Denied)"
    r"\s+(?:(N/A|--|\d+(?:\.\d+)?%?)\s+)?"
    r"\$?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})[ \t]*$", re.I)


def extract_mdj_bail(pages, docket, base, iso_date, body=None):
    first = pages[0][:5000]
    identities = re.findall(r"Docket\s+Number\s*:\s*(MJ-\d{5}-(?:CR|NT)-\d{7}-\d{4})", first)
    if (not re.search(r"Magisterial District Judge\b", first, re.I)
            or not identities or identities[0] != docket or not docket.startswith("MJ-05")
            or not re.search(r"County:\s+Allegheny\b", first)):
        return dict(base, extractionOutcome="IDENTITY_MISMATCH",
                    detail="MDJ court/docket header did not match the requested document.")
    if body is not None and any("Originating Court" in page for page in pages):
        from bail_table import read_bail_tables, FinancialAssociationError
        try:
            entries, excerpt, section_pages, posted = read_bail_tables(body, iso_date)
        except ValueError as error:
            return dict(base, extractionOutcome="AMBIGUOUS_FINANCIAL_ASSOCIATION"
                        if isinstance(error, FinancialAssociationError) else "UNSUPPORTED_LAYOUT",
                        bailSectionPages=[], detail=str(error))
        return dict(base, entries=entries, excerpt=excerpt, bailSectionPages=section_pages,
                    postedEntryState=posted, extractionOutcome="EXTRACTED",
                    detail="Header-mapped MDJ recorded setting amount; originating court and posting status kept separate. Historical/provisional evidence, not an operative-order or custody finding.")
    sections = []
    for page, text in enumerate(pages, 1):
        marker = re.search(r"(?m)^\s*BAIL(?: INFORMATION)?\s*$", text)
        if not marker:
            continue
        section = text[marker.end():]
        end = re.search(r"(?m)^\s*(?:CASE DISPOSITION|DISPOSITION SUMMARY|DOCKET ENTRY INFORMATION|"
                        r"CASE INFORMATION|ATTORNEY INFORMATION|CHARGES|SCHEDULED EVENTS|"
                        r"DOCKET ENTRIES|CPCMS \d+|Printed:).*$", section)
        if end:
            section = section[:end.start()]
        sections.append((page, section))
    base["bailSectionPages"] = [page for page, _ in sections]
    if not sections:
        return dict(base, extractionOutcome="MISSING_BAIL_SECTION",
                    detail="Matching readable MDJ docket contains no recognized BAIL section.")
    excerpt = "\n".join(text for _, text in sections).strip()
    if len(excerpt) > 4000:
        return dict(base, extractionOutcome="UNSUPPORTED_LAYOUT",
                    detail="MDJ bail chronology exceeds the complete excerpt limit.")
    entries = []
    posted = "NOT_SHOWN"
    for page, section in sections:
        split = re.split(r"(?im)^[ \t]*Bail Posted[ \t]*$", section, maxsplit=1)
        actions = split[0]
        if not re.search(r"Bail Action Type\s+(?:Bail Action )?Date\s+Bail Type\s+Percentage\s+Amount",
                         actions, re.I):
            return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                        detail="MDJ bail action/Date/Type/Percentage/Amount header is unsupported.")
        matches = list(ROW.finditer(actions))
        remaining = ROW.sub("", actions)
        if re.search(r"\d{2}/\d{2}/\d{4}", remaining):
            return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                        detail="An MDJ bail row was not fully interpreted; no rows were silently dropped.")
        for match in matches:
            action, date, wording, percentage, money = match.groups()
            if percentage not in (None, "N/A", "--") and Decimal(percentage.rstrip("%")) != 0:
                return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                            detail="Percentage-bearing MDJ bail is not inferred to be total bail.")
            category = {"monetary": "MONETARY", "unsecured": "UNSECURED", "nominal": "NOMINAL",
                        "nonmonetary": "NONMONETARY", "non-monetary": "NONMONETARY",
                        "recognizance": "RECOGNIZANCE", "denied": "DENIED"}[wording.lower()]
            amount = int(Decimal(money.replace(",", "")) * 100)
            date = iso_date(date)
            if amount > 2147483647 or date is None:
                return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                            detail="MDJ amount/date is outside supported storage bounds.")
            basis = ("UNSECURED_AMOUNT" if category == "UNSECURED"
                     else "TOTAL_BAIL" if category in ("MONETARY", "NOMINAL") else None)
            entries.append({"action": action, "wording": wording, "orderDate": date,
                            "bailCategory": category, "amountCents": amount if basis else None,
                            "financialBasis": basis, "sourcePages": [page], "excerpt": match.group().strip()})
        if len(split) == 2:
            posting = split[1]
            if not re.search(r"Posting Status", posting, re.I):
                return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                            detail="MDJ Bail Posted table has no recognized Posting Status header.")
            # Exact table cells only, not the word in the Bail Posted heading,
            # nor "Not Posted". Unknown statuses never establish nothing posted.
            cells = [cell.strip() for line in posting.splitlines() for cell in re.split(r"\s{2,}", line.strip())]
            if any(cell.lower() == "posted" for cell in cells):
                posted = "SHOWN_POSTED"
            elif re.search(r"\d{2}/\d{2}/\d{4}", posting) and not any(
                    cell.lower() in ("not posted", "unposted") for cell in cells):
                posted = "UNKNOWN"
    if not entries:
        return dict(base, excerpt=excerpt, extractionOutcome="UNSUPPORTED_LAYOUT",
                    detail="MDJ BAIL section has no fully supported action rows.")
    from bail_table import stable_entries
    return dict(base, entries=stable_entries(entries), postedEntryState=posted, excerpt=excerpt,
                extractionOutcome="EXTRACTED",
                detail="MDJ identity and complete supported bail rows matched; provisional source evidence only.")
