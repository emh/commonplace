const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export class CommonplaceRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const cors = corsHeaders(request, this.env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!isAllowedOrigin(request, this.env)) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    const url = new URL(request.url);
    const route = parseRoute(url.pathname);
    if (!route) return json({ error: "Not found" }, 404, cors);

    try {
      if (route.action === "" && request.method === "POST") {
        return this.createRoom(request, route, cors);
      }

      if (route.action === "sync" && request.method === "GET") {
        return this.handleWebSocket(request);
      }

      if (route.action === "sync" && request.method === "POST") {
        return this.handleHttpSync(request, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      return json({ error: messageFromError(error) }, error?.status || 400, cors);
    }
  }

  async createRoom(request, route, cors) {
    if (request.headers.get("X-Commonplace-Internal-Create") !== "1") {
      return json({ error: "Not found" }, 404, cors);
    }

    const existing = await this.getRoom();
    if (existing) return json({ error: "Room code already exists" }, 409, cors);

    const room = { code: route.code, createdAt: new Date().toISOString() };
    await this.state.storage.put("room", room);
    return json({ room }, 200, cors);
  }

  async handleWebSocket(request) {
    await this.requireRoom();

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected WebSocket upgrade" }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleHttpSync(request, cors) {
    await this.requireRoom();
    const body = await readJson(request);
    const incomingVersion = typeof body.version === "string" ? body.version : "";
    const incomingSnapshot = body.snapshot || null;

    const stored = await this.getStoredState();

    if (incomingSnapshot && isNewer(incomingVersion, stored.version)) {
      const next = { version: incomingVersion, snapshot: incomingSnapshot };
      await this.state.storage.put("state", next);
      this.broadcast(null, { type: "snapshot", version: incomingVersion, snapshot: incomingSnapshot });
      return json({ version: incomingVersion, snapshot: incomingSnapshot }, 200, cors);
    }

    return json(
      stored.snapshot
        ? { version: stored.version, snapshot: stored.snapshot }
        : { version: "", snapshot: null },
      200,
      cors
    );
  }

  async webSocketMessage(socket, raw) {
    try {
      const message = parseSocketMessage(raw);

      if (message.type === "sync") {
        const stored = await this.getStoredState();
        socket.send(JSON.stringify({
          type: "snapshot",
          version: stored.version || "",
          snapshot: stored.snapshot || null
        }));
        return;
      }

      if (message.type === "push") {
        const incomingVersion = typeof message.version === "string" ? message.version : "";
        const incomingSnapshot = message.snapshot || null;

        if (!incomingSnapshot) {
          socket.send(JSON.stringify({ type: "error", message: "Snapshot is required" }));
          return;
        }

        const stored = await this.getStoredState();

        if (isNewer(incomingVersion, stored.version)) {
          await this.state.storage.put("state", { version: incomingVersion, snapshot: incomingSnapshot });
          socket.send(JSON.stringify({ type: "ack", version: incomingVersion }));
          this.broadcast(socket, { type: "snapshot", version: incomingVersion, snapshot: incomingSnapshot });
        } else {
          socket.send(JSON.stringify({ type: "ack", version: stored.version }));
          if (stored.snapshot) {
            socket.send(JSON.stringify({ type: "snapshot", version: stored.version, snapshot: stored.snapshot }));
          }
        }
        return;
      }

      socket.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: messageFromError(error) }));
    }
  }

  webSocketClose() {}
  webSocketError() {}

  broadcast(sender, message) {
    const raw = JSON.stringify(message);
    for (const socket of this.state.getWebSockets()) {
      if (socket !== sender) {
        try { socket.send(raw); } catch {}
      }
    }
  }

  async getStoredState() {
    return await this.state.storage.get("state") || { version: "", snapshot: null };
  }

  async getRoom() {
    return await this.state.storage.get("room") || null;
  }

  async requireRoom() {
    const room = await this.getRoom();
    if (!room) throw statusError("Room not found", 404);
    return room;
  }
}

export class CommonplaceShare {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const cors = corsHeaders(request, this.env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.includes("/create")) {
      return this.createShare(request, cors);
    }

    if (request.method === "GET") {
      if (!isAllowedOrigin(request, this.env)) {
        return json({ error: "Origin not allowed" }, 403, cors);
      }
      return this.getShare(cors);
    }

