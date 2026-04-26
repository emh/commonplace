const FETCH_TIMEOUT_MS = 10_000;
const BROWSER_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/fetch") {
      return json({ error: "Not found" }, 404, cors);
    }

    try {
      const body = await request.json();
      const articleUrl = normalizeUrl(body.url);
      const { title, author } = await fetchPageInfo(articleUrl);
      return json({ title, author, url: articleUrl }, 200, cors);
    } catch (error) {
      return json({ error: messageFromError(error) }, 400, cors);
    }
  }
};

function normalizeUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("URL is required");
  }
  const text = input.trim();
  const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  parsed.hash = "";
  return parsed.toString();
}

async function fetchPageInfo(articleUrl) {
  const signal = AbortSignal.timeout
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(), FETCH_TIMEOUT_MS); return c.signal; })();

  const response = await fetch(articleUrl, { headers: BROWSER_HEADERS, signal });
  if (!response.ok) {
    throw new Error(`Page returned ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new Error("URL did not return an HTML page");
  }

  const html = await response.text();
  const finalUrl = response.url || articleUrl;
  const hostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const title = getMeta(html, ["og:title", "twitter:title"]) || getTitle(html) || hostname;

  return { title: cleanTitle(title), author: hostname };
}

function getMeta(html, names) {
  for (const name of names) {
    const pat = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escapeRegExp(name)}["'][^>]*content=["']([^"']+)["']`, "i");
    const rev = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escapeRegExp(name)}["']`, "i");
    const match = html.match(pat) || html.match(rev);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return "";
}

function getTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeEntities(match[1].replace(/\s+/g, " ").trim()) : "";
}

function cleanTitle(title) {
  // Strip common " | Site Name" or " - Site Name" suffixes
  return title.replace(/\s*[|–—-]\s*[^|–—-]{3,}$/, "").trim() || title;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  const allowOrigin = origin && (allowed.includes("*") || allowed.includes(origin)) ? origin : "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
  });
}

function messageFromError(error) {
  return error instanceof Error ? error.message : "Request failed";
}
