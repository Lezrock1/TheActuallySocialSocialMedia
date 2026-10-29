const SHELL_CACHE = "intouch-shell-v3";
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
    // Media keys are immutable, so a cached copy is served without revalidation.
    if (cached && isImage) return cached;

    const fetchPromise = fetch(event.request)
      .then(async (response) => {
        // Opaque cross-origin responses could hide errors; the HTTP cache handles those.
        if (response.ok) {
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

async function clearDisplayedNotifications(tags, activeTags) {
  const notifications = await self.registration.getNotifications();
  const selected = new Set(tags || []);
  const active = activeTags ? new Set(activeTags) : null;
  for (const notification of notifications) {
    const managed = notification.tag && notification.tag !== "moment" && notification.tag !== "quiet-hours-digest";
    if (selected.has(notification.tag) || (active && managed && !active.has(notification.tag)) || (active?.size === 0 && notification.tag === "quiet-hours-digest")) notification.close();
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "notifications:clear" && Array.isArray(event.data.tags)) event.waitUntil(clearDisplayedNotifications(event.data.tags));
  if (event.data?.type === "notifications:sync" && Array.isArray(event.data.tags)) event.waitUntil(clearDisplayedNotifications([], event.data.tags));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  if (payload.type === "notifications:clear" && Array.isArray(payload.tags)) {
    event.waitUntil(clearDisplayedNotifications(payload.tags));
    return;
  }

  event.waitUntil(self.registration.showNotification(payload.title || "InTouch", {
    body: payload.body || "You have a new notification.",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
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
    const controlled = await self.clients.matchAll({ type: "window" });
    const candidates = windows.filter((client) => new URL(client.url).origin === self.location.origin);
    const existing = candidates.find((client) => client.focused)
      || candidates.find((client) => client.visibilityState === "visible")
      || candidates[0];
    if (existing) {
      await existing.focus();
      if (controlled.some((client) => client.id === existing.id)) {
        existing.postMessage({ type: "intouch:notification-open", url: targetUrl.href });
        return;
      }
      const navigated = await existing.navigate(targetUrl.href);
      if (navigated) return;
    }
    await self.clients.openWindow(targetUrl.href);
  })());
});