    return json({ error: "Not found" }, 404, cors);
  }

  async createShare(request, cors) {
    if (request.headers.get("X-Commonplace-Internal-Create") !== "1") {
      return json({ error: "Not found" }, 404, cors);
    }

    const existing = await this.state.storage.get("share");
    if (existing) return json({ share: existing }, 409, cors);

    const body = await readJson(request);
    const card = normalizeShareCard(body.card);
    if (!card) return json({ error: "Card is required" }, 400, cors);

    const share = {
      code: body.code,
      card,
      appUrl: String(body.appUrl || "").trim(),
      createdAt: new Date().toISOString()
    };
    await this.state.storage.put("share", share);
    return json({ share }, 200, cors);
  }

  async getShare(cors) {
    const share = await this.state.storage.get("share");
    if (!share) return json({ error: "Share not found" }, 404, cors);
    return json({ share }, 200, cors);
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // GET /share/cards/{code} — HTML preview (no origin check, browser navigation)
    const sharePreviewRoute = parseSharePreviewRoute(url.pathname);
    if (sharePreviewRoute && request.method === "GET") {
      return serveSharePreview(sharePreviewRoute.code, env, url);
    }

    if (!isAllowedOrigin(request, env)) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    // POST /api/shares — create a card share
    if (request.method === "POST" && url.pathname === "/api/shares") {
      return createShare(request, env, cors);
    }

    // GET /api/shares/{code} — retrieve share card data
    const shareDataRoute = parseShareDataRoute(url.pathname);
    if (shareDataRoute) {
      const id = env.COMMONPLACE_SHARE.idFromName(`share:${shareDataRoute.code}`);
      const shareDo = env.COMMONPLACE_SHARE.get(id);
      return shareDo.fetch(request);
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      return createRoomWithFreshCode(request, env, cors);
    }

    const route = parseRoute(url.pathname);
    if (!route) return json({ error: "Not found" }, 404, cors);

    const id = env.COMMONPLACE_ROOM.idFromName(`room:${route.code}`);
    const room = env.COMMONPLACE_ROOM.get(id);
    return room.fetch(request);
  }
};

async function createRoomWithFreshCode(request, env, cors) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode();
    const id = env.COMMONPLACE_ROOM.idFromName(`room:${code}`);
    const room = env.COMMONPLACE_ROOM.get(id);
    const url = new URL(request.url);
    url.pathname = `/api/rooms/${code}`;

    const response = await room.fetch(new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": request.headers.get("Origin") || "",
        "X-Commonplace-Internal-Create": "1"
      },
      body: "{}"
    }));

    if (response.status !== 409) return response;
  }

  return json({ error: "Could not create room code" }, 500, cors);
}

export function parseRoute(pathname) {
  const match = /^\/api\/rooms\/([A-Za-z0-9]+)(?:\/(sync))?\/?$/.exec(pathname);
  if (!match) return null;
  return {
    code: normalizeCode(match[1]),
    action: match[2] || ""
  };
}

function parseShareDataRoute(pathname) {
  const match = /^\/api\/shares\/([A-Za-z0-9]+)\/?$/.exec(pathname);
  if (!match) return null;
  return { code: normalizeCode(match[1]) };
}

function parseSharePreviewRoute(pathname) {
  const match = /^\/share\/cards\/([A-Za-z0-9]+)\/?$/.exec(pathname);
  if (!match) return null;
  return { code: normalizeCode(match[1]) };
}

async function createShare(request, env, cors) {
  const body = await readJson(request);
  const card = normalizeShareCard(body.card);
  if (!card) return json({ error: "Card is required" }, 400, cors);
  const appUrl = String(body.appUrl || "").trim();

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode();
    const id = env.COMMONPLACE_SHARE.idFromName(`share:${code}`);
    const shareDo = env.COMMONPLACE_SHARE.get(id);
    const createUrl = new URL(request.url);
    createUrl.pathname = `/api/shares/${code}/create`;

    const response = await shareDo.fetch(new Request(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Commonplace-Internal-Create": "1" },
      body: JSON.stringify({ code, card, appUrl })
    }));

    if (response.status !== 409) {
      if (!response.ok) return json({ error: "Could not create share" }, 500, cors);
      const shareUrl = `${new URL(request.url).origin}/share/cards/${encodeURIComponent(code)}`;
      return json({ code, shareUrl }, 200, cors);
    }
  }

  return json({ error: "Could not create share" }, 500, cors);
}

