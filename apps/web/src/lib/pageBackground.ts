import { useEffect } from "react";
import { mediaUrl } from "./upload.js";

export type PageSurface = "feed" | "chat";

export interface PageBackgroundPreference {
  color: string;
  imageKey: string | null;
}

const STORAGE_PREFIX = "intouch:page-background:";
const CHANGE_EVENT = "intouch:page-background-change";
const DEFAULT_BACKGROUND: PageBackgroundPreference = {
  color: "#f7f7f8",
  imageKey: null,
};

export function readPageBackground(surface: PageSurface): PageBackgroundPreference {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${surface}`);
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

export function savePageBackground(surface: PageSurface, preference: PageBackgroundPreference): void {
  localStorage.setItem(`${STORAGE_PREFIX}${surface}`, JSON.stringify(preference));
  window.dispatchEvent(new Event(CHANGE_EVENT));
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
      const preference = readPageBackground(surface);
      body.style.backgroundColor = preference.color;
      body.style.backgroundImage = preference.imageKey
        ? `linear-gradient(rgba(247, 247, 248, 0.78), rgba(247, 247, 248, 0.78)), url("${mediaUrl(preference.imageKey)}")`
        : "none";
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
    };
    apply();
    window.addEventListener(CHANGE_EVENT, apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener(CHANGE_EVENT, apply);
      window.removeEventListener("storage", apply);
      Object.assign(body.style, previous);
    };
  }, [surface]);
}