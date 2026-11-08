const CACHE = "cabas-v9";
const CORE = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
const STATIC_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const firebaseSdk = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameOrigin && !firebaseSdk && !STATIC_HOSTS.includes(url.hostname)) return;
  if (sameOrigin && url.pathname.startsWith("/__/")) return;
  if (sameOrigin && req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});

/* ---------- Notifications push (Firebase Cloud Messaging, messages « data ») ---------- */
self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = {}; }
  const d = p.data || p.notification || p;
  const title = d.title || "Cabas";
  const body = d.body || "";
  const listId = d.listId || "";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const front = wins.find(w => w.visibilityState === "visible" && w.focused);
    if (front) { front.postMessage({ type: "cabas-push", title, body, listId }); return; }
    await self.registration.showNotification(title, {
      body, icon: "icon-192.png", badge: "icon-192.png",
      tag: "cabas-" + listId, renotify: true,
      data: { url: "./?list=" + encodeURIComponent(listId) }
    });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  const listId = new URL(url).searchParams.get("list");
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); w.postMessage({ type: "cabas-open", listId }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
