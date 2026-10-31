const sites = new Map([
  ["ssj.lol", "ssjlol"],
  ["milltender.ssj.lol", "milltender"],
  ["hfmodem.ssj.lol", "hfmodem"],
  ["thundergate.io", "thundergate"],
]);

async function count(code, hit, token) {
  try {
    const response = await fetch(`https://${code}.goatcounter.com/api/v0/count`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hits: [hit] }),
    });
    if (!response.ok) console.error("GoatCounter count failed:", response.status);
  } catch (error) {
    console.error("GoatCounter count failed:", error);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const code = sites.get(url.hostname);
    if (!code) return fetch(request);

    const headers = request.headers;
    const destination = headers.get("Sec-Fetch-Dest");
    // Older browsers omit Sec-Fetch-Dest; fall back to what they accept.
    const navigation = request.method === "GET" && (destination === null
      ? /text\/html/.test(headers.get("Accept") || "")
      : destination === "document");

    // A browser revalidating a page cached before the script was stripped would
    // get a 304 and keep running count.js, so page loads always get a full response.
    const upstream = new Request(request);
    if (navigation) {
      upstream.headers.delete("If-None-Match");
      upstream.headers.delete("If-Modified-Since");
    }
    const response = await fetch(upstream);
    if (!/^text\/html\b/i.test(response.headers.get("Content-Type") || "")) return response;

    const purpose = `${headers.get("Sec-Purpose") || ""} ${headers.get("Purpose") || ""}`;
    if (response.status === 200 && navigation &&
        !/prefetch|prerender/i.test(purpose) && !request.cf?.verifiedBotCategory) {
      const hit = {
        path: url.pathname,
        ip: headers.get("CF-Connecting-IP") || "",
        user_agent: headers.get("User-Agent") || "",
      };
      if (url.search) hit.query = url.search.slice(1);
      if (headers.has("Referer")) hit.ref = headers.get("Referer");
      const language = headers.get("Accept-Language")?.split(/[,;]/)[0].trim();
      if (language && language !== "*") hit.language = language;
      const country = request.cf?.country;
      if (/^[A-Z]{2}$/.test(country || "") && country !== "XX") hit.location = country;
      ctx.waitUntil(count(code, hit, env.GOATCOUNTER_TOKEN));
    }

    // Revisits must reach the Worker to be counted; the edge cache is unaffected.
    const page = new Response(response.body, response);
    page.headers.set("Cache-Control", "no-cache");
    return new HTMLRewriter()
      .on("script[data-goatcounter]", { element(element) { element.remove(); } })
      .transform(page);
  },
};
