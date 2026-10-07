import { apiFetch } from "./api.js";

export interface MediaUploadInfo {
  key: string;
  compressed: boolean;
  originalSize: number;
  storedSize: number;
}

const warmedMediaUrls = new Set<string>();
const preloadedMediaHints = new Set<string>();
const MAX_WARMED_MEDIA_URLS = 2000;
const MAX_PRELOAD_HINTS = 120;

async function resizeImageForUpload(file: File, maxDimension = 2048): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image"));
    image.src = dataUrl;
  });

  const largestSide = Math.max(img.width, img.height);
  if (!largestSide || largestSide <= maxDimension) return file;

  const scale = maxDimension / largestSide;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(img, 0, 0, width, height);

  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  if (!blob || blob.size >= file.size) return file;

  const suffix = type === "image/png" ? "png" : "jpg";
  const nextName = file.name.replace(/\.[a-z0-9]+$/i, `.${suffix}`);
  return new File([blob], nextName, { type, lastModified: file.lastModified });
}

export async function uploadMediaWithInfo(file: File): Promise<MediaUploadInfo> {
  const preparedFile = await resizeImageForUpload(file);
  const form = new FormData();
  form.append("file", preparedFile);
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  const res = await fetch(`${API_BASE}/media`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Upload failed");
  }
  return (await res.json()) as MediaUploadInfo;
}

export async function uploadMedia(file: File): Promise<string> {
  return (await uploadMediaWithInfo(file)).key;
}

export function mediaUrl(key: string): string {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  return `${API_BASE}/media/${key}`;
}

interface PreloadMediaOptions {
  priority?: "high" | "low";
  addHint?: boolean;
}

function toMediaOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
}

function addPreloadHint(url: string): void {
  if (typeof document === "undefined") return;
  if (preloadedMediaHints.has(url) || preloadedMediaHints.size >= MAX_PRELOAD_HINTS) return;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;

  const targetOrigin = toMediaOrigin(url);
  if (targetOrigin && targetOrigin !== window.location.origin) {
    link.crossOrigin = "use-credentials";
  }

  document.head.append(link);
  preloadedMediaHints.add(url);
}

export function preloadMediaUrl(url: string, options: PreloadMediaOptions = {}): void {
  if (typeof window === "undefined") return;
  if (!url || warmedMediaUrls.has(url)) return;

  warmedMediaUrls.add(url);
  if (warmedMediaUrls.size > MAX_WARMED_MEDIA_URLS) {
    warmedMediaUrls.clear();
  }

  if (options.addHint !== false) {
    addPreloadHint(url);
  }

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = options.priority === "high" ? "high" : "low";

  const targetOrigin = toMediaOrigin(url);
  if (targetOrigin && targetOrigin !== window.location.origin) {
    image.crossOrigin = "use-credentials";
  }

  image.src = url;
}

export function preloadMediaKeys(
  keys: Array<string | null | undefined>,
  options: PreloadMediaOptions = {}
): void {
  keys.forEach((key) => {
    if (!key) return;
    preloadMediaUrl(mediaUrl(key), options);
  });
}

export async function downloadMediaObjectUrl(key: string): Promise<string> {
  return URL.createObjectURL(await downloadMediaBlob(key));
}

export async function downloadMediaBlob(key: string): Promise<Blob> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  const res = await fetch(`${API_BASE}/media/${key}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Media could not be loaded");
  }
  return res.blob();
}

export { apiFetch };
