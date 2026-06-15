// Generates a standalone, dependency-free Python downloader for a docket.
// Used by the "Bulk-download script" button. The same script (parameterized)
// lives at scripts/download_docket.py in the repo.

function scriptFor(docket) {
  const safe = String(docket).replace(/"/g, "");
  return `#!/usr/bin/env python3
"""Download every file in a FERC docket from eLibrary. No dependencies.

Usage:
    python3 download_docket.py [DOCKET] [OUTDIR]

Defaults: DOCKET="${safe}", OUTDIR="./<docket>"
"""
import json, os, sys, time, urllib.request

DOCKET = sys.argv[1] if len(sys.argv) > 1 else "${safe}"
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else DOCKET.replace("/", "_")
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

def search_page(page):
    body = {
        "searchText": "*", "searchFullText": False, "searchDescription": True,
        "dateSearches": [], "availability": None, "affiliations": [],
        "categories": [], "libraries": [], "accessionNumber": None,
        "eFiling": False,
        "docketSearches": [{"docketNumber": DOCKET, "subDocketNumbers": []}],
        "resultsPerPage": PER_PAGE, "curPage": page, "classTypes": [],
        "sortBy": "", "groupBy": "NONE", "idolResultID": "", "allDates": True,
    }
    return post("Search/AdvancedSearch", body)

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    page, total, saved = 1, None, 0
    while True:
        data = search_page(page)
        if total is None:
            total = data.get("totalHits", 0)
            print(f"Docket {DOCKET}: {total} filings")
        hits = data.get("searchHits") or []
        if not hits:
            break
        for h in hits:
            acc = h.get("acesssionNumber") or h.get("accessionNumber") or "unknown"
            for t in (h.get("transmittals") or []):
                fid, name = t.get("fileId"), t.get("fileName") or (acc + ".pdf")
                if not (name.lower().endswith((".pdf", ".doc", ".docx", ".xls",
                                               ".xlsx", ".txt", ".zip", ".tif"))):
                    name += ".pdf"
                path = os.path.join(OUTDIR, f"{acc}__{name}".replace("/", "_"))
                if os.path.exists(path):
                    continue
                try:
                    blob = post("File/DownloadP8File", {"fileidLst": [fid]}, raw=True)
                    with open(path, "wb") as f:
                        f.write(blob)
                    saved += 1
                    print(f"  saved {os.path.basename(path)} ({len(blob)} bytes)")
                    time.sleep(0.3)  # be polite to FERC
                except Exception as e:
                    print(f"  FAILED {fid}: {e}")
        if page * PER_PAGE >= total:
            break
        page += 1
    print(f"Done. {saved} files in {OUTDIR}/")

if __name__ == "__main__":
    main()
`;
}

window.scriptFor = scriptFor;
