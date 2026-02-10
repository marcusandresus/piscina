const CACHE_NAME = "piscina-pwa-v1";
const scopeUrl = new URL(self.registration.scope);
const basePath = scopeUrl.pathname.endsWith("/") ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const INDEX_URL = `${basePath}index.html`;
const MANIFEST_URL = `${basePath}manifest.webmanifest`;
const APP_SHELL = [basePath, INDEX_URL, MANIFEST_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          const cloned = networkResponse.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return networkResponse;
        });
      })
    );
  }
});
