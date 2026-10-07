self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open("intouch-shell-v1");
    await cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png"]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("intouch-shell-") && key !== "intouch-shell-v1")
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open("intouch-shell-v1");
        await cache.put("/index.html", response.clone());
        return response;
      } catch {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  const destination = event.request.destination;
  const cacheable = ["script", "style", "image", "font", "manifest"].includes(destination);
  if (!cacheable) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const fetchPromise = fetch(event.request)
      .then(async (response) => {
        const cache = await caches.open("intouch-shell-v1");
        await cache.put(event.request, response.clone());
        return response;
      })
      .catch(() => undefined);

    if (cached) {
      void fetchPromise;
      return cached;
    }

    const network = await fetchPromise;
    return network || Response.error();
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  event.waitUntil(self.registration.showNotification(payload.title || "InTouch", {
    body: payload.body || "You have a new notification.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: payload.tag,
    data: { url: payload.url || "/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  if (targetUrl.origin !== self.location.origin) return;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length) {
      await windows[0].navigate(targetUrl.href);
      await windows[0].focus();
    } else {
      await self.clients.openWindow(targetUrl.href);
    }
  })());
});