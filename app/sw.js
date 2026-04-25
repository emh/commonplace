const CACHE_NAME = "commonplace-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./main.js",
  "./model.js",
  "./storage.js",
  "./sync.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(warmCache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function warmCache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    APP_SHELL.map(async (url) => {
      try {
        const request = new Request(url, { cache: "reload" });
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
      } catch {
        // Runtime fetches can backfill when offline caching is partial.
      }
    })
  );
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok && shouldCache(request)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      const fallback = (await cache.match(fallbackUrl)) || (await cache.match("./"));
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

function shouldCache(request) {
  const url = new URL(request.url);
  return request.cache !== "no-store" && !url.search;
}
