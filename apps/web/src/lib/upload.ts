import { apiFetch } from "./api.js";

export interface MediaUploadInfo {
  key: string;
  compressed: boolean;
  originalSize: number;
  storedSize: number;
}

export async function uploadMediaWithInfo(file: File): Promise<MediaUploadInfo> {
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
  return (await res.json()) as MediaUploadInfo;
}

export async function uploadMedia(file: File): Promise<string> {
  return (await uploadMediaWithInfo(file)).key;
}

export function mediaUrl(key: string): string {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
  return `${API_BASE}/media/${key}`;
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
