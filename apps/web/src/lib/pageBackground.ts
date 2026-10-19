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

type Tone = "light" | "dark";

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const MIN_LIGHT_LUMINANCE = 0.78;
const MAX_DARK_LUMINANCE = 0.06;

// Keeps the chosen hue but nudges lightness until page text stays readable.
function clampColorForTone(color: string, tone: Tone): string {
  const target = tone === "light" ? [255, 255, 255] : [0, 0, 0];
  const rgb = hexToRgb(color);
  for (let step = 0; step <= 50; step += 1) {
    const amount = step / 50;
    const candidate = rgbToHex(rgb.map((channel, index) => channel + (target[index] - channel) * amount));
    const l = luminance(candidate);
    if (tone === "light" ? l >= MIN_LIGHT_LUMINANCE : l <= MAX_DARK_LUMINANCE) return candidate;
  }
  return rgbToHex(target);
}

function resolveBackground(preference: PageBackgroundPreference): { preference: PageBackgroundPreference; tone: Tone } {
  const tone = readTheme();
  const color = tone === "dark" && preference.color === DEFAULT_BACKGROUND.color ? "#111318" : clampColorForTone(preference.color, tone);
  return { preference: { ...preference, color }, tone };
}

function mixColor(color: string, base: string, amount: number): string {
  const rgb = hexToRgb(color);
  return rgbToHex(hexToRgb(base).map((channel, index) => channel * (1 - amount) + rgb[index] * amount));
}

function backgroundStyle(preference: PageBackgroundPreference, imageOverlayOpacity: number, tone: Tone): CSSProperties {
  const overlay = tone === "dark" ? "17, 19, 24" : "247, 247, 248";
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
    const root = document.documentElement;
    const paletteKeys = ["--page-background", "--surface", "--surface-muted", "--surface-strong", "--surface-border", "--secondary-text"];
    const previousPalette = paletteKeys.map((key) => [key, root.style.getPropertyValue(key)] as const);
    const previous = {
      backgroundColor: body.style.backgroundColor,
      backgroundImage: body.style.backgroundImage,
      backgroundSize: body.style.backgroundSize,
      backgroundPosition: body.style.backgroundPosition,
      backgroundAttachment: body.style.backgroundAttachment,
    };
    const apply = () => {
      const key = readBackgroundMode() === "shared" ? "all" : surface;
      const resolved = resolveBackground(readPageBackground(key));
      const dark = resolved.tone === "dark";
      root.style.setProperty("--page-background", resolved.preference.color);
      root.style.setProperty("--surface", mixColor(resolved.preference.color, dark ? "#191c23" : "#ffffff", 0.08));
      root.style.setProperty("--surface-muted", mixColor(resolved.preference.color, dark ? "#222630" : "#f3f4f6", 0.08));
      root.style.setProperty("--surface-strong", mixColor(resolved.preference.color, dark ? "#2d323d" : "#e5e7eb", 0.08));
      root.style.setProperty("--surface-border", mixColor(resolved.preference.color, dark ? "#48505e" : "#cbd0d8", 0.08));
      root.style.setProperty("--secondary-text", dark ? "#bdc4d0" : "#4b5563");
      Object.assign(body.style, backgroundStyle(resolved.preference, 0.78, resolved.tone));
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
      for (const [key, value] of previousPalette) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
    };
  }, [surface]);
}

function readConversationStyle(): CSSProperties {
  const tone = readTheme();
  const preference = readPageBackground("conversation");
  const resolved = resolveBackground(preference);
  return backgroundStyle(resolved.preference, 0.38, tone);
}

export function useConversationBackground(): CSSProperties {
  const [style, setStyle] = useState(readConversationStyle);

  useEffect(() => {
    // Wait a tick so the page palette has been re-resolved first.
    const refresh = () => window.setTimeout(() => setStyle(readConversationStyle()), 0);
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener(THEME_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return style;
}