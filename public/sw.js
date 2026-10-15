const CACHE = "printroom-shell-__BUILD_ID__";
const SHELL = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/fonts/dm-sans.woff2",
  "/fonts/manrope.woff2",
];

const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let assets = [];
      try {
        const page = await fetch("/", { cache: "no-store" });
        const html = await page.text();
        assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
          (match) => match[1],
        );
      } catch {}
      const urls = [...SHELL, ...assets];
      await Promise.allSettled(
        urls.map(async (url) => {
          try {
            await cache.add(url);
          } catch {}
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith("printroom-shell-") && key !== CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});
self.addEventListener("message", (event) => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => await caches.match("/offline.html")),
    );
    return;
  }
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request))
      .then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (
              response.ok &&
              (SHELL.includes(url.pathname) ||
                url.pathname.startsWith("/assets/"))
            ) {
              const copy = response.clone();
              event.waitUntil(
                caches.open(CACHE).then(async (cache) => {
                  await cache.put(request, copy);
                  const keys = await cache.keys();
                  if (keys.length > MAX_RUNTIME_ENTRIES) {
                    await Promise.all(
                      keys
                        .slice(0, keys.length - MAX_RUNTIME_ENTRIES)
                        .map((key) => cache.delete(key)),
                    );
                  }
                }),
              );
            }
            return response;
          }),
      ),
  );
});

self.addEventListener("push", (event) => {
  let message = {
    title: "Printroom update",
    body: "Something changed in your studio.",
    url: "/",
  };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {}
  const url =
    typeof message.url === "string" &&
    message.url.startsWith("/") &&
    !message.url.startsWith("//")
      ? message.url
      : "/";
  const orderMatch =
    typeof url === "string" ? url.match(/[?&]order=(\d+)/) : null;
  const orderPart =
    message.order_id ?? orderMatch?.[1] ?? message.orderId ?? "general";
  const kindPart = message.kind ?? message.title ?? "update";
  const tag = `printroom-${String(kindPart)}-${String(orderPart)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 100);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const window = windows[0];
      if (window) {
        await window.navigate(target);
        await window.focus();
      } else await self.clients.openWindow(target);
    })(),
  );
});
