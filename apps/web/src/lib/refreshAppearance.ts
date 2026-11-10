import { useEffect, useState } from "react";

export const REFRESH_BIRDS = [
  { id: "swallow", label: "Swallow" },
  { id: "swift", label: "Swift" },
  { id: "hummingbird", label: "Hummingbird" },
  { id: "kingfisher", label: "Kingfisher" },
  { id: "robin", label: "Robin" },
  { id: "crane", label: "Crane" },
  { id: "falcon", label: "Falcon" },
  { id: "woodpecker", label: "Woodpecker" },
  { id: "puffin", label: "Puffin" },
  { id: "toucan", label: "Toucan" },
  { id: "flappy", label: "Flappy Bird" },
  { id: "classic", label: "Classic arrows" },
] as const;

export type RefreshBird = (typeof REFRESH_BIRDS)[number]["id"];

export const REFRESH_COLORS = [
  { label: "Magenta", value: "#c026d3" },
  { label: "Teal", value: "#167d7f" },
  { label: "Blue", value: "#2868b2" },
  { label: "Coral", value: "#d65c4b" },
  { label: "Amber", value: "#d78a22" },
  { label: "Green", value: "#55844a" },
  { label: "Graphite", value: "#38424a" },
] as const;

export interface RefreshAppearance {
  bird: RefreshBird;
  color: string | null;
}

const STORAGE_KEY = "intouch:refresh-appearance";
const CHANGE_EVENT = "intouch:refresh-appearance-change";
const DEFAULT_APPEARANCE: RefreshAppearance = { bird: "flappy", color: null };

const BIRD_COLORS: Record<RefreshBird, string> = {
  swallow: "#193e42",
  swift: "#334357",
  hummingbird: "#188777",
  kingfisher: "#127f8a",
  robin: "#65584b",
  crane: "#87928e",
  falcon: "#485966",
  woodpecker: "#303938",
  puffin: "#252f38",
  toucan: "#263536",
  flappy: "#f2cd3d",
  classic: "#c026d3",
};

function isRefreshBird(value: unknown): value is RefreshBird {
  return typeof value === "string" && REFRESH_BIRDS.some((bird) => bird.id === value);
}

export function readRefreshAppearance(): RefreshAppearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<RefreshAppearance> | null;
    if (!saved) return DEFAULT_APPEARANCE;
    return {
      bird: isRefreshBird(saved.bird) ? saved.bird : DEFAULT_APPEARANCE.bird,
      color: typeof saved.color === "string" && /^#[\da-f]{6}$/i.test(saved.color)
        ? saved.color
        : null,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function resolveRefreshColor(bird: RefreshBird, color: string | null): string {
  return color ?? BIRD_COLORS[bird];
}

export function useRefreshAppearance(): [RefreshAppearance, (changes: Partial<RefreshAppearance>) => void] {
  const [appearance, setAppearance] = useState(readRefreshAppearance);

  useEffect(() => {
    const sync = () => setAppearance(readRefreshAppearance());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function update(changes: Partial<RefreshAppearance>) {
    const next = { ...readRefreshAppearance(), ...changes };
    setAppearance(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [appearance, update];
}