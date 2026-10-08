import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { mediaUrl } from "./upload.js";
import { readTheme } from "./theme.js";

export const PAGE_SURFACES = ["feed", "snaps", "messages", "alerts", "profile", "people", "settings", "other"] as const;
export type PageSurface = (typeof PAGE_SURFACES)[number];
export type BackgroundKey = PageSurface | "all" | "conversation";
export type BackgroundMode = "shared" | "custom";

export interface PageBackgroundPreference {
  color: string;
  imageKey: string | null;
}

const STORAGE_PREFIX = "intouch:page-background:";
const MODE_STORAGE_KEY = "intouch:page-background-mode";
const CHANGE_EVENT = "intouch:page-background-change";
const THEME_CHANGE_EVENT = "intouch:theme-change";
export const DEFAULT_BACKGROUND: PageBackgroundPreference = {
  color: "#f7f7f8",
  imageKey: null,
};

export function readBackgroundMode(): BackgroundMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "shared" ? "shared" : "custom";
  } catch {
    return "custom";
  }
}

export function saveBackgroundMode(mode: BackgroundMode): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readPageBackground(surface: BackgroundKey): PageBackgroundPreference {
  try {
    const storageKey = surface === "messages" && !localStorage.getItem(`${STORAGE_PREFIX}messages`)
      ? "chat"
      : surface;
    const value = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!value) return DEFAULT_BACKGROUND;
    const parsed = JSON.parse(value) as Partial<PageBackgroundPreference>;
    return {
      color: typeof parsed.color === "string" && /^#[0-9a-f]{6}$/i.test(parsed.color)
        ? parsed.color
        : DEFAULT_BACKGROUND.color,
      imageKey: typeof parsed.imageKey === "string" ? parsed.imageKey : null,
    };
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export function hasSavedPageBackground(surface: PageSurface): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${surface}`) !== null ||
      (surface === "messages" && localStorage.getItem(`${STORAGE_PREFIX}chat`) !== null);
  } catch {
    return false;
  }
}

export function savePageBackground(surface: BackgroundKey, preference: PageBackgroundPreference): void {
  localStorage.setItem(`${STORAGE_PREFIX}${surface}`, JSON.stringify(preference));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetPageBackgrounds(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
  }
  saveBackgroundMode("shared");
}

export function pageSurfaceForPath(pathname: string): PageSurface {
  if (pathname === "/") return "feed";
  if (pathname.startsWith("/snaps")) return "snaps";
  if (pathname.startsWith("/dms")) return "messages";
  if (pathname.startsWith("/notifications")) return "alerts";
  if (pathname.startsWith("/u/")) return "profile";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/settings")) return "settings";
  return "other";
}

function themedPreference(preference: PageBackgroundPreference): PageBackgroundPreference {
  if (readTheme() === "dark") return { ...preference, color: "#111318" };
  return preference;
}

function backgroundStyle(preference: PageBackgroundPreference, imageOverlayOpacity: number): CSSProperties {
  const overlay = readTheme() === "dark" ? "17, 19, 24" : "247, 247, 248";
  return {
    backgroundColor: preference.color,
    backgroundImage: preference.imageKey
      ? `linear-gradient(rgba(${overlay}, ${imageOverlayOpacity}), rgba(${overlay}, ${imageOverlayOpacity})), url("${mediaUrl(preference.imageKey)}")`
      : "none",
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

export function usePageBackground(surface: PageSurface): void {
  useEffect(() => {
    const body = document.body;
    const previous = {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      backgroundSize: body.style.backgroundSize,
      backgroundPosition: body.style.backgroundPosition,
      backgroundAttachment: body.style.backgroundAttachment,
    };
    const apply = () => {
      const key = readBackgroundMode() === "shared" ? "all" : surface;
      Object.assign(body.style, backgroundStyle(themedPreference(readPageBackground(key)), 0.78));
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
    };
    apply();
    window.addEventListener(CHANGE_EVENT, apply);
    window.addEventListener(THEME_CHANGE_EVENT, apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener(CHANGE_EVENT, apply);
      window.removeEventListener(THEME_CHANGE_EVENT, apply);
      window.removeEventListener("storage", apply);
      Object.assign(body.style, previous);
    };
  }, [surface]);
}

export function useConversationBackground(): CSSProperties {
  const [preference, setPreference] = useState(() => themedPreference(readPageBackground("conversation")));

  useEffect(() => {
    const refresh = () => setPreference(themedPreference(readPageBackground("conversation")));
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener(THEME_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return backgroundStyle(preference, 0.38);
}