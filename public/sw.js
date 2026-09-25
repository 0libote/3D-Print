const CACHE = "printroom-shell-v2";
const SHELL = ["/", "/offline.html", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const page = await fetch("/", { cache: "no-store" });
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
    await cache.addAll([...SHELL, ...assets]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => await caches.match("/offline.html")));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener("push", event => {
  let message = { title: "Printroom update", body: "Something changed in your studio.", url: "/" };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch {}
  const url = typeof message.url === "string" && message.url.startsWith("/") ? message.url : "/";
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "printroom-" + Date.now(),
    data: { url }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const path = event.notification.data?.url || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const window = windows[0];
    if (window) { await window.navigate(target); await window.focus(); }
    else await self.clients.openWindow(target);
  })());
});
