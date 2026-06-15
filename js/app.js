// FERC Navigator — front-end app.
// Hash-routed single page: #/recent, #/search, #/docket/<number>.

const App = {
  root: null,

  init() {
    this.root = document.getElementById("view");
    window.addEventListener("hashchange", () => this.route());
    this.bindHeader();
    if (!location.hash) location.hash = "#/recent";
    else this.route();
  },

  bindHeader() {
    const form = document.getElementById("global-search");
    const input = document.getElementById("global-q");
    const full = document.getElementById("global-fulltext");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (full.checked) params.set("full", "1");
      location.hash = `#/search?${params.toString()}`;
    });

    const docketForm = document.getElementById("docket-jump");
    const docketInput = document.getElementById("docket-q");
    docketForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = docketInput.value.trim();
      if (d) location.hash = `#/docket/${encodeURIComponent(d)}`;
    });
  },

  // ---- routing --------------------------------------------------------------
  route() {
    const raw = location.hash.slice(1); // e.g. /search?q=foo
    const [path, query] = raw.split("?");
    const params = new URLSearchParams(query || "");
    const parts = path.split("/").filter(Boolean); // ['search'] or ['docket','ER26-1800']

    this.setActiveNav(parts[0] || "recent");

    if (parts[0] === "search") return this.viewSearch(params);
    if (parts[0] === "docket") return this.viewDocket(decodeURIComponent(parts[1] || ""), params);
    return this.viewRecent(params);
  },

  setActiveNav(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === name);
    });
  },

  // ---- shared rendering -----------------------------------------------------
  loading(msg = "Loading from FERC eLibrary…") {
    this.root.replaceChildren(
      Util.el("div", { class: "loading" }, [
        Util.el("div", { class: "spinner" }),
        Util.el("p", {}, msg),
      ])
    );
  },

  error(err, retry) {
    console.error(err);
    const box = Util.el("div", { class: "error-box" }, [
      Util.el("h3", {}, "Couldn't reach FERC eLibrary"),
      Util.el("p", {}, String(err.message || err)),
      Util.el("p", { class: "muted" }, "FERC's servers occasionally rate-limit or hiccup. Try again in a moment."),
    ]);
    if (retry) box.appendChild(Util.el("button", { class: "btn", onclick: retry }, "Retry"));
    this.root.replaceChildren(box);
  },

  // Render a single filing card. `term` highlights a keyword.
  filingCard(f, term = "") {
    const docketLinks = f.dockets.length
      ? f.dockets.map((d, i) =>
          Util.el("span", {}, [
            i ? ", " : "",
            Util.el("a", { href: `#/docket/${encodeURIComponent(Util.baseDocket(d))}` }, d),
          ])
        )
      : [Util.el("span", { class: "muted" }, "(no docket)")];

    const meta = Util.el("div", { class: "filing-meta" }, [
      Util.el("span", { class: "badge" }, f.category || "Filing"),
      Util.el("span", {}, [Util.el("strong", {}, "Filed: "), Util.date(f.filedDate)]),
      Util.el("span", {}, [Util.el("strong", {}, "Accession: "), f.accession || "—"]),
      Util.el("span", {}, [
        Util.el("strong", {}, "Dockets: "), ...docketLinks,
      ]),
    ]);

    const files = Util.el("div", { class: "files" },
      f.files.length
        ? f.files.map((file) => this.fileRow(file, f.accession))
        : [Util.el("span", { class: "muted" }, "No downloadable files listed (may be restricted).")]
    );

    return Util.el("article", { class: "filing" }, [
      Util.el("p", { class: "filing-desc", html: Util.highlight(f.description, term) }),
      meta,
      Util.el("div", { class: "filing-tags" },
        f.classTypes.map((c) => Util.el("span", { class: "tag" }, c))),
      files,
      Util.el("a", {
        class: "src-link",
        href: FERC.docInfoUrl(f.accession),
        target: "_blank", rel: "noopener",
      }, "Open at FERC ↗"),
    ]);
  },

  fileRow(file, accession) {
    const btn = Util.el("button", { class: "btn btn-file" },
      [`⬇ ${file.desc || file.type || "File"}`,
       Util.el("span", { class: "fsize" }, ` ${Util.bytes(file.size)}`)]);
    btn.title = file.name;
    btn.addEventListener("click", async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Downloading…";
      try {
        const blob = await FERC.fileBlob(file.fileId);
        const name = file.name && /\.\w+$/.test(file.name)
          ? file.name
          : `${accession || file.fileId}.pdf`;
        Util.saveBlob(blob, name);
        btn.textContent = "✓ Saved";
      } catch (e) {
        console.error(e);
        btn.textContent = "✗ Failed — open at FERC";
        window.open(FERC.docInfoUrl(accession), "_blank", "noopener");
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 2500);
      }
    });
    return Util.el("div", { class: "file-row" }, [btn]);
  },

  pager(total, page, perPage, onGo) {
    const pages = Math.ceil(total / perPage) || 1;
    const wrap = Util.el("div", { class: "pager" });
    const mk = (label, target, disabled) =>
      Util.el("button", {
        class: "btn btn-sm", disabled: disabled ? "true" : null,
        onclick: () => !disabled && onGo(target),
      }, label);
    wrap.append(
      mk("← Prev", page - 1, page <= 1),
      Util.el("span", { class: "pageinfo" },
        `Page ${page} of ${pages.toLocaleString()} · ${total.toLocaleString()} filings`),
      mk("Next →", page + 1, page >= pages),
    );
    return wrap;
  },

  // ---- VIEW: recent dockets -------------------------------------------------
  async viewRecent(params) {
    const days = parseInt(params.get("days") || "7", 10);
    this.loading(`Loading filings from the last ${days} days…`);
    try {
      const end = new Date();
      const start = Util.daysAgo(days);
      const { hits } = await FERC.search({
        text: "*",
        startDate: Util.fmtDate(start),
        endDate: Util.fmtDate(end),
        dateType: "filed_date",
        perPage: 250,
        page: 1,
      });

      // Group filings by base docket number, newest activity first.
      const map = new Map();
      for (const f of hits) {
        const dockets = f.dockets.length ? f.dockets : ["(uncategorized)"];
        for (const d of dockets) {
          const key = Util.baseDocket(d);
          if (!map.has(key)) map.set(key, { docket: key, filings: [], latest: 0 });
          const g = map.get(key);
          g.filings.push(f);
          g.latest = Math.max(g.latest, Util.ts(f.filedDate));
        }
      }
      const groups = [...map.values()].sort((a, b) => b.latest - a.latest);

      const header = Util.el("div", { class: "view-head" }, [
        Util.el("h1", {}, "Recent dockets"),
        Util.el("p", { class: "muted" },
          `${groups.length.toLocaleString()} dockets with activity in the last ${days} days, most recent first.`),
        Util.el("div", { class: "window-controls" },
          [1, 3, 7, 14, 30].map((n) =>
            Util.el("a", {
              class: "chip" + (n === days ? " active" : ""),
              href: `#/recent?days=${n}`,
            }, n === 1 ? "Today" : `${n} days`))),
      ]);

      const list = Util.el("div", { class: "docket-list" },
        groups.map((g) => {
          const latestFiling = g.filings
            .slice()
            .sort((a, b) => Util.ts(b.filedDate) - Util.ts(a.filedDate))[0];
          return Util.el("a", {
            class: "docket-card",
            href: `#/docket/${encodeURIComponent(g.docket)}`,
          }, [
            Util.el("div", { class: "docket-card-top" }, [
              Util.el("span", { class: "docket-num" }, g.docket),
              Util.el("span", { class: "docket-count" },
                `${g.filings.length} filing${g.filings.length === 1 ? "" : "s"}`),
            ]),
            Util.el("p", { class: "docket-latest" },
              latestFiling ? latestFiling.description : ""),
            Util.el("span", { class: "docket-date" },
              `Latest: ${Util.date(latestFiling ? latestFiling.filedDate : "")}`),
          ]);
        }));

      this.root.replaceChildren(header, list);
    } catch (e) {
      this.error(e, () => this.viewRecent(params));
    }
  },

  // ---- VIEW: search ---------------------------------------------------------
  async viewSearch(params) {
    const q = params.get("q") || "";
    const full = params.get("full") === "1";
    const page = parseInt(params.get("page") || "1", 10);
    const startDate = params.get("start") || "";
    const endDate = params.get("end") || "";
    const perPage = 50;

    // Build the controls form first so it's visible while loading.
    const controls = this.searchControls({ q, full, startDate, endDate });
    this.root.replaceChildren(controls, this.loadingInline());

    if (!q) {
      controls.parentNode || this.root.replaceChildren(controls,
        Util.el("p", { class: "muted pad" },
          "Enter a keyword above. Tip: check “search inside PDF text” to search the full OCR'd text of every document."));
      return;
    }

    try {
      const res = await FERC.search({
        text: q,
        fullText: full,
        description: true,
        startDate: startDate || null,
        endDate: endDate || null,
        page,
        perPage,
      });

      const resultsHead = Util.el("div", { class: "results-head" }, [
        Util.el("h2", {}, `${res.totalHits.toLocaleString()} results for “${q}”`),
        full ? Util.el("span", { class: "badge badge-ok" }, "Full PDF text searched")
             : Util.el("span", { class: "badge" }, "Titles & descriptions"),
        this.exportBar(res.hits, `search-${q.replace(/\W+/g, "_")}`),
      ]);

      const cards = res.hits.length
        ? res.hits.map((f) => this.filingCard(f, q))
        : [Util.el("p", { class: "muted pad" }, "No filings matched.")];

      const goto = (p) => {
        const u = new URLSearchParams(params);
        u.set("page", p);
        location.hash = `#/search?${u.toString()}`;
      };

      this.root.replaceChildren(
        controls, resultsHead,
        Util.el("div", { class: "results" }, cards),
        this.pager(res.totalHits, res.page, res.perPage, goto),
      );
    } catch (e) {
      this.root.replaceChildren(controls);
      this.error(e, () => this.viewSearch(params));
    }
  },

  searchControls({ q, full, startDate, endDate }) {
    const form = Util.el("form", { class: "search-controls" });
    const qinput = Util.el("input", { type: "text", name: "q", value: q, placeholder: "Keyword(s)…", class: "ctl-q" });
    const fullBox = Util.el("input", { type: "checkbox", name: "full", id: "ctl-full" });
    if (full) fullBox.checked = true;
    const start = Util.el("input", { type: "text", name: "start", value: startDate, placeholder: "MM/DD/YYYY" });
    const end = Util.el("input", { type: "text", name: "end", value: endDate, placeholder: "MM/DD/YYYY" });

    form.replaceChildren(
      Util.el("div", { class: "ctl-row" }, [
        qinput,
        Util.el("label", { class: "ctl-check" }, [fullBox, " search inside PDF text"]),
        Util.el("button", { class: "btn", type: "submit" }, "Search"),
      ]),
      Util.el("div", { class: "ctl-row ctl-dates" }, [
        Util.el("label", {}, ["Filed from ", start]),
        Util.el("label", {}, [" to ", end]),
        Util.el("span", { class: "muted small" }, "(optional date range)"),
      ]),
    );

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const u = new URLSearchParams();
      if (qinput.value.trim()) u.set("q", qinput.value.trim());
      if (fullBox.checked) u.set("full", "1");
      if (start.value.trim()) u.set("start", start.value.trim());
      if (end.value.trim()) u.set("end", end.value.trim());
      location.hash = `#/search?${u.toString()}`;
    });
    return form;
  },

  loadingInline() {
    return Util.el("div", { class: "loading" }, [
      Util.el("div", { class: "spinner" }), Util.el("p", {}, "Searching FERC eLibrary…"),
    ]);
  },

  // ---- VIEW: docket ---------------------------------------------------------
  async viewDocket(docket, params) {
    const page = parseInt(params.get("page") || "1", 10);
    const perPage = 100;
    this.loading(`Loading docket ${docket}…`);
    try {
      const res = await FERC.search({
        dockets: [docket],
        text: "*",
        perPage,
        page,
      });

      // Sort filings newest-first.
      const filings = res.hits.slice().sort((a, b) => Util.ts(b.filedDate) - Util.ts(a.filedDate));
      const fileCount = filings.reduce((n, f) => n + f.files.length, 0);

      const head = Util.el("div", { class: "view-head" }, [
        Util.el("h1", {}, `Docket ${docket}`),
        Util.el("p", { class: "muted" },
          `${res.totalHits.toLocaleString()} filings · ${fileCount} downloadable files on this page`),
        this.docketExportBar(docket, filings),
      ]);

      const goto = (p) => { location.hash = `#/docket/${encodeURIComponent(docket)}?page=${p}`; };

      const cards = filings.length
        ? filings.map((f) => this.filingCard(f))
        : [Util.el("p", { class: "muted pad" },
            "No filings found. Check the docket number format, e.g. ER26-1800 or CP26-47.")];

      this.root.replaceChildren(
        head,
        Util.el("div", { class: "results" }, cards),
        this.pager(res.totalHits, res.page, res.perPage, goto),
      );
    } catch (e) {
      this.error(e, () => this.viewDocket(docket, params));
    }
  },

  // ---- exports --------------------------------------------------------------
  exportBar(filings, basename) {
    const bar = Util.el("div", { class: "export-bar" });
    bar.append(
      Util.el("button", { class: "btn btn-sm", onclick: () =>
        Util.saveText(Util.filingsToCsv(filings), `${basename}.csv`, "text/csv") }, "⬇ CSV"),
      Util.el("button", { class: "btn btn-sm", onclick: () =>
        Util.saveText(JSON.stringify(filings, null, 2), `${basename}.json`, "application/json") }, "⬇ JSON"),
    );
    return bar;
  },

  docketExportBar(docket, filings) {
    const base = `FERC_${docket.replace(/\W+/g, "_")}`;
    const bar = Util.el("div", { class: "export-bar" });

    bar.append(
      Util.el("button", { class: "btn btn-sm", onclick: () =>
        Util.saveText(Util.filingsToCsv(filings), `${base}_filings.csv`, "text/csv") },
        "⬇ Metadata CSV"),
      Util.el("button", { class: "btn btn-sm", onclick: () =>
        Util.saveText(JSON.stringify(filings, null, 2), `${base}_filings.json`, "application/json") },
        "⬇ Metadata JSON"),
    );

    // Bulk PDF download (zip) for everything on this page.
    const allFiles = filings.flatMap((f) =>
      f.files.map((file) => ({ ...file, accession: f.accession })));
    const zipBtn = Util.el("button", { class: "btn btn-sm btn-primary" },
      `⬇ All ${allFiles.length} PDFs (ZIP)`);
    zipBtn.addEventListener("click", () => this.zipDownload(zipBtn, allFiles, base));
    bar.append(zipBtn);

    // Standalone script snippet for the full docket (all pages, any size).
    bar.append(Util.el("button", { class: "btn btn-sm", onclick: () =>
      this.showScript(docket) }, "⤓ Bulk-download script"));

    return bar;
  },

  async zipDownload(btn, files, base) {
    if (!window.JSZip) {
      alert("ZIP library failed to load (offline?). Use the bulk-download script instead.");
      return;
    }
    if (files.length > 60 &&
        !confirm(`This will fetch ${files.length} files directly from FERC and zip them in your browser. That can be slow and memory-heavy. Continue?`)) {
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    const zip = new JSZip();
    const seen = {};
    let done = 0;
    for (const f of files) {
      btn.textContent = `Fetching ${++done}/${files.length}…`;
      try {
        const blob = await FERC.fileBlob(f.fileId);
        let name = f.name && /\.\w+$/.test(f.name) ? f.name : `${f.accession}_${f.fileId}.pdf`;
        if (seen[name]) name = `${f.accession}_${name}`;
        seen[name] = true;
        zip.file(name, blob);
      } catch (e) {
        console.warn("skip", f.fileId, e);
      }
    }
    btn.textContent = "Zipping…";
    const out = await zip.generateAsync({ type: "blob" });
    Util.saveBlob(out, `${base}_PDFs.zip`);
    btn.textContent = original;
    btn.disabled = false;
  },

  showScript(docket) {
    const py = scriptFor(docket);
    const modal = Util.el("div", { class: "modal-backdrop", onclick: (e) => {
      if (e.target.classList.contains("modal-backdrop")) modal.remove();
    } }, [
      Util.el("div", { class: "modal" }, [
        Util.el("h3", {}, `Download every PDF in docket ${docket}`),
        Util.el("p", { class: "muted" },
          "This standalone Python script (no dependencies) pages through the entire docket and saves every file — no browser size limits. Save it as download_docket.py and run it."),
        Util.el("pre", { class: "code" }, py),
        Util.el("div", { class: "modal-actions" }, [
          Util.el("button", { class: "btn btn-sm", onclick: () => {
            navigator.clipboard.writeText(py); } }, "Copy"),
          Util.el("button", { class: "btn btn-sm", onclick: () =>
            Util.saveText(py, "download_docket.py", "text/x-python") }, "⬇ Save .py"),
          Util.el("button", { class: "btn btn-sm", onclick: () => modal.remove() }, "Close"),
        ]),
      ]),
    ]);
    document.body.appendChild(modal);
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
