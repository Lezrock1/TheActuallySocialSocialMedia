const SHELL_CACHE = "intouch-shell-v2";
const MEDIA_CACHE = "intouch-media-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png"]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) =>
          (key.startsWith("intouch-shell-") && key !== SHELL_CACHE)
          || (key.startsWith("intouch-media-") && key !== MEDIA_CACHE)
        )
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (isSameOrigin && event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(SHELL_CACHE);
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
  const isImage = destination === "image";
  const isMediaRequest = isImage && requestUrl.pathname.includes("/media/");
  const cacheable =
    (isSameOrigin && ["script", "style", "font", "manifest"].includes(destination))
    || (isImage && (isSameOrigin || isMediaRequest));
  if (!cacheable) return;

  const targetCache = isImage ? MEDIA_CACHE : SHELL_CACHE;

  event.respondWith((async () => {
    const cache = await caches.open(targetCache);
    const cached = await cache.match(event.request);
    const fetchPromise = fetch(event.request)
      .then(async (response) => {
        if (response.ok || response.type === "opaque") {
          await cache.put(event.request, response.clone());
        }
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