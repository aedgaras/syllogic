const CACHE_NAME = "syllogic-offline-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/pwa-192x192.png",
  "/icons/pwa-512x512.png",
  "/icons/pwa-maskable-512x512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("syllogic-offline-") && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Authenticated HTML, APIs, uploads, RSC payloads, and mutations always stay
  // on the network. The worker only supplies a static fallback for failed
  // top-level navigations and never stores their responses.
  if (event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(async () => {
      const fallback = await caches.match(OFFLINE_URL);
      return fallback ?? Response.error();
    }),
  );
});
