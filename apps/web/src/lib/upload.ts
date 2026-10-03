import { apiFetch } from "./api.js";

export async function uploadMedia(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
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
  const { key } = (await res.json()) as { key: string };
  return key;
}

export function mediaUrl(key: string): string {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  return `${API_BASE}/media/${key}`;
}

export async function downloadMediaObjectUrl(key: string): Promise<string> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  const res = await fetch(`${API_BASE}/media/${key}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Media could not be loaded");
  }
  return URL.createObjectURL(await res.blob());
}

export { apiFetch };
