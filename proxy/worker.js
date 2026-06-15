// FERC Navigator CORS proxy (Cloudflare Worker).
//
// FERC's eLibrary API rejects browser CORS preflight (OPTIONS) requests, so a
// static site can't call it directly. This Worker sits in between: the browser
// calls the Worker (which answers preflight + adds CORS headers), and the
// Worker calls FERC server-to-server (where CORS doesn't apply).
//
// It transparently forwards any /eLibrarywebapi/... path — JSON search calls
// and binary PDF downloads alike — preserving method, body and content type.

const FERC_ORIGIN = "https://elibrary.ferc.gov";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Expose-Headers": "Content-Disposition",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // Preflight: answer it ourselves so the browser proceeds.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Only proxy the eLibrary web API; everything else gets a friendly note.
    if (!url.pathname.startsWith("/eLibrarywebapi/")) {
      return new Response(
        "FERC Navigator proxy is running. It forwards /eLibrarywebapi/... to FERC eLibrary.",
        { status: 200, headers: { ...CORS, "content-type": "text/plain" } }
      );
    }

    const target = FERC_ORIGIN + url.pathname + url.search;
    const init = {
      method: request.method,
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
        accept: "application/json, text/plain, */*",
      },
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
    };

    let resp;
    try {
      resp = await fetch(target, init);
    } catch (e) {
      return new Response(JSON.stringify({ error: "proxy fetch failed", detail: String(e) }), {
        status: 502,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    // Pass the body straight through (works for JSON and binary PDFs), but
    // replace headers with permissive CORS ones.
    const headers = new Headers();
    const ct = resp.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const cd = resp.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

    return new Response(resp.body, { status: resp.status, headers });
  },
};
