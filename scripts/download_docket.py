#!/usr/bin/env python3
"""Download every file in a FERC docket from eLibrary. No dependencies.

This is the same downloader the website offers via its "Bulk-download script"
button, but as a reusable file. It pages through an entire docket (no browser
size limits) and saves every attached file.

Usage:
    python3 download_docket.py DOCKET [OUTDIR]

Examples:
    python3 download_docket.py ER26-1800
    python3 download_docket.py CP26-47 ./my_pdfs
"""
import json
import os
import sys
import time
import urllib.request

API = "https://elibrary.ferc.gov/eLibrarywebapi/api"
PER_PAGE = 100


def post(path, body, raw=False):
    req = urllib.request.Request(
        API + "/" + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
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


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    docket = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else docket.replace("/", "_")
    os.makedirs(outdir, exist_ok=True)

    page, total, saved = 1, None, 0
    while True:
        data = search_page(docket, page)
        if total is None:
            total = data.get("totalHits", 0)
            print(f"Docket {docket}: {total} filings")
        hits = data.get("searchHits") or []
        if not hits:
            break
        for h in hits:
            acc = h.get("acesssionNumber") or h.get("accessionNumber") or "unknown"
            for t in (h.get("transmittals") or []):
                fid = t.get("fileId")
                name = t.get("fileName") or (acc + ".pdf")
                if not name.lower().endswith(
                    (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".zip", ".tif")
                ):
                    name += ".pdf"
                path = os.path.join(outdir, f"{acc}__{name}".replace("/", "_"))
                if os.path.exists(path):
                    continue
                try:
                    blob = post("File/DownloadP8File", {"fileidLst": [fid]}, raw=True)
                    with open(path, "wb") as f:
                        f.write(blob)
                    saved += 1
                    print(f"  saved {os.path.basename(path)} ({len(blob)} bytes)")
                    time.sleep(0.3)  # be polite to FERC
                except Exception as e:  # noqa: BLE001
                    print(f"  FAILED {fid}: {e}")
        if page * PER_PAGE >= total:
            break
        page += 1
    print(f"Done. {saved} files in {outdir}/")


if __name__ == "__main__":
    main()
