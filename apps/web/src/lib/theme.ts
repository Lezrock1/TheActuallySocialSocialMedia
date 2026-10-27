import { useEffect, useState } from "react";
import * as SunCalc from "suncalc";

export type AppTheme = "light" | "dark";
const STORAGE_KEY = "intouch:theme";
const CHANGE_EVENT = "intouch:theme-change";
const SCHEDULE_KEY = "intouch:theme-schedule";

export interface ThemeSchedule {
  mode: "manual" | "sun";
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
}

export function readThemeSchedule(): ThemeSchedule {
  const fallback: ThemeSchedule = { mode: "manual", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", latitude: null, longitude: null };
  try {
    const saved = JSON.parse(localStorage.getItem(SCHEDULE_KEY) ?? "null");
    if (!saved) return fallback;
    new Intl.DateTimeFormat("en", { timeZone: saved.timeZone }).format();
    return {
      mode: saved.mode === "sun" ? "sun" : "manual",
      timeZone: typeof saved.timeZone === "string" ? saved.timeZone : fallback.timeZone,
      latitude: typeof saved.latitude === "number" && Math.abs(saved.latitude) <= 90 ? saved.latitude : null,
      longitude: typeof saved.longitude === "number" && Math.abs(saved.longitude) <= 180 ? saved.longitude : null,
    };
  } catch { return fallback; }
}

export function getTimeZone(): string { return readThemeSchedule().timeZone; }

export function solarTimes(schedule: ThemeSchedule, now = new Date()) {
  if (schedule.latitude === null || schedule.longitude === null) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const local = parts(now);
  const noonUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), 12);
  const shifted = parts(new Date(noonUtc));
  const offset = Date.UTC(Number(shifted.year), Number(shifted.month) - 1, Number(shifted.day), Number(shifted.hour), Number(shifted.minute)) - noonUtc;
  return SunCalc.getTimes(new Date(noonUtc - offset), schedule.latitude, schedule.longitude);
}

export function resolveScheduledTheme(schedule: ThemeSchedule, now = new Date()): AppTheme {
  const times = solarTimes(schedule, now);
  if (!times) return readTheme();
  if (!times.sunrise || !times.sunset || !Number.isFinite(times.sunrise.getTime()) || !Number.isFinite(times.sunset.getTime())) {
    return SunCalc.getPosition(now, schedule.latitude!, schedule.longitude!).altitude <= 0 ? "dark" : "light";
  }
  return now < times.sunrise || now >= times.sunset ? "dark" : "light";
}

export function updateThemeSchedule(changes: Partial<ThemeSchedule>): void {
  const schedule = { ...readThemeSchedule(), ...changes };
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule)); } catch {}
  renderTheme(schedule.mode === "sun" ? resolveScheduledTheme(schedule) : readTheme());
}

export function useThemeSchedule(): [ThemeSchedule, (changes: Partial<ThemeSchedule>) => void] {
  const [schedule, setSchedule] = useState(readThemeSchedule);
  useEffect(() => {
    const sync = () => setSchedule(readThemeSchedule());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CHANGE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return [schedule, updateThemeSchedule];
}

export function readTheme(): AppTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function renderTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = theme === "dark" ? "#111318" : "#f7f7f8";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111318" : "#f7f7f8");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The in-memory theme still applies if storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function applyTheme(theme: AppTheme): void {
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ ...readThemeSchedule(), mode: "manual" })); } catch {}
  renderTheme(theme);
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
  const restore = () => {
    const schedule = readThemeSchedule();
    renderTheme(schedule.mode === "sun" ? resolveScheduledTheme(schedule) : readTheme());
  };
  restore();
  window.addEventListener("pageshow", restore);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) restore();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== SCHEDULE_KEY && event.key !== null) return;
    restore();
  });
  window.setInterval(restore, 60_000);
}
