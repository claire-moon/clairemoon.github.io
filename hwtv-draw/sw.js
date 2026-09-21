const CACHE_NAME = "hwtv-draw-v0-0-2-inputfix2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("hwtv-draw-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(new Request(event.request, { cache: "no-store" }));
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        await (await caches.open(CACHE_NAME)).put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }
      return caches.match("./");
    }
  })());
});
