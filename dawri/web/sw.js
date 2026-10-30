// Dawri service worker: offline shell, Web Push, notification clicks.
const VERSION = "dawri-v1";
const SHELL = [
  "/", "/index.html", "/config.js", "/manifest.webmanifest", "/css/tokens.css", "/css/app.css", "/assets/logo.svg",
  "/js/app.js", "/js/i18n.js", "/js/errors.js", "/js/ui/dom.js", "/js/ui/sheet.js", "/js/ui/toast.js", "/js/ui/components.js",
  "/js/ui/push.js", "/js/screens/shop.js", "/js/screens/ticket.js", "/i18n/customer.ar.json", "/i18n/customer.en.json",
  "/assets/icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Navigations: network first, fall back to the cached shell. Own static files: stale-while-revalidate.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit ?? net;
  }));
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data?.json() ?? {}; } catch { data = { title: "دوري", body: e.data?.text() }; }
  const urgent = data.vibrate || ["called", "ready"].includes(data.kind);
  e.waitUntil(self.registration.showNotification(data.title || "دوري", {
    body: data.body || "", icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png",
    tag: data.tag || data.kind || "dawri", renotify: true, requireInteraction: urgent,
    vibrate: urgent ? [300, 120, 300, 120, 300] : [120], data: { url: data.url || "/" }, dir: "rtl", lang: "ar",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const same = wins.find((w) => w.url.startsWith(target)) ?? wins.find((w) => /\/(t|s)\//.test(new URL(w.url).pathname));
    if (same) return same.focus().then((w) => (w && !w.url.startsWith(target) ? w.navigate(target) : w));
    return self.clients.openWindow(target);
  }));
});
