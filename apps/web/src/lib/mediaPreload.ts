const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
const warmedMediaUrls = new Set<string>();
const MAX_WARMED_MEDIA_URLS = 2000;
const MAX_KEYS_PER_SCAN = 80;

export interface PreloadMediaOptions {
  priority?: "high" | "low";
}

function mediaUrlForKey(key: string): string {
  return `${API_BASE}/media/${key}`;
}

// Same request mode as a plain <img>, so the warmed response is reused from the HTTP cache.
export function preloadMediaUrl(url: string, options: PreloadMediaOptions = {}): void {
  if (typeof window === "undefined" || !url || warmedMediaUrls.has(url)) return;
  if (warmedMediaUrls.size >= MAX_WARMED_MEDIA_URLS) warmedMediaUrls.clear();
  warmedMediaUrls.add(url);

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = options.priority === "low" ? "low" : "high";
  image.src = url;
}

export function preloadMediaKeys(
  keys: Array<string | null | undefined>,
  options: PreloadMediaOptions = {}
): void {
  for (const key of keys) {
    if (key) preloadMediaUrl(mediaUrlForKey(key), options);
  }
}

// Warms every avatar referenced in an API response before the UI renders it.
export function preloadAvatarsFromPayload(payload: unknown): void {
  const keys = new Set<string>();
  const stack: unknown[] = [payload];
  let visited = 0;
  while (stack.length > 0 && keys.size < MAX_KEYS_PER_SCAN && visited < 5000) {
    const value = stack.pop();
    visited += 1;
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    for (const [name, child] of Object.entries(value)) {
      if (name === "avatarKey" && typeof child === "string") keys.add(child);
      else if (child && typeof child === "object") stack.push(child);
    }
  }
  preloadMediaKeys([...keys]);
}
