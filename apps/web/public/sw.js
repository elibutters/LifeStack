// Offline fallback only. Nothing from an authenticated page or the API is ever cached,
// so no personal data is left on the device after the session ends.
const CACHE = "lifestack-shell-v3";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch((err) => {
      if (err && err.name === "AbortError") return Promise.reject(err);
      return caches.match(OFFLINE);
    }),
  );
});
