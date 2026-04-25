export function createCard(input = {}) {
  return hydrateCard(
    {
      id: input.id || createCardId(),
      content: input.content || "",
      source: input.source || null,
      createdAt: input.createdAt || new Date().toISOString()
    },
    0
  );
}

export function hydrateCard(card, index = 0) {
  const raw = card || {};
  const fallbackId = `card-${index + 1}`;
  const createdAt = normalizeDate(raw.createdAt);

  return {
    id: String(raw.id || "").trim() || fallbackId,
    content: String(raw.content || "").trim(),
    source: hydrateSource(raw.source),
    createdAt
  };
}

export function formatSourceDisplay(source) {
  const s = hydrateSource(source);
  if (!s.title) return "";

  let text = s.title;
  if (s.subtitle) text += `: ${s.subtitle}`;
  if (s.author) text += ` — ${s.author}`;
  if (s.page) text += `, p. ${s.page}`;
  return text;
}

export function parseKindleHighlight(text) {
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  // Kindle pastes always end with "Kindle Edition."
  if (!normalized.endsWith("Kindle Edition.")) return null;

  // Content and attribution are separated by a blank line
  const blankIdx = normalized.lastIndexOf("\n\n");
  if (blankIdx === -1) return null;

  const content = normalized.slice(0, blankIdx).trim();
  let attr = normalized.slice(blankIdx + 2).trim();
  if (!content || !attr) return null;

  // Strip "Kindle Edition." from the end
  attr = attr.slice(0, attr.lastIndexOf("Kindle Edition.")).trim();

  // Extract page number "(p. N)" and truncate everything from that point on
  // (publisher cruft like "(Function)." follows the page number)
  let page = "";
  const pageMatch = attr.match(/\(p\.\s*(\d+)\)/);
  if (pageMatch) {
    page = pageMatch[1];
    attr = attr.slice(0, attr.indexOf(pageMatch[0])).trim();
  } else {
    // No page — strip any trailing "(Something)." publisher tokens
    attr = attr.replace(/(\s*\([^)]+\)\.)+\s*$/, "").trim();
  }

  // Strip stray trailing period (e.g. from page-less attributions)
  if (attr.endsWith(".")) attr = attr.slice(0, -1).trim();

  // attr is now: "Last, First. Title: Subtitle"
  // Split on the first ". " to separate author from title
  const dotSpaceIdx = attr.indexOf(". ");
  if (dotSpaceIdx === -1) return null;

  const authorRaw = attr.slice(0, dotSpaceIdx).trim();
  const titleFull = attr.slice(dotSpaceIdx + 2).trim();
  if (!titleFull) return null;

  // Reformat "Last, First" → "First Last"
  const commaIdx = authorRaw.indexOf(",");
  const author = commaIdx !== -1
    ? `${authorRaw.slice(commaIdx + 1).trim()} ${authorRaw.slice(0, commaIdx).trim()}`.trim()
    : authorRaw;

  // Split title and subtitle on first colon
  let title = titleFull;
  let subtitle = "";
  const colonIdx = titleFull.indexOf(":");
  if (colonIdx !== -1) {
    title = titleFull.slice(0, colonIdx).trim();
    subtitle = titleFull.slice(colonIdx + 1).trim();
  }

  if (!title) return null;

  return { content, source: { title, subtitle, author, page } };
}

export function hydrateCards(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }

  const normalized = cards
    .filter((card) => card && typeof card === "object")
    .map((card, index) => hydrateCard(card, index))
    .filter((card) => card.content);

  return normalized.length > 0 ? sortCardsDescending(normalized) : [];
}

export function sortCardsDescending(cards) {
  return cards
    .slice()
    .sort((left, right) => toEpoch(right.createdAt) - toEpoch(left.createdAt));
}

export function formatLongDate(dateValue) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(dateValue));
}

export function formatCardTimestamp(dateValue) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(dateValue));
}

export function formatRelativeTime(dateValue) {
  const diff = Date.now() - toEpoch(dateValue);

  if (diff < 60_000) {
    return "just now";
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }

  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }

  return formatCardTimestamp(dateValue);
}

export function formatCardCount(count) {
  return `${count} ${count === 1 ? "card" : "cards"}`;
}

function hydrateSource(value) {
  if (!value) return { title: "", subtitle: "", author: "", page: "" };
  if (typeof value === "string") {
    return { title: value.trim(), subtitle: "", author: "", page: "" };
  }
  return {
    title: String(value.title || "").trim(),
    subtitle: String(value.subtitle || "").trim(),
    author: String(value.author || "").trim(),
    page: String(value.page || "").trim()
  };
}

function createCardId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toEpoch(value) {
  return new Date(value).getTime() || 0;
}
