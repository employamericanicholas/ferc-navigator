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
    if (parts[0] === "companies") return this.viewCompanies(params);
    if (parts[0] === "people") return this.viewPeople(params);
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
      this.authorsLine(f.authors),
      meta,
      Util.el("div", { class: "filing-tags" },
        f.classTypes.map((c) => Util.el("span", { class: "tag" }, c))),
      files,
      this.contactsBlock(f),
      Util.el("a", {
        class: "src-link",
        href: FERC.docInfoUrl(f.accession),
        target: "_blank", rel: "noopener",
      }, "Open at FERC ↗"),
    ]);
  },

  // Button + results area that extracts contacts from the filing's PDFs.
  contactsBlock(f) {
    const pdfs = f.files.filter((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name));
    if (!pdfs.length) return null;
    // Process transmittal letters first — that's where signatures usually live.
    pdfs.sort((a, b) =>
      (/(transmit|letter|cover)/i.test(b.name) ? 1 : 0) - (/(transmit|letter|cover)/i.test(a.name) ? 1 : 0));

    const out = Util.el("div", { class: "contacts-out" });
    const btn = Util.el("button", { class: "btn btn-sm btn-contacts" }, "🔎 Find contacts in PDF");
    btn.addEventListener("click", () => this.findContacts(btn, out, pdfs, f));
    return Util.el("div", { class: "contacts-block" }, [btn, out]);
  },

  async findContacts(btn, out, pdfs, f) {
    btn.disabled = true;
    const orig = btn.textContent;
    const emails = new Set(), phones = new Set(), sigs = [];
    let anyText = false, scanned = 0;
    try {
      for (const file of pdfs.slice(0, 3)) {
        btn.textContent = `Reading ${file.name.slice(0, 24)}…`;
        let res;
        try {
          const blob = await FERC.fileBlob(file.fileId);
          res = await Contacts.fromBlob(blob);
        } catch (e) {
          console.warn("extract failed", file.name, e);
          continue;
        }
        scanned++;
        if (res.hasText) anyText = true;
        res.emails.forEach((e) => emails.add(e));
        res.phones.forEach((p) => phones.add(p));
        for (const s of res.signatures) if (!sigs.includes(s)) sigs.push(s);
        // Stop early once we have a solid hit.
        if (emails.size && sigs.length) break;
      }
      this.renderContacts(out, f, [...emails], [...phones], sigs, anyText, scanned);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  },

  renderContacts(out, f, emails, phones, sigs, anyText, scanned) {
    const docket = f.dockets[0] ? Util.baseDocket(f.dockets[0]) : "";
    const kids = [];

    if (!scanned) {
      kids.push(Util.el("p", { class: "muted small" },
        "Couldn't read any PDF for this filing (it may be restricted)."));
    } else if (!anyText) {
      kids.push(Util.el("p", { class: "muted small" },
        "This PDF appears to be a scanned image with no embedded text, so contacts can't be extracted automatically."));
    } else if (!emails.length && !phones.length && !sigs.length) {
      kids.push(Util.el("p", { class: "muted small" },
        "No email, phone, or signature block detected in the text."));
    } else {
      if (emails.length) {
        kids.push(Util.el("div", { class: "contact-line" }, [
          Util.el("span", { class: "contact-label" }, "✉ Emails: "),
          ...emails.flatMap((e, i) => [
            i ? document.createTextNode(", ") : null,
            Util.el("a", { href: `mailto:${e}` }, e),
          ].filter(Boolean)),
        ]));
      }
      if (phones.length) {
        kids.push(Util.el("div", { class: "contact-line" }, [
          Util.el("span", { class: "contact-label" }, "☎ Phones: "),
          phones.join(", "),
        ]));
      }
      if (sigs.length) {
        kids.push(Util.el("div", { class: "contact-sig" }, [
          Util.el("span", { class: "contact-label" }, "Signature block: "),
          Util.el("span", {}, sigs[0]),
        ]));
      }
    }

    // Always offer the authoritative source.
    if (docket) {
      kids.push(Util.el("p", { class: "contact-fallback" }, [
        "Official contacts (verified email/phone/address): ",
        Util.el("a", { href: FERC.serviceListUrl(docket), target: "_blank", rel: "noopener" },
          `FERC Service List for ${docket} ↗`),
      ]));
    }
    out.replaceChildren(Util.el("div", { class: "contacts-card" }, kids));
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

  // "Filed by: <name> — <employer>", names/orgs link into People search.
  authorsLine(authors) {
    if (!authors || !authors.length) return null;
    const seen = new Set();
    const parts = [];
    for (const p of authors) {
      const key = Util.personKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      const bits = [];
      if (p.last) {
        const u = new URLSearchParams({ last: p.last });
        if (p.fi) u.set("fi", p.fi);
        bits.push(Util.el("a", { href: `#/people?${u.toString()}`, class: "author-name" }, Util.personName(p)));
      }
      if (p.org) {
        if (bits.length) bits.push(document.createTextNode(" — "));
        bits.push(Util.el("a", { href: `#/people?org=${encodeURIComponent(p.org)}`, class: "author-org" }, p.org));
      }
      if (bits.length) parts.push(Util.el("span", { class: "author-chip" }, bits));
    }
    if (!parts.length) return null;
    return Util.el("div", { class: "authors-line" },
      [Util.el("span", { class: "authors-label" }, "Filed by: "), ...parts]);
  },

  // Aggregate AUTHOR people across a set of filings into directory rows.
  aggregatePeople(filings) {
    const map = new Map();
    for (const f of filings) {
      const ts = Util.ts(f.filedDate);
      for (const p of f.authors) {
        if (!p.last && !p.org) continue;
        const key = Util.personKey(p);
        if (!map.has(key)) {
          map.set(key, {
            last: p.last, fi: p.fi, mi: p.mi, org: p.org,
            count: 0, firstTs: Infinity, lastTs: 0,
            firstDate: "", lastDate: "", filings: [],
          });
        }
        const g = map.get(key);
        g.count++;
        g.filings.push(f);
        if (ts && ts < g.firstTs) { g.firstTs = ts; g.firstDate = f.filedDate; }
        if (ts >= g.lastTs) { g.lastTs = ts; g.lastDate = f.filedDate; }
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
  },

  // Aggregate distinct employers across filings.
  aggregateOrgs(filings) {
    const map = new Map();
    for (const f of filings) {
      for (const org of new Set(f.authors.map((p) => p.org).filter(Boolean))) {
        const key = org.toLowerCase();
        if (!map.has(key)) map.set(key, { org, count: 0, people: new Set() });
        const g = map.get(key);
        g.count++;
        for (const p of f.authors) if (p.org === org && p.last) g.people.add(Util.personName(p));
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  },

  // Page through a filtered search up to a cap, for full aggregation.
  async fetchAll(opts, cap = 1000, onProgress) {
    const perPage = 100;
    let page = 1;
    const all = [];
    let total = Infinity;
    while (all.length < Math.min(cap, total)) {
      const res = await FERC.search({ ...opts, perPage, page });
      total = res.totalHits;
      all.push(...res.hits);
      if (onProgress) onProgress(all.length, total);
      if (!res.hits.length || page * perPage >= total) break;
      page++;
    }
    return { hits: all, total };
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
        this.docketPeoplePanel(docket, filings, res.totalHits > filings.length),
        Util.el("div", { class: "results" }, cards),
        this.pager(res.totalHits, res.page, res.perPage, goto),
      );
    } catch (e) {
      this.error(e, () => this.viewDocket(docket, params));
    }
  },

  // Panel listing the people & organizations that filed in a docket.
  docketPeoplePanel(docket, filings, partial) {
    const people = this.aggregatePeople(filings);
    const orgs = this.aggregateOrgs(filings);

    const peopleChips = people.length
      ? people.slice(0, 60).map((p) => {
          const u = new URLSearchParams({ last: p.last });
          if (p.fi) u.set("fi", p.fi);
          return Util.el("a", {
            class: "person-pill",
            href: p.last ? `#/people?${u.toString()}` : `#/people?org=${encodeURIComponent(p.org)}`,
            title: p.org,
          }, [Util.personName(p), Util.el("span", { class: "pill-count" }, String(p.count))]);
        })
      : [Util.el("span", { class: "muted" }, "No named filers found on this page.")];

    const orgChips = orgs.slice(0, 40).map((o) =>
      Util.el("a", {
        class: "person-pill org",
        href: `#/people?org=${encodeURIComponent(o.org)}`,
      }, [o.org, Util.el("span", { class: "pill-count" }, String(o.count))]));

    return Util.el("section", { class: "people-panel" }, [
      Util.el("div", { class: "people-panel-head" }, [
        Util.el("h3", {}, "People & organizations in this docket"),
        Util.el("a", {
          class: "btn btn-sm btn-ghost-dark",
          href: FERC.serviceListUrl(docket),
          target: "_blank", rel: "noopener",
          title: "FERC's official Service List has emails, phone numbers and mailing addresses",
        }, "Contacts (email/phone) at FERC ↗"),
      ]),
      partial ? Util.el("p", { class: "muted small" },
        "Showing filers from this page of the docket. Page through for the rest.") : null,
      Util.el("div", { class: "panel-sub" }, "People"),
      Util.el("div", { class: "pill-row" }, peopleChips),
      orgChips.length ? Util.el("div", { class: "panel-sub" }, "Organizations") : null,
      orgChips.length ? Util.el("div", { class: "pill-row" }, orgChips) : null,
    ]);
  },

  // ---- VIEW: people & organizations -----------------------------------------
  async viewPeople(params) {
    const last = (params.get("last") || "").trim();
    const fi = (params.get("fi") || "").trim();
    const org = (params.get("org") || "").trim();
    const page = parseInt(params.get("page") || "1", 10);
    const hasCriteria = !!(last || org);

    const form = this.peopleForm({ last, fi, org });
    this.root.replaceChildren(form, this.loadingInline());

    if (!hasCriteria) return this.peopleBrowse(form, params);

    try {
      const perPage = 50;
      const opts = { person: { lastName: last, firstInitial: fi, affiliation: org }, perPage, page };
      const res = await FERC.search(opts);

      const title = org && !last ? `Organization: ${org}`
        : `Person: ${last}${fi ? `, ${fi}` : ""}${org ? ` @ ${org}` : ""}`;

      const head = Util.el("div", { class: "view-head" }, [
        Util.el("h1", {}, title),
        Util.el("p", { class: "muted" },
          `${res.totalHits.toLocaleString()} filings match across all of FERC eLibrary.`),
        Util.el("p", { class: "note-contacts" }, [
          "ℹ️ Names are last-name + initial and employer only — FERC doesn't expose email/phone here. ",
          "Use the ", Util.el("strong", {}, "Contacts at FERC"),
          " link on any docket for the official Service List (emails, phones, addresses).",
        ]),
      ]);

      // Profile box, fleshed out by the "build full profile" scan.
      const profileBox = Util.el("div", { class: "profile-box" });
      const scanBtn = Util.el("button", { class: "btn btn-sm btn-primary" },
        `Build full profile — scan all ${res.totalHits.toLocaleString()} filings`);
      scanBtn.addEventListener("click", () => this.buildProfile(scanBtn, profileBox, opts, { last, fi, org }));
      profileBox.append(
        Util.el("p", { class: "muted small" },
          "Aggregate every employer, co-filer and docket for this query."),
        scanBtn);

      const goto = (p) => {
        const u = new URLSearchParams(params);
        u.set("page", p);
        location.hash = `#/people?${u.toString()}`;
      };

      const cards = res.hits.length
        ? res.hits.map((f) => this.filingCard(f))
        : [Util.el("p", { class: "muted pad" }, "No filings matched.")];

      this.root.replaceChildren(
        form, head, profileBox,
        Util.el("div", { class: "results-head" }, [
          Util.el("h2", {}, "Filings"),
          this.exportBar(res.hits, `people-${(last || org).replace(/\W+/g, "_")}`),
        ]),
        Util.el("div", { class: "results" }, cards),
        this.pager(res.totalHits, res.page, res.perPage, goto),
      );
    } catch (e) {
      this.root.replaceChildren(form);
      this.error(e, () => this.viewPeople(params));
    }
  },

  peopleForm({ last, fi, org }) {
    const form = Util.el("form", { class: "search-controls" });
    const lastI = Util.el("input", { type: "text", value: last, placeholder: "Last name (e.g. Darling)" });
    const fiI = Util.el("input", { type: "text", value: fi, placeholder: "Initial", maxlength: "1", class: "ctl-initial" });
    const orgI = Util.el("input", { type: "text", value: org, placeholder: "Employer / organization (e.g. Duke Energy)" });
    form.replaceChildren(
      Util.el("div", { class: "ctl-row" }, [
        Util.el("label", { class: "ctl-field" }, ["Last name", lastI]),
        Util.el("label", { class: "ctl-field" }, ["First initial", fiI]),
        Util.el("label", { class: "ctl-field grow" }, ["Employer", orgI]),
        Util.el("button", { class: "btn", type: "submit" }, "Find"),
      ]),
      Util.el("p", { class: "muted small" },
        "Search the whole FERC corpus by who filed. Fill in any field — last name, employer, or both."),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const u = new URLSearchParams();
      if (lastI.value.trim()) u.set("last", lastI.value.trim());
      if (fiI.value.trim()) u.set("fi", fiI.value.trim());
      if (orgI.value.trim()) u.set("org", orgI.value.trim());
      location.hash = u.toString() ? `#/people?${u.toString()}` : "#/people";
    });
    return form;
  },

  // Scan all matching filings and render an aggregated profile.
  async buildProfile(btn, box, opts, q) {
    btn.disabled = true;
    const orig = btn.textContent;
    const { hits, total } = await this.fetchAll(opts, 3000, (n, t) => {
      btn.textContent = `Scanning ${n}/${Math.min(t, 3000).toLocaleString()}…`;
    });

    const orgs = this.aggregateOrgs(hits);
    // Co-filers: other authors appearing alongside the queried person.
    const people = this.aggregatePeople(hits);
    const dockets = new Map();
    let firstTs = Infinity, lastTs = 0, firstD = "", lastD = "";
    for (const f of hits) {
      const ts = Util.ts(f.filedDate);
      if (ts && ts < firstTs) { firstTs = ts; firstD = f.filedDate; }
      if (ts >= lastTs) { lastTs = ts; lastD = f.filedDate; }
      for (const d of f.dockets) {
        const b = Util.baseDocket(d);
        dockets.set(b, (dockets.get(b) || 0) + 1);
      }
    }
    const topDockets = [...dockets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

    const stat = (label, val) => Util.el("div", { class: "stat" },
      [Util.el("div", { class: "stat-num" }, String(val)), Util.el("div", { class: "stat-label" }, label)]);

    box.replaceChildren(
      Util.el("div", { class: "stats-row" }, [
        stat("filings scanned", hits.length.toLocaleString() + (total > hits.length ? `/${total.toLocaleString()}` : "")),
        stat("employers", orgs.length),
        stat("dockets", dockets.size),
        stat("active since", firstD || "—"),
        stat("last filed", lastD || "—"),
      ]),
      Util.el("div", { class: "profile-cols" }, [
        Util.el("div", {}, [
          Util.el("div", { class: "panel-sub" }, "Employers"),
          Util.el("div", { class: "pill-row" }, orgs.slice(0, 30).map((o) =>
            Util.el("a", { class: "person-pill org", href: `#/people?org=${encodeURIComponent(o.org)}` },
              [o.org, Util.el("span", { class: "pill-count" }, String(o.count))]))),
        ]),
        Util.el("div", {}, [
          Util.el("div", { class: "panel-sub" }, "Dockets"),
          Util.el("div", { class: "pill-row" }, topDockets.map(([d, c]) =>
            Util.el("a", { class: "person-pill", href: `#/docket/${encodeURIComponent(d)}` },
              [d, Util.el("span", { class: "pill-count" }, String(c))]))),
        ]),
      ]),
      Util.el("div", { class: "export-bar" }, [
        Util.el("button", { class: "btn btn-sm", onclick: () =>
          Util.saveText(Util.peopleToCsv(people), `people_${(q.last || q.org).replace(/\W+/g, "_")}.csv`, "text/csv") },
          "⬇ People CSV"),
        Util.el("button", { class: "btn btn-sm", onclick: () =>
          Util.saveText(Util.filingsToCsv(hits), `filings_${(q.last || q.org).replace(/\W+/g, "_")}.csv`, "text/csv") },
          `⬇ All ${hits.length} filings (CSV)`),
      ]),
    );
    btn.textContent = orig;
  },

  // Browse mode: a directory of people active in a recent time window.
  async peopleBrowse(form, params) {
    const days = parseInt(params.get("days") || "3", 10);
    this.root.replaceChildren(form, this.loadingInline());
    try {
      const end = new Date();
      const start = Util.daysAgo(days);
      const { hits } = await this.fetchAll(
        { text: "*", startDate: Util.fmtDate(start), endDate: Util.fmtDate(end), dateType: "filed_date" },
        1500);

      const people = this.aggregatePeople(hits);
      const orgs = this.aggregateOrgs(hits);

      const head = Util.el("div", { class: "view-head" }, [
        Util.el("h1", {}, "People directory"),
        Util.el("p", { class: "muted" },
          `${people.length.toLocaleString()} people from ${orgs.length.toLocaleString()} organizations filed in the last ${days} day(s). Use the form above to look anyone up across all of FERC history.`),
        Util.el("div", { class: "window-controls" },
          [1, 3, 7, 14].map((n) =>
            Util.el("a", { class: "chip" + (n === days ? " active" : ""), href: `#/people?days=${n}` },
              n === 1 ? "Today" : `${n} days`))),
      ]);

      // Client-side filter box over the loaded directory.
      const filter = Util.el("input", { type: "text", class: "ctl-q", placeholder: "Filter this list by name or employer…" });
      const listWrap = Util.el("div", { class: "people-grid" });
      const render = (q) => {
        const ql = q.toLowerCase();
        const rows = people.filter((p) =>
          !ql || Util.personName(p).toLowerCase().includes(ql) || p.org.toLowerCase().includes(ql));
        listWrap.replaceChildren(...rows.slice(0, 400).map((p) => {
          const u = new URLSearchParams({ last: p.last });
          if (p.fi) u.set("fi", p.fi);
          return Util.el("a", {
            class: "people-card",
            href: p.last ? `#/people?${u.toString()}` : `#/people?org=${encodeURIComponent(p.org)}`,
          }, [
            Util.el("div", { class: "pc-name" }, Util.personName(p)),
            Util.el("div", { class: "pc-org" }, p.org || "—"),
            Util.el("div", { class: "pc-meta" }, `${p.count} filing${p.count === 1 ? "" : "s"} · latest ${Util.date(p.lastDate)}`),
          ]);
        }));
        if (!rows.length) listWrap.replaceChildren(Util.el("p", { class: "muted pad" }, "No matches."));
      };
      filter.addEventListener("input", () => render(filter.value));
      render("");

      this.root.replaceChildren(form, head,
        Util.el("div", { class: "results-head" }, [filter,
          Util.el("button", { class: "btn btn-sm", onclick: () =>
            Util.saveText(Util.peopleToCsv(people), `people_last_${days}d.csv`, "text/csv") }, "⬇ People CSV"),
        ]),
        listWrap);
    } catch (e) {
      this.root.replaceChildren(form);
      this.error(e, () => this.peopleBrowse(form, params));
    }
  },

  // ---- VIEW: companies (contact sheets) -------------------------------------
  viewCompanies(params) {
    const org = (params.get("org") || "").trim();
    if (org) return this.companySheet(org, params);
    return this.companyBrowse(params);
  },

  companyForm(org) {
    const form = Util.el("form", { class: "search-controls" });
    const input = Util.el("input", { type: "text", value: org || "", placeholder: "Company / organization name (e.g. Duke Energy Carolinas, LLC)", class: "ctl-q" });
    form.replaceChildren(
      Util.el("div", { class: "ctl-row" }, [
        input, Util.el("button", { class: "btn", type: "submit" }, "Build contact sheet"),
      ]),
      Util.el("p", { class: "muted small" },
        "Pick a company below or type one. The app pulls that company's filings from the last 5 years, reads the PDFs, and extracts the signatures into a table."),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      location.hash = v ? `#/companies?org=${encodeURIComponent(v)}` : "#/companies";
    });
    return form;
  },

  async companyBrowse(params) {
    const form = this.companyForm("");
    this.root.replaceChildren(form, this.loadingInline());
    try {
      const { hits } = await this.fetchAll(
        { text: "*", startDate: Util.fmtDate(Util.daysAgo(4)), endDate: Util.fmtDate(new Date()), dateType: "filed_date" },
        1500);
      const orgs = this.aggregateOrgs(hits);
      const head = Util.el("div", { class: "view-head" }, [
        Util.el("h1", {}, "Companies"),
        Util.el("p", { class: "muted" },
          `${orgs.length.toLocaleString()} organizations filed in the last few days. Pick one to build its contact sheet, or search any company above.`),
        Util.el("p", { class: "note-contacts" }, [
          "ℹ️ Contacts are parsed from the signature blocks of the company's filings over the last 5 years — best-effort. Scanned-image filings can't be read; always verify against FERC's Service List (linked on the sheet).",
        ]),
      ]);
      const filter = Util.el("input", { type: "text", class: "ctl-q", placeholder: "Filter companies…" });
      const grid = Util.el("div", { class: "people-grid" });
      const render = (q) => {
        const ql = q.toLowerCase();
        const rows = orgs.filter((o) => !ql || o.org.toLowerCase().includes(ql));
        grid.replaceChildren(...rows.slice(0, 400).map((o) =>
          Util.el("a", { class: "people-card", href: `#/companies?org=${encodeURIComponent(o.org)}` }, [
            Util.el("div", { class: "pc-name" }, o.org),
            Util.el("div", { class: "pc-meta" }, `${o.count} filing${o.count === 1 ? "" : "s"} recently · ${o.people.size} known signer(s)`),
          ])));
        if (!rows.length) grid.replaceChildren(Util.el("p", { class: "muted pad" }, "No matches."));
      };
      filter.addEventListener("input", () => render(filter.value));
      render("");
      this.root.replaceChildren(form, head, Util.el("div", { class: "results-head" }, [filter]), grid);
    } catch (e) {
      this.root.replaceChildren(form);
      this.error(e, () => this.companyBrowse(params));
    }
  },

  // Collect a company's filings (last 5 yrs), keeping only exact-org matches
  // (the server filter is fuzzy), up to `cap`.
  async collectCompanyFilings(org, cap, onProgress) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(org);
    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - 5);
    const sd = Util.fmtDate(start), ed = Util.fmtDate(end);
    const matched = [];
    let page = 1, total = Infinity, scanned = 0;
    while (matched.length < cap && page <= 40) {
      const res = await FERC.search({
        person: { affiliation: org }, startDate: sd, endDate: ed, dateType: "filed_date",
        perPage: 100, page,
      });
      total = res.totalHits;
      for (const f of res.hits) {
        if (f.authors.some((a) => {
          const n = norm(a.org);
          return n && (n === target || n.includes(target) || target.includes(n));
        })) matched.push(f);
      }
      scanned += res.hits.length;
      if (onProgress) onProgress(matched.length, total);
      if (!res.hits.length || page * 100 >= total) break;
      page++;
    }
    return { matched: matched.slice(0, cap), total };
  },

  async companySheet(org, params) {
    const scanCap = parseInt(params.get("scan") || "25", 10);
    const head = Util.el("div", { class: "view-head" }, [
      Util.el("h1", {}, org),
      Util.el("p", { class: "muted" }, "Building contact sheet from the last 5 years of filings…"),
    ]);
    const progress = Util.el("div", { class: "loading" }, [
      Util.el("div", { class: "spinner" }), Util.el("p", { class: "prog-msg" }, "Finding filings…"),
    ]);
    const msg = progress.querySelector(".prog-msg");
    this.root.replaceChildren(head, progress);

    try {
      const { matched, total } = await this.collectCompanyFilings(org, scanCap,
        (m, t) => { msg.textContent = `Finding filings… ${m} matched of ${t.toLocaleString()}`; });

      const contacts = [];
      const seen = new Set();
      let withText = 0, processed = 0;
      for (const f of matched) {
        processed++;
        msg.textContent = `Reading PDFs… filing ${processed} of ${matched.length} (${contacts.length} contacts so far)`;
        const pdfs = f.files
          .filter((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name))
          .sort((a, b) => (/(transmit|letter|cover|sig)/i.test(b.name) ? 1 : 0) - (/(transmit|letter|cover|sig)/i.test(a.name) ? 1 : 0));
        for (const file of pdfs.slice(0, 2)) {
          let lines;
          try { lines = await Contacts.extractLines(await FERC.fileBlob(file.fileId)); }
          catch { continue; }
          if (lines.join("").trim().length > 30) withText++;
          for (const c of Contacts.parseStructured(lines)) {
            const key = (c.email || `${c.name}|${c.phone}`).trim().toLowerCase();
            if (!key || key === "|" || seen.has(key)) continue;
            seen.add(key);
            contacts.push({ ...c, accession: f.accession, docket: f.dockets[0] ? Util.baseDocket(f.dockets[0]) : "" });
          }
        }
      }
      contacts.sort((a, b) => (a.name || "~").localeCompare(b.name || "~"));
      this.renderCompanySheet(org, contacts, { matched: matched.length, total, withText, scanCap });
    } catch (e) {
      this.error(e, () => this.companySheet(org, params));
    }
  },

  renderCompanySheet(org, contacts, info) {
    const dockets = [...new Set(contacts.map((c) => c.docket).filter(Boolean))].slice(0, 12);
    const base = `FERC_${org.replace(/\W+/g, "_").slice(0, 40)}_contacts`;

    const head = Util.el("div", { class: "view-head" }, [
      Util.el("h1", {}, org),
      Util.el("p", { class: "muted" },
        `${contacts.length} distinct contact(s) from ${info.matched} of ${info.total.toLocaleString()} filings scanned (${info.withText} had readable text).`),
      Util.el("p", { class: "note-contacts" },
        "Best-effort extraction from PDF signature blocks — fields can be imperfect or blank, and scanned-image filings yield nothing. Verify against FERC's official Service List below."),
      Util.el("div", { class: "export-bar" }, [
        Util.el("button", { class: "btn btn-sm", onclick: () =>
          Util.saveText(Util.contactsToCsv(contacts), `${base}.csv`, "text/csv") }, "⬇ Contacts CSV"),
        Util.el("a", { class: "btn btn-sm btn-ghost-dark", href: `#/companies?org=${encodeURIComponent(org)}&scan=${info.scanCap + 25}` },
          `Scan more filings (${info.scanCap} → ${info.scanCap + 25})`),
      ]),
    ]);

    let table;
    if (!contacts.length) {
      table = Util.el("p", { class: "muted pad" },
        "No contacts could be extracted — this company's recent filings may be scanned images. Try the Service List links, or 'Scan more filings'.");
    } else {
      const th = (t) => Util.el("th", {}, t);
      const td = (c) => Util.el("td", {}, c);
      const rows = contacts.map((c) => Util.el("tr", {}, [
        td(c.name || "—"),
        td(c.title || "—"),
        td(c.phone ? Util.el("a", { href: `tel:${c.phone.replace(/[^\d+]/g, "")}` }, c.phone) : "—"),
        td(c.email ? Util.el("a", { href: `mailto:${c.email}` }, c.email) : "—"),
        td(c.address || "—"),
        Util.el("td", { class: "src-cell" }, c.accession
          ? Util.el("a", { href: FERC.docInfoUrl(c.accession), target: "_blank", rel: "noopener", title: c.accession }, "↗")
          : ""),
      ]));
      table = Util.el("div", { class: "table-wrap" }, [
        Util.el("table", { class: "contact-table" }, [
          Util.el("thead", {}, Util.el("tr", {}, [th("Name"), th("Title"), th("Phone"), th("Email"), th("Address"), th("Src")])),
          Util.el("tbody", {}, rows),
        ]),
      ]);
    }

    const serviceLinks = dockets.length
      ? Util.el("div", { class: "people-panel" }, [
          Util.el("div", { class: "panel-sub" }, "Verify contacts on FERC's official Service List"),
          Util.el("div", { class: "pill-row" }, dockets.map((d) =>
            Util.el("a", { class: "person-pill", href: FERC.serviceListUrl(d), target: "_blank", rel: "noopener" },
              [d, Util.el("span", { class: "pill-count" }, "↗")]))),
        ])
      : null;

    this.root.replaceChildren(this.companyForm(org), head, table, serviceLinks);
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
