import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Story } from "@app/shared";
import { ApiError, apiFetch } from "./api.js";

interface CompletedView { id: string; expiresAt: number; pending: boolean }
const CHANGE_EVENT = "intouch:story-views-change";
const memory = new Map<string, CompletedView[]>();
const syncing = new Set<string>();
let activeUserId: string | undefined;

function readViews(userId: string): CompletedView[] {
  let saved: unknown;
  try { saved = JSON.parse(localStorage.getItem(`intouch:story-views:${userId}`) ?? "null"); } catch { saved = null; }
  const values = Array.isArray(saved) ? saved : memory.get(userId) ?? [];
  return values.filter((value): value is CompletedView => !!value && typeof value.id === "string" && typeof value.expiresAt === "number" && value.expiresAt > Date.now() && typeof value.pending === "boolean").slice(-1000);
}

function saveViews(userId: string, views: CompletedView[]) {
  memory.set(userId, views);
  try { localStorage.setItem(`intouch:story-views:${userId}`, JSON.stringify(views)); } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

async function syncViews(userId: string): Promise<void> {
  if (syncing.has(userId) || navigator.onLine === false || activeUserId !== userId) return;
  syncing.add(userId);
  try {
    for (const view of readViews(userId).filter((entry) => entry.pending)) {
      if (activeUserId !== userId) break;
      try {
        await apiFetch(`/stories/${encodeURIComponent(view.id)}/view`, { method: "POST" });
        saveViews(userId, readViews(userId).map((entry) => entry.id === view.id ? { ...entry, pending: false } : entry));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          saveViews(userId, readViews(userId).map((entry) => entry.id === view.id ? { ...entry, pending: false } : entry));
          continue;
        }
        break;
      }
    }
  } finally { syncing.delete(userId); }
}

export function useStoryViews(userId: string | undefined) {
  const queryClient = useQueryClient();
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!userId) return;
    activeUserId = userId;
    const update = () => setRevision((value) => value + 1);
    const sync = () => {
      if (document.hidden) return;
      if (!readViews(userId).some((view) => view.pending)) return;
      void syncViews(userId).then(() => queryClient.invalidateQueries({ queryKey: ["stories"] }));
    };
    const refresh = () => { sync(); if (!document.hidden) void queryClient.invalidateQueries({ queryKey: ["stories"] }); };
    const timer = window.setInterval(sync, 15_000);
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    sync();
    return () => {
      window.clearInterval(timer);
      if (activeUserId === userId) activeUserId = undefined;
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId, queryClient]);
  const completed = new Set(userId ? readViews(userId).map((view) => view.id) : []);
  function complete(story: Story) {
    if (!userId) return;
    const views = readViews(userId);
    const expiry = Date.parse(story.expiresAt);
    if (!views.some((view) => view.id === story.id)) saveViews(userId, [...views, { id: story.id, expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 86_400_000, pending: true }].slice(-1000));
    void syncViews(userId).then(() => queryClient.invalidateQueries({ queryKey: ["stories"] }));
  }
  return { completed, complete };
}