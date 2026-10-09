// app shell works offline; /api always goes to the network
const CACHE = "stash-v3";
const SHELL = ["/", "/styles.css", "/js/boot.js", "/js/app.js", "/js/util.js", "/js/store.js", "/js/charts.js", "/js/defaults.js",
  "/js/views/money.js", "/js/views/tasks.js", "/js/views/wishes.js", "/js/views/settings.js",
  "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  const key = req.mode === "navigate" ? "/" : url.pathname;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(key, c)); }
    return res;
  }).catch(() => caches.match(key)));
});
