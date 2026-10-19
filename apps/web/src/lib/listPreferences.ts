import { useEffect, useState } from "react";

export const UNREAD_FIRST_KEY = "intouch:unread-first";
export const ALERTS_UNREAD_ONLY_KEY = "intouch:alerts-unread-only";
const CHANGE_EVENT = "intouch:list-preference-change";

export function useListPreference(key: typeof UNREAD_FIRST_KEY | typeof ALERTS_UNREAD_ONLY_KEY): [boolean, (value: boolean) => void] {
  const read = () => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);
  const update = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {}
  };
  return [value, update];
}