async function serveSharePreview(code, env, requestUrl) {
  try {
    const id = env.COMMONPLACE_SHARE.idFromName(`share:${code}`);
    const shareDo = env.COMMONPLACE_SHARE.get(id);
    const getUrl = new URL(requestUrl);
    getUrl.pathname = `/api/shares/${code}`;

    const response = await shareDo.fetch(new Request(getUrl, { method: "GET" }));
    if (!response.ok) {
      return new Response("Share not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }

    const { share } = await response.json();
    const previewUrl = `${requestUrl.origin}/share/cards/${encodeURIComponent(code)}`;
    const appUrl = buildCardAppUrl(share, env, code);
    const html = cardSharePreviewHtml({ card: share.card, appUrl, previewUrl });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch {
    return new Response("Share not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
}

function buildCardAppUrl(share, env, code) {
  const candidates = [share.appUrl, env.APP_BASE_URL];
  for (const base of candidates) {
    if (!base) continue;
    try {
      const url = new URL(base);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      url.searchParams.set("share", code);
      url.hash = "";
      return url.toString();
    } catch {}
  }
  return "";
}

function cardSharePreviewHtml({ card, appUrl, previewUrl }) {
  const isVocab = card.type === "vocab";
  let title, description;

  if (isVocab) {
    title = card.word ? `${card.word} — commonplace` : "commonplace";
    description = card.definition || "";
  } else {
    const src = card.source?.title ? ` — ${card.source.title}` : "";
    const preview = String(card.content || "").slice(0, 100);
    const ellipsis = card.content.length > 100 ? "…" : "";
    title = preview ? `“${preview}${ellipsis}”${src}` : "commonplace";
    description = String(card.content || "").slice(0, 240);
  }

  const redirectScript = appUrl ? `<script>location.replace(${safeJsonForScript(appUrl)});</script>` : "";
  const redirectMeta = appUrl ? `<meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}">` : "";
  const canonical = appUrl ? `<link rel="canonical" href="${escapeHtml(appUrl)}">` : "";
  const openLink = appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open in commonplace</a></p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${canonical}
  ${redirectMeta}
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="commonplace">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(previewUrl)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
</head>
<body>
  ${openLink}
  ${redirectScript}
</body>
</html>`;
}

function normalizeShareCard(input) {
  if (!input || typeof input !== "object") return null;

  if (input.type === "vocab") {
    const word = String(input.word || "").trim();
    if (!word) return null;
    return {
      type: "vocab",
      word,
      partOfSpeech: String(input.partOfSpeech || "").trim(),
      phonetic: String(input.phonetic || "").trim(),
      definition: String(input.definition || "").trim()
    };
  }

  const content = String(input.content || "").trim();
  if (!content) return null;

  const raw = input.source;
  const source = raw && typeof raw === "object" ? {
    title: String(raw.title || "").trim(),
    subtitle: String(raw.subtitle || "").trim(),
    author: String(raw.author || "").trim(),
    url: String(raw.url || "").trim(),
    page: String(raw.page || "").trim()
  } : null;

  return { type: "note", content, source };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function isNewer(incoming, current) {
  if (!incoming) return false;
  if (!current) return true;
  return compareHlc(incoming, current) > 0;
}

function compareHlc(left, right) {
  const a = parseHlc(left);
  const b = parseHlc(right);
  if (a.wallTime !== b.wallTime) return a.wallTime < b.wallTime ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.deviceId.localeCompare(b.deviceId);
}

function parseHlc(value) {
  const [wallTime, counter, ...deviceParts] = String(value || "").split(":");
  return {
    wallTime: Number.parseInt(wallTime, 10) || 0,
    counter: Number.parseInt(counter, 10) || 0,
    deviceId: deviceParts.join(":")
  };
}

function generateCode(length = CODE_LENGTH) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseSocketMessage(raw) {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return JSON.parse(text);
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && isAllowedOrigin(request, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = allowedOrigins(env);
  return allowed.includes("*") || allowed.includes(origin);
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
}

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
  });
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function messageFromError(error) {
  return error instanceof Error ? error.message : "Request failed";
}
