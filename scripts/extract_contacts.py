#!/usr/bin/env python3
"""Extract filer contacts (name / employer / email / phone) from a FERC docket.

Downloads each PDF in a docket, reads its text layer, and parses the signature
block for emails, phone numbers, and signatory context. Writes a CSV.

Requires pypdf:   pip install pypdf

Usage:
    python3 extract_contacts.py DOCKET [out.csv]

Examples:
    python3 extract_contacts.py ER26-1800
    python3 extract_contacts.py CP26-47 pjm_contacts.csv

Note: only works on PDFs with an embedded text layer (most modern e-filings).
Older image-only scans yield no text; for those, and for authoritative contact
info, use FERC's Service List: https://elibrary.ferc.gov/eLibrary/servicelist
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("This script needs pypdf. Install it with:  pip install pypdf")

API = "https://elibrary.ferc.gov/eLibrarywebapi/api"
PER_PAGE = 100
MAX_PAGES_PER_PDF = 8

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")
SIG = re.compile(
    r"(Respectfully submitted|Sincerely|Very truly yours|/s/|Counsel for|On behalf of)"
    r"[\s\S]{0,400}",
    re.IGNORECASE,
)


def post(path, body, raw=False):
    req = urllib.request.Request(
        API + "/" + path, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read() if raw else json.load(r)


def search_page(docket, page):
    body = {
        "searchText": "*", "searchFullText": False, "searchDescription": True,
        "dateSearches": [], "availability": None, "affiliations": [],
        "categories": [], "libraries": [], "accessionNumber": None,
        "eFiling": False,
        "docketSearches": [{"docketNumber": docket, "subDocketNumbers": []}],
        "resultsPerPage": PER_PAGE, "curPage": page, "classTypes": [],
        "sortBy": "", "groupBy": "NONE", "idolResultID": "", "allDates": True,
    }
    return post("Search/AdvancedSearch", body)


def pdf_text(blob):
    reader = PdfReader(io.BytesIO(blob))
    out = []
    for pg in reader.pages[:MAX_PAGES_PER_PDF]:
        try:
            out.append(pg.extract_text() or "")
        except Exception:  # noqa: BLE001
            pass
    return "\n".join(out)


def author_of(hit):
    for a in (hit.get("affiliations") or []):
        if a.get("afType") == "AUTHOR":
            last = a.get("lastName", "")
            fi = a.get("firstInitial", "").replace("x", "")
            name = f"{last}, {fi}".strip(", ") if last else ""
            return name, a.get("affiliation", "")
    return "", ""


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    docket = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else f"{docket.replace('/', '_')}_contacts.csv"

    rows = []
    page, total = 1, None
    while True:
        data = search_page(docket, page)
        if total is None:
            total = data.get("totalHits", 0)
            print(f"Docket {docket}: {total} filings - extracting contacts...")
        hits = data.get("searchHits") or []
        if not hits:
            break
        for h in hits:
            acc = h.get("acesssionNumber") or h.get("accessionNumber") or ""
            name, employer = author_of(h)
            pdfs = [t for t in (h.get("transmittals") or []) if t.get("fileType") == "PDF"]
            pdfs.sort(key=lambda t: 0 if re.search(r"transmit|letter|cover",
                      t.get("fileName", ""), re.I) else 1)
            emails, phones, sig = set(), set(), ""
            text_found = False
            for t in pdfs[:3]:
                try:
                    blob = post("File/DownloadP8File", {"fileidLst": [t["fileId"]]}, raw=True)
                    text = pdf_text(blob)
                    time.sleep(0.3)
                except Exception as e:  # noqa: BLE001
                    print(f"  {acc}: download/parse failed: {e}")
                    continue
                if len(text.strip()) > 30:
                    text_found = True
                emails.update(e.rstrip(".,;)").lower() for e in EMAIL.findall(text))
                phones.update(p for p in PHONE.findall(text)
                              if 10 <= len(re.sub(r"\D", "", p)) <= 11)
                m = SIG.search(text)
                if m and not sig:
                    sig = re.sub(r"\s+", " ", m.group(0)).strip()[:320]
                if emails and sig:
                    break
            rows.append({
                "accession": acc, "filed_date": h.get("filedDate", ""),
                "dockets": "; ".join(h.get("docketNumbers") or []),
                "author": name, "employer": employer,
                "emails": "; ".join(sorted(emails)),
                "phones": "; ".join(sorted(phones)),
                "had_text_layer": "yes" if text_found else "no",
                "signature_block": sig,
            })
            tag = f"{len(emails)} email(s)" if emails else ("scanned image" if not text_found else "no contacts")
            print(f"  {acc}  {name or employer or ''} -> {tag}")
        if page * PER_PAGE >= total:
            break
        page += 1

    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else
                           ["accession", "filed_date", "dockets", "author",
                            "employer", "emails", "phones", "had_text_layer",
                            "signature_block"])
        w.writeheader()
        w.writerows(rows)
    print(f"\nWrote {len(rows)} rows to {out_path}")


if __name__ == "__main__":
    main()
