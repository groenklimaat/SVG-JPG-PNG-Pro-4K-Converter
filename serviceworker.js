* ============================================================
   Service Worker — SVG/JPG/PNG Pro 4K Converter
   Versie: svgjpgpng-pro4k-v1.0.0
   Strategie:
     • App shell        → cache-first (snel + offline)
     • Navigatie        → network-first + offline fallback
     • Afbeeldingen     → cache-first met netwerk-update
     • Overige GET      → stale-while-revalidate
   ============================================================ */

const APP_NAME      = "SVG/JPG/PNG Pro 4K Converter";
const SW_VERSION    = "svgjpgpng-pro4k-v1.0.0";
const SHELL_CACHE   = `shell-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;
const IMAGE_CACHE   = `images-${SW_VERSION}`;

const OFFLINE_URL = "./offline.html";

/* ============================================================
   APP SHELL — alles wat offline moet werken
   (alleen 192x192 en 512x512 iconen — geen icon.svg meer)
   ============================================================ */
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./offline.html",
  "./manifest.json",
  "./icon_192x192.png",
  "./icon_512x512.png"
];

/* ============================================================
   INSTALL — app shell cachen
   ============================================================ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      console.log(`[SW] ${APP_NAME} — installeren (${SW_VERSION})`);
      const cache = await caches.open(SHELL_CACHE);

      // Elk bestand afzonderlijk cachen — één fout blokkeert niet alles
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            console.warn("[SW] Kon niet cachen:", url, err);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* ============================================================
   ACTIVATE — oude caches opruimen, clients overnemen
   ============================================================ */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, RUNTIME_CACHE, IMAGE_CACHE].includes(key))
          .map((key) => {
            console.log("[SW] Oude cache verwijderen:", key);
            return caches.delete(key);
          })
      );

      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      await self.clients.claim();
      console.log(`[SW] ${APP_NAME} — actief (${SW_VERSION})`);
    })()
  );
});

/* ============================================================
   FETCH — routering per type
   ============================================================ */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Alleen GET-requests
  if (req.method !== "GET") return;

  // Alleen http(s)
  if (!req.url.startsWith("http")) return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 1. Navigatie → network-first + offline fallback
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(event));
    return;
  }

  // 2. Afbeeldingen → cache-first met netwerk-update
  if (req.destination === "image" || /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(handleImage(req));
    return;
  }

  // 3. Same-origin assets → cache-first
  if (isSameOrigin) {
    event.respondWith(handleSameOrigin(req));
    return;
  }

  // 4. Externe GET → stale-while-revalidate
  event.respondWith(handleExternal(req));
});

/* ============================================================
   HANDLERS
   ============================================================ */

// Navigatie: probeer netwerk, val terug op cache, dan offline.html
async function handleNavigate(event) {
  try {
    const preload = await event.preloadResponse;
    if (preload) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(event.request, preload.clone());
      return preload;
    }

    const network = await fetch(event.request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(event.request, network.clone());
    return network;
  } catch (err) {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response(`Offline — ${APP_NAME}.`, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

// Afbeeldingen: cache-first, update op de achtergrond
async function handleImage(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(req);

  if (cached) {
    // Update op de achtergrond (zonder te wachten)
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }

  try {
    const network = await fetch(req);
    if (network && network.status === 200) {
      cache.put(req, network.clone());
    }
    return network;
  } catch (err) {
    // Fallback naar shell cache (bijv. iconen)
    const shell = await caches.open(SHELL_CACHE);
    const shellMatch = await shell.match(req);
    if (shellMatch) return shellMatch;

    return new Response("", { status: 404, statusText: "Not Found" });
  }
}

// Same-origin assets: cache-first met netwerk-fallback
async function handleSameOrigin(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const network = await fetch(req);
    if (network && network.status === 200 && network.type === "basic") {
      cache.put(req, network.clone());
    }
    return network;
  } catch (err) {
    return new Response(`Offline — bron niet beschikbaar (${APP_NAME}).`, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

// Externe requests: stale-while-revalidate
async function handleExternal(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((network) => {
      if (network && network.status === 200) {
        cache.put(req, network.clone());
      }
      return network;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/* ============================================================
   MESSAGES — client kan update forceren
   ============================================================ */
self.addEventListener("message", (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_VERSION":
      event.ports[0]?.postMessage({
        version: SW_VERSION,
        name: APP_NAME
      });
      break;

    case "CLEAR_CACHE":
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => {
          event.ports[0]?.postMessage({ cleared: true });
        });
      break;
  }
});
