import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";
const STORAGE_KEY = "intouch:theme";
const CHANGE_EVENT = "intouch:theme-change";

export function readTheme(): AppTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The in-memory theme still applies if storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useThemePreference(): [AppTheme, (theme: AppTheme) => void] {
  const [theme, setTheme] = useState<AppTheme>(readTheme);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function update(theme: AppTheme) {
    setTheme(theme);
    applyTheme(theme);
  }

  return [theme, update];
}

export function initializeTheme(): void {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
