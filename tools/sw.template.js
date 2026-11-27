// Service worker: precache every game file, then serve them from the cache (offline after first visit).
// A new version takes over as soon as it has downloaded (skipWaiting + clients.claim); the page reloads
// itself into it from the menu (src/engine/pwa.js), so players never stay on an old build.
const CACHE = __CACHE__;
const ASSETS = __ASSETS__;
const tell = async (m) => { for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: "window" })) c.postMessage(m); };
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  let done = 0;
  for (const a of ASSETS) {
    const r = await fetch(new Request(a, { cache: "reload" }));
    if (!r.ok) { tell({ type: "error", message: a + ": HTTP " + r.status }); throw new Error(a); }
    await cache.put(a, r);
    tell({ type: "progress", done: ++done, total: ASSETS.length });
  }
  tell({ type: "ready" });
  await self.skipWaiting();          // don't wait for every open tab or app window to close
})()));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("deadfrontline-")) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("message", (e) => { if (e.data && e.data.type === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (err) {
      if (req.mode === "navigate") { const s = await (await caches.open(CACHE)).match("index.html"); if (s) return s; }
      throw err;
    }
  })());
});
