// FERC eLibrary API client.
//
// This talks directly to FERC's (undocumented) eLibrary JSON API from the
// browser. FERC reflects the request Origin in Access-Control-Allow-Origin,
// so cross-origin calls from GitHub Pages work without any backend.
//
// Verified endpoints (base: https://elibrary.ferc.gov/eLibrarywebapi/api):
//   POST Search/AdvancedSearch        -> keyword + full-text search, filters
//   POST Docket/GetSingleDocketSheet  -> raw docket sheet (we mostly use search)
//   POST File/DownloadP8File          -> raw bytes of a single file (PDF, etc.)

const FERC = {
  BASE: "https://elibrary.ferc.gov/eLibrarywebapi/api",

  // Human-facing FERC pages (good fallbacks / "open at source" links).
  docInfoUrl(accession) {
    return `https://elibrary.ferc.gov/eLibrary/docinfo?accession_number=${encodeURIComponent(accession)}`;
  },

  // ---- low-level POST helper ------------------------------------------------
  async _post(path, body, asBlob = false) {
    const res = await fetch(`${this.BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`FERC API ${path} responded ${res.status}`);
    }
    return asBlob ? res.blob() : res.json();
  },

  // ---- search ---------------------------------------------------------------
  // Build the full AdvancedSearch payload from a friendly options object.
  buildSearchBody(opts = {}) {
    const {
      text = "*",
      fullText = false,        // search inside the OCR'd PDF text
      description = true,      // search document descriptions
      dockets = [],            // array of docket-number strings
      accessionNumber = null,
      dateType = "filed_date", // filed_date | issued_date | posted_date
      startDate = null,        // "MM/DD/YYYY"
      endDate = null,          // "MM/DD/YYYY"
      libraries = [],
      categories = [],
      classTypes = [],
      page = 1,
      perPage = 50,
    } = opts;

    const dateSearches = [];
    if (startDate && endDate) {
      dateSearches.push({ dateType, startDate, endDate });
    }

    return {
      searchText: text && text.trim() ? text.trim() : "*",
      searchFullText: !!fullText,
      searchDescription: !!description,
      dateSearches,
      availability: null,
      affiliations: [],
      categories,
      libraries,
      accessionNumber: accessionNumber || null,
      eFiling: false,
      docketSearches: dockets.map((d) => ({
        docketNumber: d,
        subDocketNumbers: [],
      })),
      resultsPerPage: perPage,
      curPage: page,
      classTypes,
      sortBy: "", // non-empty values currently error server-side; default order
      groupBy: "NONE",
      idolResultID: "",
      allDates: dateSearches.length === 0,
    };
  },

  // Returns { totalHits, hits: [normalizedFiling], page, perPage }.
  async search(opts = {}) {
    const body = this.buildSearchBody(opts);
    const data = await this._post("Search/AdvancedSearch", body);
    if (data && data.success === false && data.errorMessage) {
      throw new Error(data.errorMessage);
    }
    const hits = (data.searchHits || []).map(normalizeFiling);
    return {
      totalHits: data.totalHits || 0,
      hits,
      page: body.curPage,
      perPage: body.resultsPerPage,
    };
  },

  // ---- file download --------------------------------------------------------
  // Returns a Blob of the raw file bytes for a transmittal fileId.
  async fileBlob(fileId) {
    return this._post("File/DownloadP8File", { fileidLst: [fileId] }, true);
  },
};

// Normalize a raw search hit into a stable shape the UI can rely on.
// (Note: FERC misspells "acesssionNumber" in its payload.)
function normalizeFiling(h) {
  const files = (h.transmittals || []).map((t) => ({
    fileId: t.fileId,
    name: t.fileName || "(unnamed)",
    type: t.fileType || "",
    format: t.fileFormat || "",
    desc: t.fileDesc || "",
    size: t.fileSize || 0,
  }));
  return {
    accession: h.acesssionNumber || h.accessionNumber || "",
    documentId: h.documentId || "",
    description: h.description || "",
    category: h.category || "",
    dockets: h.docketNumbers || [],
    classTypes: (h.classTypes || []).map(
      (c) => [c.documentClass, c.documentType].filter(Boolean).join(" / ")
    ),
    libraries: h.libraries || [],
    availCode: h.availCode || "",
    filedDate: h.filedDate || "",
    issuedDate: h.issuedDate || "",
    postedDate: h.postedDate || "",
    files,
  };
}

window.FERC = FERC;
