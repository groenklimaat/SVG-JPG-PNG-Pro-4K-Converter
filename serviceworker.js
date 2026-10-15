/* ============================================================
   SVG/JPG/PNG Pro 4K Converter — Service Worker
   Versie: 1.0.0
   ============================================================ */

const CACHE_NAME = "pro4k-converter-v1.0.0";
const OFFLINE_URL = "./index.html";

/* Bestanden die vooraf in de cache worden gezet */
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "./privacy.html"
];

/* ============================================================
   INSTALL — vooraf cachen
   ============================================================ */
self.addEventListener("install", (event) => {
  console.log("[SW] Installeren...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Precache bestanden toevoegen");
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log("[SW] Installatie voltooid");
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("[SW] Precache mislukt:", err);
      })
  );
});

/* ============================================================
   ACTIVATE — oude caches opruimen
   ============================================================ */
self.addEventListener("activate", (event) => {
  console.log("[SW] Activeren...");
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log("[SW] Oude cache verwijderen:", name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log("[SW] Activatie voltooid");
        return self.clients.claim();
      })
  );
});

/* ============================================================
   FETCH — cache-first met netwerk-fallback
   ============================================================ */
self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* Alleen GET-verzoeken cachen */
  if (request.method !== "GET") return;

  /* Alleen same-origin verzoeken cachen */
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigatieverzoeken: probeer netwerk, val terug op cache */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  /* Overige verzoeken: cache-first */
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          /* Alleen geldige responses cachen */
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => {
          /* Fallback voor afbeeldingen */
          if (request.destination === "image") {
            return caches.match("./icon-192x192.png");
          }
        });
    })
  );
});

/* ============================================================
   BERICHTEN — SKIP_WAITING afhandelen
   ============================================================ */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("[SW] SKIP_WAITING ontvangen");
    self.skipWaiting();
  }
});
